# Family Trip Command Center

> A Palantir-ish dashboard for a very non-Palantir problem: getting a few families to Pine Mountain Lake and Yosemite without losing the plot.

Instead of a normal trip planner, this repo treats a long weekend like an operation: convoy routes, arrival windows, mission launches, meal logistics, family checklists, and a giant map that makes everything feel more serious than it needs to be.

![Family Trip Command Center dashboard overview](docs/dashboard-overview.png)

## What It Does

- Tracks multiple families arriving from different cities.
- Simulates driving routes, convoy departures, and day-by-day timeline playback.
- Organizes the trip into itinerary, stay, meals, activities, expenses, and family views.
- Presents the whole thing as a dark, command-center-style dashboard because that is more fun than a spreadsheet.

## Screens

### Mission launch overlay

![Mission launch overlay](docs/mission-launch.png)

### Activity planning surface

![Activity planning screen](docs/activity-board.png)

### Meal logistics surface

![Meal planning screen](docs/meals-planner.png)

## Why This Exists

Because “three families are trying to get to the same cabin” is already a systems problem.

The repo is intentionally overbuilt for a small real-life use case. That is the point. It is a fun UI experiment, a trip-planning toy, and a mildly absurd attempt to make a family weekend feel like a live operations room.

## Stack

- React 19
- Vite
- Google Maps JavaScript API
- Lucide icons
- Framer Motion

## Running It Locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173` or whatever Vite prints.

## Environment

For the full map experience, add a browser Maps key to `.env`:

```bash
VITE_GOOGLE_MAPS_API_KEY=your_browser_maps_key_here
```

Optional:

```bash
VITE_GOOGLE_MAP_ID=your_optional_google_map_id
```

Without a key, the app still renders its UI but the live Google map layer will not fully initialize.

## Cloudflare Service

See [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md) for local Worker, D1, Pages, and deployment steps.

- Google login
- D1-backed trips
- Durable Object real-time editing
- Copyable invite links
- Sanitized public share links

## Data / Privacy

The trip data in this repo is intentionally sanitized for public sharing.

- Family names are demo names.
- The basecamp address is generalized.
- Access instructions, Wi-Fi, host details, and other private trip notes are removed.

If you publish this with your own Google Maps key, usage is billed to your Google Cloud project.

## Repo Notes

- State is stored locally in the browser.
- The project is optimized for desktop and large-screen dashboard vibes.
- The UI intentionally leans dense, dramatic, and slightly over-the-top.

## If You Want To Hack On It

Good places to start:

- `src/App.jsx` for the main shell, timeline, and overlays
- `src/CommandMap.jsx` for route rendering, playback, and map behavior
- `src/tripModel.js` for the seeded trip document and helper logic

## Status

Built for fun. Surprisingly usable. Not pretending to be enterprise software.
