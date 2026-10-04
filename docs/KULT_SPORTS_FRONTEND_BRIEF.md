# Kult Sports — frontend brief

This is a brief for building the Kult Sports web frontend: an isometric, interactive HTML5 game. The backend is live. This document explains what the game is, how the screens and flows work, and the full API.

> Kult Sports was briefly called "Pixel Agency". The API's address and some identifiers still use that name (`pixel-agency-api`, `pixel-agency`). They refer to the same thing.

---

## 1. What Kult Sports is

**Kult Sports is a football prediction management game.** You own a sports analysis agency: an office you can see and walk around in, isometric and pixel-styled. You run it as CEO and compete against every other agency on global leaderboards.

- **Your CEO is your own AI agent.** Players already own AI agents on AI Arena, Kult's agent platform. When you found your agency, you choose one of them to be its CEO. The CEO's name and clan appear throughout the game.
- **You hire analysts.** Each analyst is an AI staff member with one specialty. Each reads the upcoming match through its own lens:

| Specialty | Title in game | What they study | Markets they advise on |
|---|---|---|---|
| `form` | Form Analyst | Recent results, head-to-head | Outcome, Exact score |
| `lineups` | Team News Scout | Injuries, absences | Outcome, Goal scorer |
| `weather` | Weather & Pitch Analyst | Rain, wind, temperature at kickoff | Exact score, Corners |
| `odds` | Market Analyst | Bookmaker prices | Outcome, Exact score |
| `set_pieces` | Set-Piece Coach | Corner trends | Corners |
| `discipline` | Discipline Analyst | Card trends | Cards |
| `scorers` | Striker Scout | Who is likely to score | Goal scorer |

- **The desk analyses a match.**
  - Every analyst reads a real research brief. The briefs come from live data, are written by AI on the 0G network, and use the same match forecast for everyone.
  - Each analyst then recommends picks for their markets. Skill (1–5 stars) decides how sharp their read is.
  - The CEO combines the recommendations into one match analysis and a draft set of picks. Any market that no analyst covers is filled with the CEO's own "gut call".
- **The CEO decides.** You can edit the draft, then lock it. If you don't lock it yourself, it locks automatically 5 minutes before kickoff.
- **Real results score points:**

| Market | What you pick | Exact | Off by one |
|---|---|---|---|
| Outcome | Home / Draw / Away | **5** | — |
| Goals | Exact final score (e.g. 2–1) | **7** | **3.5** if one goal out in total |
| Corners | Total corners | **10** | **5** |
| Cards | Total cards | **10** | **5** |
| Goal scorer | One player to score (anytime) | **20** | — |

  The maximum is **52 points per match**.
- **Points become credits.** Every 0.1 point earns 1 credit, so 52 points pays 520 credits. Credits pay for hiring and for weekly salaries. Analysts gain XP from matches and level up, and higher skill comes with a higher salary.
- **The office grows.** It starts with 3 desks and gains one per agency level, up to 7. Levels are earned by all-time points: 50, 150, 300 and 500.
- **The economy matters.** You start with 1,500 credits. Salaries are paid every Monday, and an analyst you can't afford quits.
- **There are two global leaderboards:** **Weekly** (resets each ISO week, by kickoff date) and **All Time**.
- **The talent pool is weekly.** Each agency sees 10 candidates per week, and every specialty appears at least once. The pool refreshes Monday 00:00 UTC.

### The core loop

```
Sign in ─▶ Found agency (name + pick CEO agent)
              │
              ▼
   ┌──▶ Hire analysts from the weekly talent pool (credits)
   │          │
   │          ▼
   │    Pick an upcoming match ─▶ Run desk analysis ─▶ Read analyst reports
   │          │                                         + CEO's combined analysis
   │          ▼
   │    Edit the draft picks (optional) ─▶ Lock  (or auto-lock at kickoff − 5 min)
   │          │
   │          ▼
   │    Match is played ─▶ Settled: points, credits, analyst XP, leaderboard climb
   │          │
   └──────────┘   (weekly: payroll; level up → more desks)
```

---

## 2. Visual direction

The backend is fully data-driven. Every element below maps to data the API returns.

