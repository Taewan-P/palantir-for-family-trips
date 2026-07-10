# Cloudflare Deployment

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend:

```bash
npm run dev
```

Run the Worker:

```bash
npm run dev:worker
```

For local auth/share-link smoke tests, create an ignored `.dev.vars` file:

```bash
APP_ORIGIN=http://localhost:5173
GOOGLE_CLIENT_ID=local-dev-client
GOOGLE_CLIENT_SECRET=local-dev-secret
SESSION_SECRET=local-dev-secret
```

For local Google OAuth, add this redirect URI to the OAuth client:

```text
http://localhost:5173/api/auth/google/callback
```

Apply D1 migrations locally:

```bash
npx wrangler d1 migrations apply family-trip-command-center --local
```

The production D1 database is `family-trip-command-center`; its UUID is committed in `wrangler.toml`. Apply migrations remotely before the first production deploy and after future schema changes:

```bash
npx wrangler d1 migrations apply family-trip-command-center --remote
```

## Required Worker Variables

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put SESSION_SECRET
```

`APP_ORIGIN` is a non-secret Worker variable in `wrangler.toml` and is set to `https://travelops.chungjungsoo.dev`.

The Worker route in `wrangler.toml` sends production API and WebSocket traffic to the Worker:

```text
https://travelops.chungjungsoo.dev/api/*
```

Configure this production Google OAuth redirect URI:

```text
https://travelops.chungjungsoo.dev/api/auth/google/callback
```

The Pages frontend should use the custom domain `travelops.chungjungsoo.dev`. The committed `public/_redirects` file rewrites app routes such as `/trips`, `/invites/:token`, and `/share/:token` back to `index.html` for client-side routing.

For a new Worker, deploy once before listing or setting secrets:

```bash
npm run cf:deploy
wrangler secret bulk /path/to/worker-secrets.env
```

The secrets file should include only:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...
```

## Checks

```bash
npm run cf:build
```

## Deploy

Deploy the Worker:

```bash
npm run cf:deploy
```

Deploy the Pages frontend:

```bash
npm run cf:deploy:pages
```

The Cloudflare Pages project is `travelops`. It is available at `https://travelops.pages.dev` after a deployment, but login/API calls are production-ready only after the custom domain is attached.

Attach the custom domain in Cloudflare dashboard:

1. Workers & Pages > `travelops` > Custom domains.
2. Set up `travelops.chungjungsoo.dev`.
3. Add or validate this DNS record if Cloudflare does not create it automatically:

```text
Type: CNAME
Name: travelops
Target: travelops.pages.dev
Proxy: on
```

For Git-based Pages deploys, use:

- Build command: `npm run build`
- Output directory: `dist`
