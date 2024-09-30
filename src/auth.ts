import { Account, getAccount, normalizeUsername, updateAccount } from './perm'
import { HTTP_NOT_ACCEPTABLE, HTTP_SERVER_ERROR } from './cross-const'
import { SRPParameters, SRPRoutines, SRPServerSession } from 'tssrp6a'
import { Context } from 'koa'
import { srpClientPart } from './srp'
import { CFG, DAY, getOrSet } from './cross'
import { createHash } from 'node:crypto'
import events from './events'

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())

export async function srpServerStep1(account: Account) {
    if (!account.srp)
        throw HTTP_NOT_ACCEPTABLE
    const [salt, verifier] = account.srp.split('|')
    if (!salt || !verifier)
        throw Error("malformed account")
    const srpSession = new SRPServerSession(srp6aNimbusRoutines)
    const srpServer = await srpSession.step1(account.username, BigInt(salt), BigInt(verifier))
    return { srpServer, salt, pubKey: String(srpServer.B) } // cast to string cause bigint can't be jsonized
}

const cache: any = {}
export async function srpCheck(username: string, password: string) {
    const account = getAccount(username)
    if (!account?.srp || !password) return
    const k = createHash('sha256').update(username + password + account.srp).digest("hex")
    const good = await getOrSet(cache, k, async () => {
        const { srpServer, salt, pubKey } = await srpServerStep1(account)
        const client = await srpClientPart(username, password, salt, pubKey)
        setTimeout(() => delete cache[k], 60_000)
        return srpServer.step2(client.A, client.M1).then(() => 1, () => 0)
    })
    return good ? account : undefined
}

export function getCurrentUsername(ctx: Context): string {
    return ctx.state.account?.username || ''
}

// centralized log-in state
export async function setLoggedIn(ctx: Context, username: string | false) {
    const s = ctx.session
    if (!s)
        return ctx.throw(HTTP_SERVER_ERROR,'session')
    if (username === false) {
        events.emit('logout', ctx)
        delete s.username
        return
    }
    const a = ctx.state.account = getAccount(username)
    if (!a) return
    s.username = normalizeUsername(username)
    s.ts = Date.now()
    const k = CFG.allow_session_ip_change
    s[k] = Boolean(ctx.state.params[k])
    if (!a.expire && a.days_to_live)
        updateAccount(a, { expire: new Date(Date.now() + a.days_to_live! * DAY) })
    await events.emitAsync('login', ctx)
}

// since session are currently stored in cookies, we need to store this information
export const invalidateSessionBefore = new Map<string, number>()