| Scene element | Driven by |
|---|---|
| The office: its size and number of desks | `agency.level`, `agency.desks` |
| The CEO's corner office or big desk | `agency.ceo.name`, `agency.ceo.clan` (ZEROG, BASE, SOLANA or OKX: a natural theme or color per clan) |
| One analyst character per desk | `agency.staff[]`: `name`, `specialty`, `skill` (stars), `style` (personality flavour, e.g. "wind watcher") |
| Desk props by specialty | `form` → charts wall; `lineups` → clipboard and injury board; `weather` → window and radar; `odds` → ticker screens; `set_pieces` → tactics board; `discipline` → referee cards; `scorers` → shot maps |
| Empty desks | `agency.desks − staff.length`; clicking one opens the talent pool |
| Analysis in progress | While `POST /analysis` runs (it can take a few seconds), analysts "work": typing, papers flying, screens flickering |
| Analysis result | Each analyst presents their report (speech bubble or whiteboard), then the CEO presents the combined picks |
| Gut calls | `combined.markets[m].source === "ceo"`: the CEO "guesses" those markets, for example a dice or coin animation |
| Credits, points, level | HUD: `agency.credits`, `agency.points`, `agency.level`, `agency.nextLevelAt` |
| Match board or TV | `GET /v1/fixtures`: upcoming matches, lock countdowns, your prediction status |
| Trophy wall | Leaderboard rank: `agency.standings.weekly/allTime` |
| Payday | `agency.payroll.nextDueAt` countdown; `weeklyTotal` shown as burn |

---

## 3. Screens

1. **Boot / sign-in**: automatic (see §4). Show a loading state; on failure, a "Open Kult Sports from the Kult browser" message.
2. **Found your agency** (shown only when `agency === null`): agency name input, plus a CEO picker listing the player's `agents`.
3. **Office (home)**: the isometric office. It holds the HUD, staff, empty desks, the match board, and buttons for the leaderboard and ledger.
4. **Talent pool / hiring**: the 10 weekly candidates, with name, title, specialty, stars, style, markets covered, hire cost, weekly salary and a Hire button. It also shows desk availability and credits.
5. **Analyst card**: details, XP progress (`xp / xpToNext`), salary and a Fire button (with confirmation).
6. **Match board**: upcoming fixtures with kickoff time, a lock countdown, open/closed state and your status (none, DRAFT, LOCKED, SETTLED with points).
7. **Match room**: the screen for one fixture.
   - Teams, kickoff, absences and squad.
   - A "Run analysis" button showing `analysesUsed / analysesAllowed`.
   - Analyst reports, the CEO's summary, and the pick editor:
     - outcome toggle
     - score steppers 0–15
     - corners 0–30
     - cards 0–20
     - scorer dropdown from `squad`, plus "No scorer"
   - Lock button and countdown.
   - After the match: the result, a per-market breakdown (EXACT / CLOSE / MISS / VOID) and points earned.
8. **My predictions**: history with points.
9. **Leaderboards**: Weekly and All Time tabs. Highlight "you" (`me`). Show rank, agency name, CEO name and clan, points, exact hits and number of predictions.
10. **Ledger**: credit history (founding grant, hires, salaries, winnings).

---

## 4. Sign-in (important)

Kult Sports runs inside the Kult browser, which opens games with the player's token in the URL:

```
https://<kult-sports-frontend>/?jwt=<AI Arena token>&source=browser
```

The flow:

1. Read `jwt` from the URL. Then remove it from the address bar with `history.replaceState`, so it isn't left in history.
2. Call `POST /v1/auth/session` with `{ "aiArenaToken": "<jwt>" }`.
3. Keep the returned `token` (the game session, valid 12 hours) in memory, or in `sessionStorage` to survive reloads. Send it on every call as `Authorization: Bearer <token>`.
4. The response already contains `player`, `agents` and `agency`. If `agency` is `null`, show "Found your agency"; otherwise go to the office.
5. On any `401` from the API, the session expired: sign in again. If there is no `jwt` left, ask the player to reopen the game from the Kult browser.

**Local development without the Kult browser:** add a dev-only "paste token" field. A token can be copied from a signed-in AI Arena web session.

---

## 5. API

**Base URL:** `https://pixel-agency-api.onrender.com`

- Requests and responses are JSON.
- Times are ISO-8601 UTC strings.
- Points are decimals (e.g. `3.5`). Credits are integers.
- The service runs on Render. If it has been idle, the first request after a pause can take a little longer, so show a loading state.

**CORS:** the API only accepts browser calls from origins listed in its `CORS_ORIGINS` setting.

- Once you know the frontend's production URL, it must be added there. That's a backend setting, not a frontend change.
- In production, only `https` origins are allowed. For local development, use a dev-server proxy, e.g. Vite `server.proxy` from `/api` → `https://pixel-agency-api.onrender.com`, so the browser sees same-origin requests.

