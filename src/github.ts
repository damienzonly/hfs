// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import events from './events'
import { DAY, httpString, httpStream, unzip, AsapStream } from './misc'
import {
    DISABLING_POSTFIX, findPluginByRepo,
    getAvailablePlugins,
    getPluginInfo,
    mapPlugins,
    parsePluginSource,
    PATH as PLUGINS_PATH, Repo,
} from './plugins'
import { ApiError } from './apiMiddleware'
import _ from 'lodash'
import { HFS_REPO, HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_NOT_ACCEPTABLE, HTTP_SERVER_ERROR } from './const'
import { rename, rm } from 'fs/promises'
import { join } from 'path'
import { readFileSync } from 'fs'

const DIST_ROOT = 'dist'

type DownloadStatus = true | undefined
const downloading: Record<string, DownloadStatus> = {}

function downloadProgress(id: string, status: DownloadStatus) {
    if (status === undefined)
        delete downloading[id]
    else
        downloading[id] = status
    events.emit('pluginDownload_'+id, status)
}

// determine default branch, possibly without consuming api quota
async function getGithubDefaultBranch(repo: string) {
    const res = await httpString(`https://github.com/${repo}/archive/refs/heads/main.zip`, { method: 'HEAD' })
    return res.ok ? 'main'
        : (await getRepoInfo(repo))?.default_branch as string
}

export async function downloadPlugin(repo: Repo, { branch='', overwrite=false }={}) {
    if (typeof repo !== 'string')
        repo = repo.main
    if (downloading[repo])
        return new ApiError(HTTP_CONFLICT, "already downloading")
    console.log('downloading plugin', repo)
    downloadProgress(repo, true)
    try {
        if (repo.includes('//')) { // custom repo
            const pl = findPluginByRepo(repo)
            if (!pl)
                return new ApiError(HTTP_BAD_REQUEST, "bad repo")
            const customRepo = ((pl as any).getData?.() || pl).repo
            let url = customRepo?.zip
            if (!url)
                return new ApiError(HTTP_SERVER_ERROR, "bad plugin")
            if (!url.includes('//'))
                url = customRepo.web + url
            return await go(url, pl?.id, customRepo.zipRoot ?? DIST_ROOT)
        }
        branch ||= await getGithubDefaultBranch(repo)
        const short = repo.split('/')[1] // second part, repo without the owner
        if (!short)
            return new ApiError(HTTP_BAD_REQUEST, "bad repo")
        const folder = overwrite ? _.findKey(getFolder2repo(), x => x===repo)! // use existing folder
            : getFolder2repo().hasOwnProperty(short) ? repo.replace('/','-') // longer form only if another plugin is using short form, to avoid overwriting
                : short
        const GITHUB_ZIP_ROOT = short + '-' + branch // GitHub puts everything within this folder
        return await go(`https://github.com/${repo}/archive/refs/heads/${branch}.zip`, folder, GITHUB_ZIP_ROOT + '/' + DIST_ROOT)

        async function go(url: string, folder: string, zipRoot: string) {
            const installPath = PLUGINS_PATH + '/' + folder
            const foldersToCopy = [ // from longer to shorter, so we first test the longer
                zipRoot + '-' + process.platform + '-' + process.arch,
                zipRoot + '-' + process.platform,
                zipRoot,
            ].map(x => x + '/')
            // github zip doesn't have content-length, so we cannot produce progress event
            const stream = await httpStream(url)
            const MAIN = 'plugin.js'
            await unzip(stream, async path => {
                const folder = foldersToCopy.find(x => path.startsWith(x))
                if (!folder || path.endsWith('/')) return false
                let dest = path.slice(folder.length)
                if (dest === MAIN) // avoid being possibly loaded before the download is complete
                    dest += DISABLING_POSTFIX
                dest = join(installPath, dest)
                return rm(dest, { force: true }).then(() => dest, () => false)
            })
            const main = join(installPath, MAIN)
            await rename(main + DISABLING_POSTFIX, main) // we are good now, restore name
                .catch(e => { throw e.code !== 'ENOENT' ? e : new ApiError(HTTP_NOT_ACCEPTABLE, "missing main file") })
            return folder
        }
    }
    finally {
        downloadProgress(repo, undefined)
    }
}

