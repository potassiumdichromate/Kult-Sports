# Kult Sports

The Kult Sports web game: an isometric pixel-art football analysis agency.
Your AI Arena agent is the CEO, analysts read every match, and real results
score points on the weekly and all-time leaderboards. It is built on the
Pixel Agency API (repo: potassiumdichromate/Kult-League) following
[docs/KULT_SPORTS_FRONTEND_BRIEF.md](docs/KULT_SPORTS_FRONTEND_BRIEF.md),
and shares its office look with Kult Create (recoloured for the pitch).

No framework: plain HTML, CSS and ES modules in `public/`, served by a small
Node server (`server.mjs`, no dependencies). The only build step is the Privy
login bundle.

## Run it

```bash
npm install --include=dev
npm run build          # Privy login bundle -> public/privy/
npm start              # http://localhost:4400
```

- **Demo, no account:** <http://localhost:4400/?demo=1> (an in-memory copy of
  the API with a founded agency) or `?demo=fresh` (starts at "Found your
  agency").
- **Real account:** open `/?jwt=<AI Arena token>` like the Kult browser does,
  or paste a token in the developer field on the entrance (shown on localhost
  and with `?dev=1`).

Locally, `/api/*` is forwarded to the API, so no CORS setup is needed.

## How it fits together

| Path | What |
|---|---|
| `/` | The game (`public/`) |
| `/config.json` | Public settings for the page: API address, Privy app id |
| `/arena/auth/privy` | Forwards a Privy access token to AI Arena's `POST /v1/auth/privy` and returns its AI Arena token. AI Arena's gateway only accepts browser calls from its own site, so this runs server to server. |
| `/api/*` | Forwards to the API (local development) |
| `/health` | Health check |

**Sign-in:**
1. **Kult browser:** the game opens with `?jwt=<AI Arena token>`. The page
   removes it from the address bar at once and calls `POST /v1/auth/session`.
2. **Privy (opened directly):** the same login as Kult Create and Creator
   Studio. The Privy access token becomes an AI Arena token through
   `/arena/auth/privy`, then a game session.

The session token is kept in `sessionStorage` (12 hours). On a `401` the game
renews it through Privy if it can; otherwise it asks the player to sign in
again.

## Deploy

`render.yaml` defines the `kult-sports` web service (Render Blueprint). After
the first deploy:

1. Set `PRIVY_APP_ID` on the service (the shared KULT Privy app).
2. Add the service URL (e.g. `https://kult-sports.onrender.com`) to
   `CORS_ORIGINS` on `pixel-agency-api`.
3. Add the same URL as an allowed origin in the Privy dashboard.
4. Open it from the Kult browser with `?jwt=…`, or directly with Privy.

## Configuration

| Variable | Default | |
|---|---|---|
| `PUBLIC_API_URL` | (unset: use `/api`) | Production: `https://pixel-agency-api.onrender.com`. Browsers call it directly, so the API's per-IP rate limit applies per player. **The API's `CORS_ORIGINS` must include this site's origin.** |
| `API_URL` | `https://pixel-agency-api.onrender.com` | Target of the `/api` forwarding |
| `AI_ARENA_API_URL` | `https://aiarena-gateway.kult.games` | AI Arena gateway, for the Privy exchange |
| `PRIVY_APP_ID` | (unset: Privy login hidden) | The shared KULT Privy app, the one AI Arena verifies |
| `PRIVY_CLIENT_ID` | | Optional Privy client id |
| `AI_ARENA_APP_URL` | `https://app.kult.games` | "Create an agent" link |
| `FRAME_ANCESTORS` | (unset) | Optional CSP `frame-ancestors` value |
| `PORT` | `4400` | |

The Privy dashboard must list this site's origin as allowed.

## Files

| File | |
|---|---|
| `public/js/app.js` | Sign-in, the office, flows (analysis show, picks, hiring) |
| `public/js/views.js` | Screens: matches, match room and pick editor, talent, history, leaderboards, agency, analyst card |
| `public/js/world.js` | The isometric office renderer (desks follow the agency level, the pitch rug, the match screen, the KULT SPORTS neon sign) |
| `public/js/api.js` | API client |
| `public/js/demo.js` | The offline demo API |
| `public/art/` | Office art (from Kult Create); `node scripts/recolor.mjs` recolours the room from `art-source/` |
| `privy-login/` | The Privy login bundle source |