### Errors

Every error looks like:

```json
{ "error": "conflict", "message": "predictions for this match are closed", "correlationId": "…" }
```

`message` is safe to show players.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_request` | Invalid input; the message names the problem |
| 401 | `unauthorized` | Not signed in or session expired → sign in again |
| 402 | `insufficient_credits` | Can't afford the hire |
| 403 | `forbidden` | That agent isn't yours |
| 404 | `not_found` | Unknown fixture or analyst, or "create your agency first" |
| 409 | `conflict` | Closed, already locked, desks full, name taken, and similar |
| 429 | `limit_reached` / `rate_limited` | Analysis limit for this match, or too many requests |
| 503 | `upstream_unavailable` | Match data or AI Arena temporarily unreachable → retry later |

### Endpoints

Unless marked public, every endpoint needs `Authorization: Bearer <session token>`.

#### Sign-in and profile

**`POST /v1/auth/session`** (public)
```json
// request
{ "aiArenaToken": "eyJ…" }
// response 200
{
  "token": "eyJ…",
  "expiresAt": "2026-10-04T22:00:00.000Z",
  "player": { "userId": "…", "username": "alice", "walletAddress": "0x…" },
  "agents": [
    { "id": "agent-uuid", "name": "Kraken", "clan": "ZEROG", "archetype": "BERSERKER",
      "evolutionStage": "GENESIS", "eloRating": 1200, "isRetired": false }
  ],
  "agency": null            // or an Agency object (below)
}
```

**`GET /v1/me`** returns `{ player, agents, agency | null }`.

#### Agency

**`POST /v1/agency`** returns 201 with an Agency.
```json
{ "name": "Pixel FC", "ceoAgentId": "agent-uuid" }
```
- The name is 3–32 characters: letters, numbers, spaces and `' & . -`. It must be unique, ignoring case.
- Errors: 403 (agent not yours), 400 (retired agent), 409 (you already have an agency, or the name is taken).

**`GET /v1/agency`** returns an Agency:
```json
{
  "id": "uuid",
  "name": "Pixel FC",
  "ceo": { "agentId": "agent-uuid", "name": "Kraken", "clan": "ZEROG" },
  "credits": 1500,
  "level": 1,
  "points": 0,
  "nextLevelAt": 50,               // points needed for next level; null at max
  "desks": 3,
  "staff": [ /* Analyst objects */ ],
  "payroll": { "weeklyTotal": 110, "nextDueAt": "2026-10-05T00:00:00.000Z" },
  "standings": {
    "weekly":  { "rank": 4, "points": 37 },   // null until you have a settled match this week
    "allTime": { "rank": 12, "points": 37 }
  },
  "createdAt": "…"
}
```

An **Analyst** object:
```json
{
  "id": "uuid", "name": "Ada Pixel", "specialty": "weather", "title": "Weather & Pitch Analyst",
  "markets": ["score", "corners"], "skill": 3, "xp": 40, "xpToNext": 300,   // null at skill 5
  "weeklySalary": 70, "style": "wind watcher", "hiredAt": "…"
}
```

**`PUT /v1/agency/ceo`** with `{ "ceoAgentId": "…" }` changes the CEO. Returns an Agency.

**`GET /v1/agency/ledger`**
```json
{ "credits": 1130, "entries": [
  { "delta": -260, "balanceAfter": 1240, "kind": "hire", "ref": "…", "createdAt": "…" },
  { "delta": 1500, "balanceAfter": 1500, "kind": "grant", "ref": "founding", "createdAt": "…" }
] }
```
`kind` is one of `grant`, `hire`, `salary` or `winnings`. Entries are newest first, last 100.

#### Staff

**`GET /v1/talent`**
```json
{
  "week": "2026-W40",
  "refreshesAt": "2026-10-05T00:00:00.000Z",
  "candidates": [
    { "candidateKey": "2026-W40:3", "name": "Kofi Voxel", "specialty": "odds", "title": "Market Analyst",
      "markets": ["outcome", "score"], "skill": 4, "hireCost": 405, "weeklySalary": 110, "style": "value seeker" }
  ]
}
```
Candidates you have already hired this week are left out.