export function getRepoInfo(id: string) {
    return apiGithub('repos/'+id)
}

export function readGithubFile(uri: string) {
    return httpString('https://raw.githubusercontent.com/' + uri)
        .then(res => res.body)
}

export async function readOnlinePlugin(repo: Repo, branch='') {
    if (typeof repo !== 'string') { // non-github plugin
        const folder = _.findKey(getFolder2repo(), x => x === repo)
        if (!folder) throw Error()
        const pl = getPluginInfo(folder)
        let { main } = pl.repo
        if (!main) throw Error("missing repo.main")
        if (!main.includes('//'))
            main = pl.repo.web + main
        const res = await httpString(main)
        if (!res.ok) throw Error("bad repo.main")
        return parsePluginSource(main, res.body) // use 'repo' as 'id' client-side
    }
    branch ||= await getGithubDefaultBranch(repo)
    const res = await readGithubFile(`${repo}/${branch}/${DIST_ROOT}/plugin.js`)
    if (!res) throw Error("missing plugin.js")
    const pl = parsePluginSource(repo, res) // use 'repo' as 'id' client-side
    pl.branch = branch
    return pl
}

export function getFolder2repo() {
    const ret = Object.fromEntries(getAvailablePlugins().map(x => [x.id, x.repo]))
    Object.assign(ret, Object.fromEntries(mapPlugins(x => [x.id, x.getData().repo])))
    return ret
}

async function apiGithub(uri: string) {
    try {
        const res = await httpString('https://api.github.com/'+uri, {
            headers: {
                'User-Agent': 'HFS',
                Accept: 'application/vnd.github.v3+json',
            }
        })
        if (!res.ok)
            throw res.statusCode
        return JSON.parse(res.body)
    }
    catch(e: any) {
        // https://docs.github.com/en/rest/overview/resources-in-the-rest-api?apiVersion=2022-11-28#rate-limiting
        throw e.message === '403' ? Error('github_quota')
            : e
    }
}

export async function searchPlugins(text='') {
    const projectInfo = await getProjectInfo()
    const list = await apiGithub('search/repositories?q=topic:hfs-plugin+' + encodeURI(text))
    return new AsapStream(list.items.map(async (it: any) => {
        const repo = it.full_name as string
        if (projectInfo?.plugins_blacklist?.includes(repo)) return
        let pl = await readOnlinePlugin(repo, it.default_branch)
        if (!pl?.apiRequired) return // mandatory field
        if (pl.badApi) { // we try other branches (starting with 'api')
            const res = await apiGithub('repos/' + repo + '/branches')
            const branches: string[] = res.map((x: any) => x?.name)
                .filter((x: any) => typeof x === 'string' && x.startsWith('api'))
                .sort().reverse()
            for (const branch of branches) {
                pl = await readOnlinePlugin(repo, branch)
                if (!pl) continue
                if (!pl.apiRequired)
                    pl.badApi = '-'
                if (!pl.badApi)
                    break
            }
        }
        if (!pl || pl.badApi)
            return
        Object.assign(pl, { // inject some extra useful fields
            downloading: downloading[repo],
            license: it.license?.spdx_id,
        }, _.pick(it, ['pushed_at', 'stargazers_count', 'default_branch']))
        return pl
    }))
}

// centralized hosted information, to be used as little as possible
let cache
const FN = 'central.json'
let latest = JSON.parse(readFileSync(join(__dirname, '..', FN), 'utf8')) // initially built-in is our latest
export function getProjectInfo() {
    return cache ||= readGithubFile(HFS_REPO + '/main/' + FN)
        .catch(() => latest) // fall back to latest
        .then(x => {
            if (!x) throw x // go catch
            setTimeout(() => cache = undefined, DAY) // invalidate cache
            return latest = JSON.parse(x)
        }).catch(() => { // schedule next attempt
            setTimeout(() => cache = undefined, 10_000) // invalidate cache sooner on errors
            return latest
        })
}