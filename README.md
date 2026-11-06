# Kult Sports

The Kult Sports web game: a glowing 3D isometric football analysis agency.
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
npm run build          # Privy and Minds login bundles -> public/privy/, public/minds/
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
| `/pm/gamma/*`, `/pm/clob/prices-history`, `/pm/data/*` | Polymarket's public, read-only market data (search, markets, comments, price history, positions, trades), GET only and cached 20 s, so the board loads on networks that can't reach Polymarket. Funding and trading never pass through here. |
| `/arena/polymarket/*`, `/arena/league/leaderboard`, `/arena/f1/drivers` | AI Arena: your CEO's market reads, the deposit-wallet relayer, top agents, F1 drivers |
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
| `DEMO_MODE` | (unset) | `1` (or `fresh`) sends every visitor to the offline demo, `?demo=1` (or `?demo=fresh`); `?demo=0` still opens the real game |
| `MINDS_CLIENT_ID` | (unset: "Your Mind" hidden) | Hello Minds OAuth client id (public), for letting a player's Mind direct their agency. Register `https://<this site>/minds/callback` as its redirect URI and this site as an authorized origin, with scopes `email` and `minds:list`. |
| `AI_ARENA_APP_URL` | `https://app.kult.games` | "Create an agent" link |
| `POLYMARKET_BUILDER_CODE` | (unset) | Polymarket Builder Code (public bytes32) attached to orders and bridge deposits; the old Kult browser's `VITE_POLYMARKET_BUILDER_CODE` |
| `FRAME_ANCESTORS` | (unset) | Optional CSP `frame-ancestors` value |
| `PORT` | `4400` | |

The Privy dashboard must list this site's origin as allowed.

## Files

| File | |
|---|---|
| `public/js/app.js` | Sign-in, the office, flows (analysis show, picks, hiring) |
| `public/js/views.js` | Screens: matches, match room and pick editor, talent, history, leaderboards, agency, analyst card |
| `public/js/world.js` | The 3D office (desks follow the agency level, the pitch rug, the match screen, the KULT SPORTS neon sign, + Hire tags) |
| `public/js/office3d.js` | The three.js office scene, a copy of Kult Create's; keep the two in sync |
| `public/models/` | The CEO models, one per AI Arena archetype (from Kult World) |
| `public/js/api.js` | API client |
| `public/js/demo.js` | The offline demo API |
| `public/art/` | The old pixel-art office, no longer used by the 3D office |
| `public/js/polymarket.js` | The Polymarket board (Football: live market, match pulse, analysis; Formula 1), wallet, fund and withdraw |
| `polymarket-island/` | The Polymarket bundle source (`npm run build:polymarket`): markets, the deposit wallet, CLOB trading, bridge, withdrawals, ported from the old Kult browser |
| `privy-login/` | The Privy login bundle source |
| `minds-login/` | The Hello Minds sign-in bundle source (Minds Connect) |
| `scripts/import-icons.mjs` | Imports the icon sheet (a 3x3 ChatGPT sheet: office, matches, talent, history, leaders, agency, emblem, whistle, stopwatch) into `public/art/icon-*.png`: `node scripts/import-icons.mjs path/to/sports-ui.png`. The UI now uses the line icons in `public/js/ui.js` instead |

## Your Mind directs

A player can let their Hello Minds agent run the agency (Pixel Agency docs: "Mind directors"). On the Agency screen, **Let your Mind direct** signs the player in with Minds; Hello Minds returns to `/minds/callback`, which `server.mjs` redirects to the game page with the OAuth code. The game then links the Mind (`POST /v1/agency/mind`) and shows a director key once, with a message for the player to send their Mind: it points the Mind at the director spec (`directorSpecUrl` in `/config.json`) so it builds its own Skill. History marks the picks the Mind made. When the player's AI Arena login is still fresh, the same Mind is also linked to the agency's CEO agent in AI Arena (`/arena/minds/link`, forwarded by `server.mjs`): the player then gets one KULT key that directs the agency and lets the Mind talk, negotiate and build relationships as that agent (`mindApiSpecUrl` in `/config.json`).

## Polymarket

The Polymarket tab is the old Kult browser's League → Polymarket board, in the
Kult Sports design. KULT is a signal layer only: Polymarket runs the markets,
custody and settlement.

- **Football:** the featured event (outcomes, a week of price history, live
  chat), the Premier League hero, the next match with one-tap Yes/No, every
  open football question with its stake, Buy Yes/No, your position and your
  CEO's read. **Match Pulse** shows the agency's own fixtures (the old board's
  World Cup API, worldcup26.ir, is gone) and football news. **Analysis**: the
  live price chart, trending movers, top League agents, real recent trades,
  resolved markets, news and your positions.
- **Formula 1:** markets grouped by event, driver rows, a shared trade amount,
  "view all" with search.
- **Trading** uses the player's Privy wallet on Polygon through their own
  Polymarket deposit wallet: switch to Polygon, deploy the deposit wallet, wrap
  USDC.e into pUSD, approve the exchanges (one signed batch through AI Arena's
  relayer), then a market order on the CLOB. **Fund wallet** gives Polymarket
  bridge deposit addresses for EVM chains, Solana, Bitcoin and Tron;
  **Withdraw** sends pUSD to any Polygon address with one signature.
- **Your CEO's read** is AI Arena's market signal for the agency's CEO agent.