**`POST /v1/staff`** with `{ "candidateKey": "2026-W40:3" }` returns 201 `{ analyst, agency }`.
Errors: 402 (not enough credits), 409 (desks full, or already hired), 404 (not in this week's pool).

**`DELETE /v1/staff/:analystId`** returns `{ fired, agency }`. There is no refund.

#### Matches

**`GET /v1/fixtures?from=YYYY-MM-DD&to=YYYY-MM-DD&league=39`**: all parameters are optional. The default range is yesterday to 10 days ahead.
```json
{ "fixtures": [
  { "fixtureId": 1035037, "leagueId": 39, "leagueName": "Premier League", "season": 2026,
    "kickoffAt": "2026-10-03T14:00:00.000Z", "homeTeam": "Arsenal", "awayTeam": "Chelsea",
    "homeTeamId": 42, "awayTeamId": 49, "status": "NS", "venue": "Emirates Stadium",
    "lockAt": "2026-10-03T13:55:00.000Z",
    "open": true,                                   // can still analyse / edit / lock
    "prediction": null }                            // or { "status": "LOCKED", "points": 0 }
] }
```
- Leagues: Premier League 39, La Liga 140, Serie A 135, Bundesliga 78, Ligue 1 61.
- `status` uses football short codes: `NS` not started, `1H`/`HT`/`2H` live, `FT` finished, `PST` postponed, `CANC` cancelled.

**`GET /v1/fixtures/:id`**: the match room.
```json
{
  "fixture": { /* as above */ , "venueCity": "London", "lockAt": "…", "open": true },
  "squad":    [ { "id": "1001", "name": "Bukayo Saka", "side": "HOME" } ],
  "absences": [ { "name": "Injured Defender", "side": "HOME", "type": "Missing Fixture", "reason": "Hamstring" } ],
  "outcome": null,          // after the match: { "status": "FINISHED", "regulation": { "home": 2, "away": 1 },
                            //   "scorers": ["1001"], "totalCards": 5, "totalCorners": 12 }
  "analysesUsed": 1,
  "analysesAllowed": 3,
  "prediction": null,       // or a Prediction (below)
  "analysis": null          // or the latest analysis used for the draft: { id, reports, combined, createdAt }
}
```

**`POST /v1/fixtures/:id/analysis`**: runs the desk analysis. It can take a few seconds, so animate the office meanwhile.
```json
{
  "analysis": {
    "id": "uuid",
    "reports": [
      {
        "analystId": "uuid", "name": "Ada Pixel", "title": "Weather & Pitch Analyst",
        "specialty": "weather", "skill": 3,
        "brief": { "available": true,
                   "narrative": "Heavy rain and 34 km/h wind expected at kickoff in London…",
                   "source": "llm" },              // "llm" | "template" | "none"
        "signals": ["heavy rain conditions should slow the game", "wind pushes more balls out for corners"],
        "recommendations": {                       // only this analyst's markets are present
          "score":   { "pick": { "home": 1, "away": 0 }, "confidence": 0.75 },
          "corners": { "pick": 11, "confidence": 0.75 }
        },
        "note": "Recommends 1-0, 11 corners."
      }
    ],
    "combined": {
      "picks": { "outcome": "HOME", "score": { "home": 2, "away": 1 }, "corners": 11, "cards": 4,
                 "scorerId": "1001", "scorerName": "Bukayo Saka" },
      "markets": {
        "outcome": { "covered": true,  "source": "desk", "support": ["analystId", "…"] },
        "score":   { "covered": true,  "source": "desk", "support": ["…"] },
        "corners": { "covered": true,  "source": "desk", "support": ["…"] },
        "cards":   { "covered": false, "source": "ceo",  "support": [] },
        "scorer":  { "covered": false, "source": "ceo",  "support": [] }
      },
      "summary": "Kraken's desk: Arsenal to win, 2-1, 11 corners, 4 cards, Bukayo Saka to score. Built from 3 analyst reports. Gut calls (no analyst covers them): cards, scorer."
    },
    "createdAt": "…"
  },
  "prediction": { /* Prediction, status DRAFT */ },
  "analysesUsed": 1,
  "analysesAllowed": 3
}
```
- `recommendations` keys are a subset of `outcome`, `score`, `corners`, `cards` and `scorer`. A scorer pick is `{ "playerId", "name" }`.
- `support` lists the analysts who agreed with the final pick. Use it to highlight them.
- Running it again with the same staff gives the same result. It's worth re-running after hiring someone, which replaces the draft and any edits.
- Errors: 409 (closed or already locked), 429 (limit reached), 503 (match data unavailable).

**`PUT /v1/fixtures/:id/prediction`**: the CEO's edit. Send any subset of fields:
```json
{ "outcome": "HOME", "score": { "home": 2, "away": 1 }, "corners": 10, "cards": 4, "scorerId": "1001" }
```
- Score 0–15 per side, corners 0–30, cards 0–20.
- `scorerId` must be a `squad` id, or `null` for no scorer.
- **The exact score must agree with the outcome**, so change both together or the API returns 400.

Returns `{ prediction }`. Returns 409 if no analysis has run yet ("run the desk analysis first"), or if the picks are closed or locked.

**`POST /v1/fixtures/:id/prediction/lock`** returns `{ prediction }` with status `LOCKED`.

**`GET /v1/predictions`** returns `{ predictions: Prediction[] }`, the last 50.

A **Prediction** object:
```json
{
  "id": "uuid", "fixtureId": 1035037, "match": "Arsenal vs Chelsea", "leagueName": "Premier League",
  "kickoffAt": "…", "lockAt": "…", "week": "2026-W40",
  "status": "SETTLED",                 // DRAFT | LOCKED | SETTLED | VOID
  "picks": { "outcome": "HOME", "score": { "home": 2, "away": 1 }, "corners": 10, "cards": 4,
             "scorerId": "1001", "scorerName": "Bukayo Saka" },
  "edited": true, "lockedAt": "…", "autoLocked": false, "settledAt": "…",
  "points": 37, "exactHits": 3,
  "breakdown": {                       // null until settled
    "outcome": { "result": "EXACT", "points": 5 },
    "score":   { "result": "EXACT", "points": 7 },
    "corners": { "result": "MISS",  "points": 0 },
    "cards":   { "result": "CLOSE", "points": 5 },
    "scorer":  { "result": "EXACT", "points": 20 }
  }
}
```
- `result` is one of `EXACT`, `CLOSE`, `MISS` or `VOID`. VOID means the data was missing, or the match was cancelled or abandoned.
- Results arrive roughly 2 hours after kickoff.

#### Leaderboards (public)

**`GET /v1/leaderboards/weekly?week=2026-W40&limit=50&offset=0`**
**`GET /v1/leaderboards/all-time?limit=50&offset=0`**

```json
{
  "kind": "weekly",
  "week": "2026-W40",                  // null for all-time
  "entries": [
    { "rank": 1, "agencyId": "uuid", "agencyName": "Pixel FC", "ceo": { "name": "Kraken", "clan": "ZEROG" },
      "points": 52, "exactHits": 5, "predictions": 1 }
  ],
  "me": null                           // your own entry if you send the Bearer token and have points
}
```
- `week` defaults to the current week.
- `limit` is at most 100.
- Agencies are ranked by points, then by exact hits.

#### Health

`GET /health` returns `{ "status": "ok" }`. `GET /ready` returns `{ "status": "ready" }`.

---

## 6. Rules the UI should respect

- **Open state:** use `fixture.open` (or `now < lockAt`) to enable analysis, editing and locking. Show a live countdown to `lockAt`.
- **Draft before edit:** the editor only works after an analysis has run. Even an agency with no analysts can run one: the CEO drafts alone, and every market is a gut call.
- **Analysis limit:** at most `analysesAllowed` runs per match. Show the remaining runs.
- **Desks:** disable hiring when `staff.length >= desks`, and say "fire someone or level up".
- **Credits:** disable Hire when `credits < hireCost`, and warn when `credits < payroll.weeklyTotal`, because analysts quit if payday can't be met.
- **Score ↔ outcome:** when the score editor changes, update the outcome to match automatically (home > away → HOME, and so on). This also prevents 400 errors.
- **Points display:** points can be `x.5`, so show one decimal when needed.
- **After locking:** show picks read-only, with "Locked" or "Auto-locked" depending on `autoLocked`.
- **Settled:** reveal the per-market breakdown with a satisfying animation. EXACT is green, CLOSE amber, MISS grey and VOID struck through.

---

## 7. Practical notes

- **Refresh:** after any mutation (hire, fire, analysis, edit, lock), use the returned `agency` or `prediction` to update state. Don't refetch everything.
- **Polling:** re-fetch `GET /v1/agency` and `GET /v1/fixtures` every minute or two while the office is open, so results, payroll and level-ups appear.
- **Match data:** fixtures come from the top 5 European leagues. If the list is empty, show a friendly "No matches scheduled right now" board.
- **Correlation id:** every response has an `x-correlation-id` header. Show it in error toasts to help support.
