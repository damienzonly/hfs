import Koa from 'koa'
import {
    getNodeName, nodeIsDirectory, nodeIsLink, statusCodeForMissingPerm, urlToNode, vfs, VfsNode, walkNode
} from './vfs'
import {
    HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_METHOD_NOT_ALLOWED, HTTP_NOT_FOUND, HTTP_SERVER_ERROR,
    pathEncode, prefix
} from './cross'
import { PassThrough } from 'stream'
import { mkdir, stat } from 'fs/promises'
import { isValidFileName } from './misc'
import { join } from 'path'

export async function handledWebdav(ctx: Koa.Context, node?: VfsNode) {
    ctx.set('DAV', '1,2')
    ctx.set('Allow', 'PROPPATCH,PROPFIND,OPTIONS,DELETE,UNLOCK,COPY,LOCK,MOVE')
    ctx.set('WWW-Authenticate', `Basic realm="${pathEncode(ctx.path)}"`)
    isWebDav(Boolean(ctx.get('user-agent').match(/webdav/i)))
    if (ctx.method === 'OPTIONS') {
        isWebDav()
        ctx.body = ''
        return true
    }
    if (ctx.method === 'MKCOL') {
        if (node)
            return ctx.status = HTTP_METHOD_NOT_ALLOWED
        let name = ''
        const parentNode = await urlToNode(ctx.path, ctx, vfs, v => name = v)
        if (!parentNode)
            return ctx.status = HTTP_NOT_FOUND
        if (!isValidFileName(name))
            return ctx.status = HTTP_BAD_REQUEST
        if (statusCodeForMissingPerm(parentNode, 'can_upload', ctx))
            return true
        try {
            await mkdir(join(parentNode.source!, name))
            return ctx.status = HTTP_CREATED
        }
        catch(e:any) {
            return ctx.status = HTTP_SERVER_ERROR
        }
    }
    if (ctx.method === 'PROPFIND') {
        if (!node) return
        isWebDav()
        //console.debug(ctx.req.headers, await stream2string(ctx.req))
        const d = ctx.get('depth')
        const isList = d !== '0'
        if (statusCodeForMissingPerm(node, isList ? 'can_list' : 'can_see', ctx))
            return true
        ctx.type = 'xml'
        ctx.status = 207
        let {path} = ctx
        if (!path.endsWith('/'))
            path += '/'
        const res = ctx.body = new PassThrough({ encoding: 'utf8' })
        res.write(`<?xml version="1.0" encoding="utf-8" ?><multistatus xmlns:D="DAV:">`)
        await sendEntry(node)
        if (isList) {
            for await (const n of walkNode(node, { ctx, depth: Number(d) - 1 }))
                await sendEntry(n, true)
        }
        res.write(`</multistatus>`)
        res.end()
        return true

        async function sendEntry(node: VfsNode, append=false) {
            if (nodeIsLink(node)) return
            const name = getNodeName(node)
            const isDir = await nodeIsDirectory(node)
            const st = node.stats ??= node.source ? await stat(node.source) : undefined
            res.write(`<response>
              <href>${path + (append ? pathEncode(name, true) + (isDir ? '/' : '') : '')}</href>
              <propstat>
                <status>HTTP/1.1 200 OK</status>
                <prop>
                    ${prefix('<getlastmodified>', (st?.mtime as any)?.toGMTString(), '</getlastmodified>')}
                    ${prefix('<creationdate>', (st?.birthtime || st?.ctime)?.toISOString().replace(/\..*/, '-00:00'), '</creationdate>')}
                    ${isDir ? '<resourcetype><collection/></resourcetype>'
                : `<resourcetype/><getcontentlength>${st?.size}</getcontentlength>`}
                </prop>
              </propstat>
              </response>
            `)
        }
    }

    function isWebDav(x=true) {
        if (ctx.session)
            ctx.session.webdav ||= x
        if (x && !ctx.headerSent)
            ctx.set('WWW-Authenticate', 'Basic')
    }

}
