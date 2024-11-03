import { dirname } from 'path'
import { existsSync, statfsSync } from 'fs'
import { exec, ExecOptions } from 'child_process'
import { onlyTruthy } from './misc'
import Parser from '@gregoranders/csv';
import { pid } from 'node:process'
import { promisify } from 'util'
import { IS_WINDOWS } from './const'

const DF_TIMEOUT = 2000

export function getDiskSpaceSync(path: string) {
    while (path && !existsSync(path))
        path = dirname(path)
    const res = statfsSync(path)
    return { free: res.bavail * res.bsize, total: res.blocks * res.bsize, name: path }
}

export function bashEscape(par: string) {
    return `'${par.replaceAll(/(["'$`\\])/g, "\\$1")}'`
}

export function cmdEscape(par: string) {
    return `"${par.replaceAll('"', '\\"')}"`
}

export async function getDiskSpace(path: string) {
    while (path && !existsSync(path))
        path = dirname(path)
    const res = statfsSync(path)
    return { free: res.bavail * res.bsize, total: res.blocks * res.bsize, name: path }
}

export async function getDiskSpaces(): Promise<{ name: string, free: number, total: number, description?: string }[]> {
    if (IS_WINDOWS) {
        const drives = await getDrives()
        return onlyTruthy(await Promise.all(drives.map(getDiskSpace)))
    }
    return parseDfResult(await promisify(exec)(`df -k`, { timeout: DF_TIMEOUT }).then(x => x.stdout, e => e))
}

function parseDfResult(result: string | Error) {
    if (result instanceof Error) {
        const { status } = result as any
        throw status === 1 ? Error('miss') : status === 127 ? Error('unsupported') : result
    }
    const out = result.split('\n')
    if (!out.shift()?.startsWith('Filesystem'))
        throw Error('unsupported')
    return onlyTruthy(out.map(one => {
        const bits = one.split(/\s+/)
        if (bits[0] === 'tempfs') return
        const name = bits.pop() || ''
        if (/^\/(dev|sys|run|System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware))\b/.test(name)) return
        const [used=0, free=0] = bits.map(x => Number(x) * 1024).slice(2)
        const total = used + free
        return total && { free, total, name }
    }))
}

export async function getDrives() {
    const res = await runCmd('fsutil fsinfo drives') // example output: `Drives: C:\ D:\ Z:\`
    return res.trim().replaceAll('\\', '').split(' ').slice(1)
}

// execute win32 shell commands
export async function runCmd(cmd: string, args: string[] = [], options: ExecOptions = {}) {
    const line = `@chcp 65001 >nul & cmd /c ${cmd} ${args.map(x => x.includes(' ') ? `"${x}"` : x).join(' ')}`
    const { stdout, stderr } = await promisify(exec)(line, { encoding: 'utf-8', ...options })
    return (stderr || stdout).replace(/\r/g, '')
}

async function getWindowsServicePids() {
    const res = await runCmd('tasklist /svc /fo csv')
    const parsed = new Parser().parse(res)
    return parsed.slice(1).map(x => Number(x[1]))
}

export const RUNNING_AS_SERVICE = IS_WINDOWS && getWindowsServicePids().then(x => x.includes(pid), e => {
    console.log("couldn't determine if we are running as a service")
    console.debug(e)
})
