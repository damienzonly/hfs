import Koa from 'koa'
import serve from 'koa-static'
import send from 'koa-send'
import mount from 'koa-mount'
import apis from './apis'

const srv = new Koa()
srv.use(preventCrossDir())
srv.use(serveRoot())
srv.use(mount('/~/api/', api(apis)))
srv.use(mount('/~/', serve('frontend')))

srv.on('error', err => console.error('server error', err))
srv.listen(80, ()=> console.log('running',new Date().toLocaleString()))

function preventCrossDir() : Koa.Middleware {
    return async (ctx, next) => {
        // @ts-ignore
        ctx.assert(!ctx.originalUrl.includes('..'), 400, 'cross-dir');
        await next()
    }
}

function serveRoot() : Koa.Middleware {
    return async (ctx, next) => {
        if (ctx.method === 'GET' && ctx.path === '/')
            await send(ctx, 'frontend/index.html')
        await next()
   }
}

type ApiHandler = (ctx:any) => any
type ApiHandlers = Record<string, ApiHandler>

function api(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx, next) => {
        console.log('API',ctx.method, ctx.path)
        // @ts-ignore
        ctx.assert(ctx.path in apis, 404, 'invalid api')
        const cb = (apis as any)[ctx.path]
        const res = await cb(ctx)
        if (res)
            ctx.body = res
        await next()
    }
}
