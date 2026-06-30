# Cloudflare Trip Service Design

Date: 2026-07-01
Status: Approved design, pending implementation plan

## Context

The repository is currently a Vite React dashboard with a single seeded trip document and browser-local persistence. The existing UI already models the main product concepts: itinerary, stay, meals, activities, expenses, families, locations, routes, tasks, page notes, entity notes, map state, timeline state, export, search, weather, and Google Maps/Places enrichment.

The goal is to turn that fork into a usable hosted service on Cloudflare while preserving the dense Palantir-style dashboard described in `DESIGN.md`.

## Goals

- Convert the app to strict TypeScript.
- Run the service on Cloudflare Pages, Workers, Durable Objects, and D1.
- Support Google login.
- Support multiple trips per user.
- Create new trips from the current dashboard template.
- Let invited members edit only trips they belong to.
- Support full CRUD for core trip entities.
- Provide copyable invite links in v1.
- Provide sanitized public read-only share links.
- Support true real-time collaboration for open trip workspaces.
- Store trip history as event-sourced patches with snapshots.

## Non-Goals

- No email sending in v1. Invite links are copyable URLs.
- No per-field family-scoped permissions in v1. Membership is trip-scoped.
- No full relational decomposition of every trip entity in v1.
- No billing, organizations, or enterprise administration.
- No mobile-first redesign. The dashboard remains optimized for large dense displays.

## Selected Approach

Use an event-sourced trip document model:

- `TripDocument` remains the canonical application state shape.
- D1 stores users, sessions, trips, memberships, invites, share links, snapshots, and ordered trip events.
- A Durable Object instance per trip validates membership, sequences edits, applies events, broadcasts WebSocket updates, and writes events/snapshots back to D1.
- The React app reads and edits through typed API and WebSocket commands, not direct document writes.

This keeps the current single-document UI model intact while adding multi-trip persistence, access control, real-time collaboration, audit history, and future undo/replay options.

## Cloudflare Stack

- Cloudflare Pages serves the built React app.
- A Cloudflare Worker handles API routes, D1 access, Google auth callbacks, and Durable Object routing.
- Cloudflare D1 is the durable relational database.
- Cloudflare Durable Objects provide one live collaboration room per trip.
- Durable Object WebSockets provide real-time updates.
- Google OpenID Connect provides sign-in.

Official references used for platform assumptions:

- Cloudflare D1 Worker API: https://developers.cloudflare.com/d1/worker-api/
- Cloudflare Durable Object WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Pages bindings: https://developers.cloudflare.com/pages/functions/bindings/
- Google OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect

## Product Flows

### Login

Users sign in with Google. The auth callback verifies the Google identity token, upserts a user, creates a server-side session, and sets an HTTP-only secure cookie.

### Trip List

After login, `/trips` lists trips where the user has a membership. Users can create a new trip from the current seeded template. The creator becomes the trip owner.

### Trip Workspace

`/trips/:tripId` loads the latest snapshot plus subsequent events, then connects to the trip Durable Object. Members can create, update, and delete trip entities. Edits are accepted only if the user is a member of that trip.

### Invites

Owners create copyable invite links. Invite tokens are stored hashed in D1. Accepting an invite while signed in creates a membership for that trip only.

### Public Share

`/share/:token` serves a read-only dashboard projection. It uses the sanitizer pattern already present in `projectTripDocument`: no Wi-Fi, lock/access notes, exact private lodging details, private notes, or other sensitive fields.

## Access Model

Roles:

- `owner`: can edit the trip, manage invite links, manage share links, and archive the trip.
- `editor`: can edit the trip but cannot manage access.
- Public share viewers: can only read the sanitized projection.

Access rules:

- Users can list only trips where they have membership.
- Users can open/edit only trips where they have membership.
- Invites grant membership only to the linked trip.
- Share links never grant edit access.
- Unknown, expired, disabled, or mismatched tokens return `404`.
- Authenticated but unauthorized access returns `403`.

## D1 Data Model

`users`

- `id`
- `google_sub`
- `email`
- `name`
- `avatar_url`
- `created_at`
- `updated_at`

`sessions`

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `created_at`

`trips`

- `id`
- `title`
- `slug`
- `owner_user_id`
- `current_version`
- `latest_snapshot_id`
- `archived_at`
- `created_at`
- `updated_at`

`memberships`

- `trip_id`
- `user_id`
- `role`
- `created_at`

`invites`

- `id`
- `trip_id`
- `token_hash`
- `role`
- `email`
- `expires_at`
- `accepted_by_user_id`
- `accepted_at`
- `created_by_user_id`
- `created_at`

