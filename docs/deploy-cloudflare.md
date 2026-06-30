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

Apply D1 migrations locally:

```bash
npx wrangler d1 migrations apply family-trip-command-center --local
```

## Required Secrets

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put SESSION_SECRET
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

Deploy the Pages frontend from the Cloudflare dashboard or connected Git repository with:

- Build command: `npm run build`
- Output directory: `dist`
