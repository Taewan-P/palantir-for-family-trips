export type Env = {
  DB: D1Database
  TRIP_ROOM: DurableObjectNamespace
  APP_ORIGIN: string
  GOOGLE_REDIRECT_URI: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
  SESSION_COOKIE_NAME: string
}

export type AuthenticatedUser = {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}