`share_links`

- `id`
- `trip_id`
- `token_hash`
- `enabled`
- `policy`
- `created_by_user_id`
- `created_at`
- `updated_at`

`trip_snapshots`

- `id`
- `trip_id`
- `version`
- `document_json`
- `created_by_user_id`
- `created_at`

`trip_events`

- `id`
- `trip_id`
- `version`
- `previous_version`
- `actor_user_id`
- `type`
- `payload_json`
- `created_at`

## Trip Document Types

Define a strict `TripDocument` TypeScript type and entity unions for:

- `family`
- `location`
- `route`
- `itineraryItem`
- `meal`
- `activity`
- `stayItem`
- `expense`
- `task`

Existing helper functions should move from `tripModel.js` into typed modules. UI props should reference these shared types rather than re-declaring shapes inside components.

## Event Types

The event union should stay small:

- `entity.create`
- `entity.update`
- `entity.delete`
- `pageNote.update`
- `uiState.update`
- `trip.meta.update`

Each event includes:

- `tripId`
- `version`
- `previousVersion`
- `actorUserId`
- `createdAt`
- typed payload

The reducer applies events to a `TripDocument`. It is pure and unit-tested.

## Durable Object Behavior

Each trip maps to one Durable Object room.

On connect:

- Validate the session.
- Check trip membership.
- Load latest snapshot plus later events if not already hydrated.
- Send the current document and version to the client.

On command:

- Validate the command shape.
- Verify membership and role.
- Reject stale base versions with current version and document.
- Apply the command through the reducer.
- Insert one `trip_events` row.
- Update `trips.current_version`.
- Broadcast the accepted event and new version.
- Snapshot every fixed interval or fixed event count.

On reconnect:

- Client reconnects to the same room.
- Room sends current document and version.
- Client replaces local state if behind.

## Frontend Changes

Routes:

- `/login`
- `/trips`
- `/trips/:tripId`
- `/share/:token`

New UI surfaces:

- Trip list screen.
- Create-from-template action.
- In-trip settings panel for members, invite links, share link, and trip metadata.
- Read-only state for share views.

Refactors:

- Rename `.js`/`.jsx` files to `.ts`/`.tsx`.
- Extract shared trip types and reducers.
- Replace `usePersistedTripState` with `useTripRoom(tripId)`.
- Keep local storage only for harmless UI preferences.
- Preserve `DESIGN.md`: compact, dark, semantic colors, high information density, mono numerics.

## API Shape

Minimum API routes:

- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/trips`
- `POST /api/trips`
- `GET /api/trips/:tripId`
- `POST /api/trips/:tripId/invites`
- `POST /api/invites/:token/accept`
- `POST /api/trips/:tripId/share-link`
- `DELETE /api/trips/:tripId/share-link`
- `GET /api/share/:token`
- `GET /api/trips/:tripId/live` for WebSocket upgrade

The API returns JSON envelopes with `ok`, `data`, and `error` fields.

## Error Handling

- Unauthenticated API access returns `401`.
- Authenticated non-member access returns `403`.
- Missing trips, disabled shares, expired invites, and unknown tokens return `404`.
- Stale edit commands return `409` with the current version and document.
- Invalid payloads return `400`.
- Unexpected server errors return `500` without leaking secrets.
- Public share responses always pass through the sanitizer.

## Testing

Required checks:

- `tsc --noEmit` for strict TypeScript.
- Unit tests for event reducer behavior.
- Unit tests for public sanitizer.
- Unit tests for session and invite token hashing.
- D1 migration smoke test with local Wrangler.
- Durable Object tests for membership checks, version ordering, stale edit rejection, and broadcast.
- Frontend smoke test for login, trips list, trip workspace, and public share route.
- Manual Cloudflare deployment check after secrets and bindings are configured.

## Rollout Plan

1. Add strict TypeScript configuration and convert shared trip model/types first.
2. Add D1 schema and local Wrangler configuration.
3. Implement auth/session primitives.
4. Implement trip creation from template and trip list.
5. Implement event reducer and snapshot replay.
6. Implement Durable Object trip room.
7. Wire the existing dashboard to `useTripRoom`.
8. Add CRUD controls for all core entities.
9. Add invite link and share link screens.
10. Add tests and deployment documentation.

## Implementation Constants

- Snapshot cadence should start simple: every 25 accepted events.
- Invite links should default to 14-day expiration.
- Public share links should be rotatable by owners.
- Stale edit conflicts should prefer replacing client state over complex merges in v1.
- Email invite sending can be added later without changing the invite table.
