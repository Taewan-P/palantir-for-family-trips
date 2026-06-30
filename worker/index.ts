import { buildGoogleAuthUrl, clearSessionCookie } from './auth'
import type { Env } from './env'
import { jsonError, jsonOk, redirect } from './http'
export { TripRoom } from './trip-room'

type WorkerApi = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}

function routePath(request: Request): string {
  return new URL(request.url).pathname
}

const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const path = routePath(request)

    if (request.method === 'GET' && path === '/api/auth/google/start') {
      const state = crypto.randomUUID()
      return redirect(buildGoogleAuthUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: env.GOOGLE_REDIRECT_URI,
        state,
      }))
    }

    if (request.method === 'POST' && path === '/api/auth/logout') {
      return jsonOk({ loggedOut: true }, {
        headers: { 'set-cookie': clearSessionCookie(env.SESSION_COOKIE_NAME) },
      })
    }

    if (request.method === 'GET' && path === '/api/me') {
      return jsonError(401, 'unauthorized', 'Sign in required')
    }

    return jsonError(404, 'not_found', 'Route not found')
  },
} satisfies ExportedHandler<Env> & WorkerApi

export default worker
