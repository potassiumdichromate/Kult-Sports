// Direct, key-less Polymarket integration (public CORS-enabled endpoints).
// Gamma = market metadata + current prices, CLOB = price history for charts.
// Everything here is football-only (filtered client-side). Callers should treat
// [] as “no live data”, do not substitute fake markets.

// Kult Sports: read-only market data goes through this site's server
// (server.mjs /pm/*), so the board loads on networks that can't reach
// Polymarket's API hosts directly. Funding (bridge) and trading (CLOB orders)
// stay direct browser calls, so Polymarket's own region rules still apply.
const GAMMA_BASE = "/pm/gamma";
const CLOB_BASE = "/pm/clob";
const DATA_API_BASE = "/pm/data";

export type PolyMarket = {
  id: string;
  /** Polymarket's condition id -- NOT the same value as `id` (that's Gamma's own numeric id). This is what a real position's `marketId` (from fetchUserPositions) is keyed by, so matching a card to an existing position must use this field, not `id`. */
  conditionId?: string;
  question: string;
  category: string;
  short: string;
  /** YES price in cents, 0–100. */
  yes: number;
  /** Formatted volume, e.g. "$1.2M". */
  volume: string;
  /** Raw volume in USD, used to rank headline markets above niche ones. */
  volumeNum: number;
  /** CLOB token id for the YES outcome (used for price history and buying YES). */
  tokenId: string;
  /** CLOB token id for the NO outcome (used for buying NO) -- undefined if the market has no distinct NO leg. */
  noTokenId?: string;
  /** Creation time (epoch ms) used to sort newest-first; 0 when the API omits it. */
  createdAt: number;
  /** Kickoff time (epoch ms) for match-day markets; 0 for futures/non-match markets. */
  gameTime: number;
  /** Real 24h price change in cents (signed), from Gamma's oneDayPriceChange; 0 when absent. */
  dayChange: number;
  /** Parent event / match name, e.g. "France vs. Morocco" (sub-market suffixes stripped). */
  eventTitle?: string;
  /** Gamma event id. Markets sharing this value belong in the same event card. */
  eventId?: string;
  /** Parent event artwork supplied by Polymarket. */
  eventImage?: string;
  /** Parent event close time (epoch ms). */
  eventEndDate?: number;
  /** Parent event liquidity in USD. */
  eventLiquidity?: number;
  /** Parent event lifetime volume in USD, matching the total shown on Polymarket event cards. */
  eventVolume?: number;
  /** Raw per-outcome label (e.g. "Lando Norris" for a driver-championship sub-market) -- untruncated, unlike `short`. Undefined for non-grouped markets. */
  outcomeLabel?: string;
};

// ── Football filtering ──────────────────────────────────────────────────────
const FOOTBALL_TERMS = [
  "world cup",
  "champions league",
  "uefa",
  "premier league",
  "la liga",
  "serie a",
  "bundesliga",
  "ligue 1",
  "ballon d'or",
  "ballon dor",
  "golden boot",
  "fifa",
  "soccer",
  "europa league",
  "copa",
  "el clasico",
  "messi",
  "mbappe",
  "mbappé",
  "haaland",
  "ronaldo",
  "real madrid",
  "barcelona",
  "manchester",
  "arsenal",
  "liverpool",
  "chelsea",
  "bayern",
  "psg",
  "juventus",
];

// Keep American football / other sports out.
const EXCLUDE_TERMS = ["nfl", "super bowl", "touchdown", "quarterback", "nba", "mlb", "nhl", "cricket", "tennis"];

function isFootball(haystack: string): boolean {
  const text = haystack.toLowerCase();
  if (EXCLUDE_TERMS.some((term) => text.includes(term))) return false;
  return FOOTBALL_TERMS.some((term) => text.includes(term));
}

// ── Formula 1 ────────────────────────────────────────────────────────────────
// Category label for a flattened F1 sub-market -- see fetchF1Markets below
// for how the underlying events are found (public-search, not keyword
// filtering over the general markets feed -- that undercounted badly).
function deriveF1Category(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("constructors")) return "Constructors' Championship";
  if (q.includes("drivers") && q.includes("champion")) return "Drivers' Championship";
  if (q.includes("pole")) return "Pole Position";
  if (q.includes("fastest lap")) return "Fastest Lap";
  if (q.includes("grand prix")) return "Race Winner";
  return "Formula 1";
}

function deriveCategory(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("world cup") || q.includes("fifa")) return "World Cup";
  if (q.includes("champions league") || q.includes("uefa")) return "Champions League";
  if (q.includes("europa league")) return "Europa League";
  if (q.includes("premier league") || q.includes(" epl")) return "Premier League";
  if (q.includes("la liga")) return "La Liga";
  if (q.includes("serie a")) return "Serie A";
  if (q.includes("bundesliga")) return "Bundesliga";
  if (q.includes("ligue 1")) return "Ligue 1";
  if (q.includes("ballon")) return "Ballon d'Or";
  if (/\b(transfer|sign|signing|stay|join|leave|move to)\b/.test(q)) return "Transfers";
  return "Football";
}

function shorten(question: string, groupItemTitle?: string): string {
  if (groupItemTitle && groupItemTitle.trim()) return groupItemTitle.trim().slice(0, 18);
  const cleaned = question.replace(/^will\s+/i, "").replace(/\?$/, "").trim();
  const words = cleaned.split(/\s+/).slice(0, 3).join(" ");
  return words.slice(0, 18);
}

function formatVolume(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

// ── Defensive parsing helpers ───────────────────────────────────────────────
function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** Parse a Polymarket timestamp to epoch ms. Handles ISO strings and numeric
 *  epochs (seconds or ms). Returns 0 when absent/unparseable so such rows sink
 *  to the bottom of a newest-first sort rather than jumping to the top. */
function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value; // seconds → ms
  }
  if (typeof value === "string" && value) {
    // Gamma's gameStartTime comes as "2026-07-09 20:00:00+00", not strict ISO,
    // which Safari's Date.parse rejects. Normalize to "2026-07-09T20:00:00Z".
    const iso = value.replace(" ", "T").replace(/\+00(:00)?$/, "Z");
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

type RawMarket = Record<string, unknown>;

type EventContext = {
  id?: string;
  title?: string;
  image?: string;
  endDate?: number;
  liquidity?: number;
  volume?: number;
};

function normalizeMarket(
  raw: RawMarket,
  eventContext?: EventContext,
  categoryFn: (question: string) => string = deriveCategory,
): PolyMarket | null {
  const question = typeof raw.question === "string" ? raw.question : "";
  if (!question) return null;

  const outcomes = parseStringArray(raw.outcomes);
  const prices = parseStringArray(raw.outcomePrices);
  const tokenIds = parseStringArray(raw.clobTokenIds);
  if (outcomes.length < 2 || prices.length < 2 || tokenIds.length < 2) return null;

  let yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  if (yesIdx < 0) yesIdx = 0;
  const noIdx = outcomes.findIndex((o) => o.toLowerCase() === "no");

  const yes = Math.round(Math.min(1, Math.max(0, toNumber(prices[yesIdx]))) * 100);
  const tokenId = tokenIds[yesIdx];
  if (!tokenId) return null;
  const noTokenId = noIdx >= 0 ? tokenIds[noIdx] : undefined;

  const volumeNum = toNumber(raw.volumeNum ?? raw.volume);
  // Prefer explicit creation time; fall back to startDate. Robust to string or numeric epochs.
  const createdAt = parseTimestamp(raw.createdAt) || parseTimestamp(raw.startDate);
  const gameTime = parseTimestamp(raw.gameStartTime);
  // Gamma reports the 24h change as a price fraction (-1..1), convert to cents.
  const dayChange = Math.round(toNumber(raw.oneDayPriceChange) * 100);

  const groupItemTitle = typeof raw.groupItemTitle === "string" ? raw.groupItemTitle : undefined;

  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? question),
    conditionId: typeof raw.conditionId === "string" ? raw.conditionId : undefined,
    question,
    category: categoryFn(question),
    short: shorten(question, groupItemTitle),
    /** Raw outcome label (e.g. "Lando Norris") -- untruncated, for exact-name matching (e.g. against a real driver roster for a photo), unlike `short`. */
    ...(groupItemTitle && { outcomeLabel: groupItemTitle }),
    yes,
    volume: formatVolume(volumeNum),
    volumeNum,
    tokenId,
    createdAt,
    gameTime,
    dayChange,
    ...(noTokenId && { noTokenId }),
    ...(eventContext?.title && { eventTitle: eventContext.title }),
    ...(eventContext?.id && { eventId: eventContext.id }),
    ...(eventContext?.image && { eventImage: eventContext.image }),
    ...(eventContext?.endDate && { eventEndDate: eventContext.endDate }),
    ...(eventContext?.liquidity && { eventLiquidity: eventContext.liquidity }),
    ...(eventContext?.volume && { eventVolume: eventContext.volume }),
  };
}

// Same fix as F1 (fetchF1Markets below): keyword-filtering the top-100-by-
// volume feed badly undercounts real coverage once the headline event (the
// World Cup) closes -- individual league/match markets rarely crack that
// shared top 100. Search Polymarket's own events directly instead, per
// competition, and flatten every sub-market -- confirmed live: Premier
// League, La Liga, Serie A, Bundesliga, and Champions League (qualifying
// rounds included) all have real active events right now. "football" and
// "soccer" as bare search terms were tried and dropped -- too noisy (American
// football free-agency news, CS:GO matches whose team names happen to
// contain a league name).
const FOOTBALL_SEARCH_TERMS = [
  "premier league",
  "champions league",
  "la liga",
  "serie a",
  "bundesliga",
  "ligue 1",
  "europa league",
  "ballon d'or",
  "world cup",
];

async function fetchFootballEventsRaw(status: "active" | "resolved" = "active"): Promise<RawMarket[]> {
  const seen = new Map<string, RawMarket>();
  await Promise.all(
    FOOTBALL_SEARCH_TERMS.map(async (term) => {
      try {
        const url = `${GAMMA_BASE}/public-search?q=${encodeURIComponent(term)}&events_status=${status}&limit_per_type=50`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const json = (await res.json()) as { events?: RawMarket[] };
        for (const event of json.events ?? []) {
          // Defense against near-miss search noise (e.g. "Série A" esports
          // brackets whose team names match "serie a" loosely) -- re-check
          // with the same term list against the actual event title/slug.
          const title = typeof event.title === "string" ? event.title : "";
          const slug = typeof event.slug === "string" ? event.slug : "";
          if (!isFootball(`${title} ${slug}`)) continue;
          const id = typeof event.id === "string" ? event.id : String(event.id ?? "");
          if (id && !seen.has(id)) seen.set(id, event);
        }
      } catch {
        // one search term failing shouldn't drop the others
      }
    }),
  );
  return [...seen.values()];
}

/** Fetch every open football market (flattened from all active real events across the major leagues). Returns [] on any failure. */
export async function fetchFootballMarkets(limit = 60): Promise<PolyMarket[]> {
  try {
    const events = await fetchFootballEventsRaw("active");
    const football = flattenOpenMarketsFromEvents(events, deriveCategory);
    football.sort((a, b) => b.volumeNum - a.volumeNum);
    return football.slice(0, limit);
  } catch {
    return [];
  }
}

// Keyword-filtering the general top-100-by-volume markets feed (like
// fetchFootballMarkets does) badly undercounts F1: a single F1 event like
// "F1 Drivers' Champion" holds 30+ individual driver sub-markets, but only
// the highest-volume few of those ever crack the top 100 overall, so the
// old version of this function surfaced 4-6 markets when Polymarket
// actually has ~80 real active ones. Polymarket's own public-search finds
// the right EVENTS directly (confirmed live: "formula 1"/"f1" both surface
// all 4 currently-active F1 events with a real totalResults count) --
// fetch those, then flatten every one of their sub-markets, the same
// approach fetchWorldCupMarkets already uses for its own event-grouped
// markets (flattenOpenMarketsFromEvents).
// "grand prix" was tried too but pulled in unrelated noise (fuzzy-matched a
// GTA VI pricing market) without finding any real F1 event the other two
// terms didn't already cover -- dropped.
const F1_SEARCH_TERMS = ["formula 1", "f1"];

async function fetchF1EventsRaw(): Promise<RawMarket[]> {
  const seen = new Map<string, RawMarket>();
  await Promise.all(
    F1_SEARCH_TERMS.map(async (term) => {
      try {
        const url = `${GAMMA_BASE}/public-search?q=${encodeURIComponent(term)}&events_status=active&limit_per_type=50`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const json = (await res.json()) as { events?: RawMarket[] };
        for (const event of json.events ?? []) {
          const id = typeof event.id === "string" ? event.id : String(event.id ?? "");
          if (id && !seen.has(id)) seen.set(id, event);
        }
      } catch {
        // one search term failing shouldn't drop the others
      }
    }),
  );
  return [...seen.values()];
}

/** Fetch every open Formula 1 market (flattened from all active F1 events). Returns [] on any failure. */
export async function fetchF1Markets(limit = 100): Promise<PolyMarket[]> {
  try {
    const events = await fetchF1EventsRaw();
    const f1 = flattenOpenMarketsFromEvents(events, deriveF1Category);
    f1.sort((a, b) => b.volumeNum - a.volumeNum);
    return f1.slice(0, limit);
  } catch {
    return [];
  }
}

// ── Strict FIFA World Cup fetch ─────────────────────────────────────────────
// Player-props sub-events carry 200+ single-player markets each; they'd drown
// the board, so they're skipped.
const PLAYER_PROPS_SLUG = /-player-props$/;

function flattenOpenMarketsFromEvents(events: RawMarket[], categoryFn: (question: string) => string = deriveCategory): PolyMarket[] {
  return events
    .filter((event) => !PLAYER_PROPS_SLUG.test(typeof event.slug === "string" ? event.slug : ""))
    .flatMap((event) => {
      // "France vs. Morocco - Exact Score" → "France vs. Morocco"
      const matchName = typeof event.title === "string" ? event.title.split(" - ")[0].trim() : "";
      const eventContext: EventContext = {
        id: typeof event.id === "string" ? event.id : String(event.id ?? ""),
        title: matchName || undefined,
        image:
          typeof event.image === "string"
            ? event.image
            : typeof event.icon === "string"
              ? event.icon
              : undefined,
        endDate: parseTimestamp(event.endDate),
        liquidity: toNumber(event.liquidityClob ?? event.liquidity),
        volume: toNumber(event.volume),
      };
      const markets = Array.isArray(event.markets) ? (event.markets as RawMarket[]) : [];
      return markets
        .filter((raw) => raw.active !== false && raw.closed !== true)
        .map((raw) => normalizeMarket(raw, eventContext, categoryFn));
    })
    .filter((m): m is PolyMarket => m !== null);
}

function sortWorldCupMarkets(markets: PolyMarket[]): PolyMarket[] {
  // Next kickoff first; within the same match, headline (highest-volume)
  // markets lead. Futures without a kickoff sink below, newest-first.
  return [...markets].sort((a, b) => {
    if (a.gameTime && b.gameTime) return a.gameTime - b.gameTime || b.volumeNum - a.volumeNum;
    if (a.gameTime !== b.gameTime) return a.gameTime ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

/**
 * Fetch real football prediction markets across whatever major competitions
 * are actually live right now (Premier League, Champions League, La Liga,
 * Serie A, Bundesliga, Ligue 1, Europa League, plus World Cup/Ballon d'Or
 * when those are in season). Not hardcoded to any one tournament -- this
 * used to be FIFA-World-Cup-only via a hardcoded series id, which stopped
 * returning anything once the tournament closed. Returns [] on any
 * failure, never fakes data.
 */
export async function fetchWorldCupMarkets(limit = 60): Promise<PolyMarket[]> {
  try {
    const events = await fetchFootballEventsRaw("active");
    const markets = sortWorldCupMarkets(flattenOpenMarketsFromEvents(events, deriveCategory));
    return markets.slice(0, limit);
  } catch {
    return [];
  }
}

export type ResolvedMarket = {
  id: string;
  question: string;
  category: string;
  outcome: "YES" | "NO";
  settledLabel: string;
};

function formatRelativeTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "recently";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "recently";
  const days = Math.round((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

/** Fetch real settled/closed football markets. Returns [] on any failure. */
export async function fetchResolvedFootballMarkets(limit = 8): Promise<ResolvedMarket[]> {
  try {
    const url = `${GAMMA_BASE}/markets?closed=true&limit=200&order=closedTime&ascending=false`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const list: RawMarket[] = Array.isArray(json)
      ? (json as RawMarket[])
      : Array.isArray((json as { data?: unknown })?.data)
        ? ((json as { data: RawMarket[] }).data)
        : [];

    const resolved = list
      .filter((raw) => {
        const q = typeof raw.question === "string" ? raw.question : "";
        const slug = typeof raw.slug === "string" ? raw.slug : "";
        return isFootball(`${q} ${slug}`);
      })
      .map((raw): ResolvedMarket | null => {
        const question = typeof raw.question === "string" ? raw.question : "";
        if (!question) return null;
        const outcomes = parseStringArray(raw.outcomes);
        const prices = parseStringArray(raw.outcomePrices);
        if (outcomes.length < 2 || prices.length < 2) return null;

        let yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
        if (yesIdx < 0) yesIdx = 0;
        const outcome: "YES" | "NO" = toNumber(prices[yesIdx]) >= 0.5 ? "YES" : "NO";

        return {
          id: typeof raw.id === "string" ? raw.id : String(raw.id ?? question),
          question,
          category: deriveCategory(question),
          outcome,
          settledLabel: formatRelativeTime(raw.closedTime ?? raw.endDate),
        };
      })
      .filter((m): m is ResolvedMarket => m !== null);

    return resolved.slice(0, limit);
  } catch {
    return [];
  }
}

// ── Events (multi-market groupings, used for the banner carousel) ────────────
export type EventOutcome = {
  label: string;
  /** YES price in cents, 0–100 (i.e. this outcome's probability). */
  yes: number;
  tokenId?: string;
  icon?: string;
};

export type PolyEvent = {
  id: string;
  title: string;
  slug: string;
  category: string;
  icon?: string;
  image?: string;
  volume: string;
  marketCount: number;
  /** Top outcome labels (e.g. team names) by probability. */
  outcomes: string[];
  /** Full per-outcome detail (sorted by probability) for the featured card. */
  outcomesDetail: EventOutcome[];
  /** Formatted close date, e.g. "Jul 20, 2026". */
  endsLabel?: string;
  /** Number of comments on the event (for picking a chatty default). */
  commentCount: number;
};

export type PolyComment = {
  id: string;
  body: string;
  author: string;
  avatar?: string;
};

function formatEndDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return undefined;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(ts);
}

function eventOutcomesDetail(markets: RawMarket[]): EventOutcome[] {
  return markets
    .map((market) => {
      const prices = parseStringArray(market.outcomePrices);
      const outcomes = parseStringArray(market.outcomes);
      const tokenIds = parseStringArray(market.clobTokenIds);
      let yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
      if (yesIdx < 0) yesIdx = 0;
      const label =
        (typeof market.groupItemTitle === "string" && market.groupItemTitle.trim()) ||
        (typeof market.question === "string" ? market.question : "");
      return {
        label,
        yes: Math.round(Math.min(1, Math.max(0, toNumber(prices[yesIdx]))) * 100),
        tokenId: tokenIds[yesIdx],
        icon:
          (typeof market.icon === "string" && market.icon) ||
          (typeof market.image === "string" ? market.image : undefined),
      };
    })
    .filter((row) => row.label)
    .sort((a, b) => b.yes - a.yes);
}

function normalizeEvent(raw: RawMarket): PolyEvent | null {
  const title = typeof raw.title === "string" ? raw.title : "";
  if (!title) return null;
  const markets = Array.isArray(raw.markets) ? (raw.markets as RawMarket[]) : [];
  const volumeNum = toNumber(raw.volumeNum ?? raw.volume);
  const outcomesDetail = eventOutcomesDetail(markets);

  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? title),
    title,
    slug: typeof raw.slug === "string" ? raw.slug : "",
    category: deriveCategory(title),
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    image: typeof raw.image === "string" ? raw.image : undefined,
    volume: formatVolume(volumeNum),
    marketCount: markets.length,
    outcomes: outcomesDetail.slice(0, 4).map((o) => o.label),
    outcomesDetail,
    endsLabel: formatEndDate(raw.endDate),
    commentCount: Math.round(toNumber(raw.commentCount)),
  };
}

/** Fetch recent comments for an event (the live chat feed). Read-only, public. */
export async function fetchEventComments(eventId: string, limit = 8): Promise<PolyComment[]> {
  try {
    const url = `${GAMMA_BASE}/comments?parent_entity_type=Event&parent_entity_id=${encodeURIComponent(eventId)}&limit=${limit}&order=createdAt&ascending=false`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const list: RawMarket[] = Array.isArray(json)
      ? (json as RawMarket[])
      : Array.isArray((json as { data?: unknown })?.data)
        ? ((json as { data: RawMarket[] }).data)
        : [];
    return list
      .map((raw) => {
        const profile = (raw.profile && typeof raw.profile === "object" ? raw.profile : {}) as Record<string, unknown>;
        const author = String(
          profile.pseudonym ?? profile.name ?? profile.displayUsername ?? raw.userAddress ?? "anon",
        );
        const avatarRaw =
          profile.profileImage ?? profile.baseProfileImage ?? profile.image ?? profile.pfp ?? raw.profileImage;
        const avatar = typeof avatarRaw === "string" && avatarRaw ? avatarRaw : undefined;
        const body = typeof raw.body === "string" ? raw.body : "";
        return { id: String(raw.id ?? `${author}-${body.slice(0, 8)}`), body, author, avatar };
      })
      .filter((c) => c.body);
  } catch {
    return [];
  }
}

/** Fetch the top football events by volume, across whatever major competitions are live right now. Returns [] on any failure. */
export async function fetchFootballEvents(limit = 10): Promise<PolyEvent[]> {
  try {
    const events = await fetchFootballEventsRaw("active");
    events.sort((a, b) => toNumber(b.volumeNum ?? b.volume) - toNumber(a.volumeNum ?? a.volume));
    return events
      .map(normalizeEvent)
      .filter((e): e is PolyEvent => e !== null)
      .slice(0, limit);
  } catch {
    return [];
  }
}

type RawHistoryPoint = { t?: number; p?: number };

/** Fetch YES price history (cents) for a CLOB token. Returns [] on failure. */
export async function fetchPriceHistory(tokenId: string, points = 36): Promise<number[]> {
  try {
    const url = `${CLOB_BASE}/prices-history?market=${encodeURIComponent(tokenId)}&interval=1w&fidelity=180`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const history: RawHistoryPoint[] = Array.isArray((json as { history?: unknown })?.history)
      ? ((json as { history: RawHistoryPoint[] }).history)
      : [];
    const series = history
      .map((point) => Math.round(Math.min(1, Math.max(0, toNumber(point.p))) * 100))
      .filter((n) => Number.isFinite(n));
    return series.slice(-points);
  } catch {
    return [];
  }
}

export type PolyPosition = {
  marketId: string;
  question: string;
  side: "YES" | "NO";
  /** Average entry price in cents. */
  entry: number;
  /** Current mid price in cents. */
  current: number;
  shares: number;
  /** Unrealized P&L in USD. */
  pnl: number;
};

/**
 * Fetch a wallet's real open Polymarket positions via Polymarket's public
 * Data API (docs/polymarket) -- read-only, key-less, same "any address" civic
 * lookup pattern Polygonscan/Etherscan use. Best-effort field parsing since
 * this specific endpoint's exact response shape could not be verified live
 * from this environment (same network restriction as Gamma/CLOB) -- degrades
 * to [] rather than guessing wrong, matching every other fetcher in this file.
 */
export async function fetchUserPositions(address: string): Promise<PolyPosition[]> {
  try {
    const url = `${DATA_API_BASE}/positions?user=${encodeURIComponent(address)}&sizeThreshold=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const list: RawMarket[] = Array.isArray(json) ? (json as RawMarket[]) : [];

    return list
      .map((raw): PolyPosition | null => {
        const question = typeof raw.title === "string" ? raw.title : typeof raw.question === "string" ? raw.question : "";
        const conditionId = typeof raw.conditionId === "string" ? raw.conditionId : typeof raw.market === "string" ? raw.market : "";
        if (!question || !conditionId) return null;

        const outcomeRaw = typeof raw.outcome === "string" ? raw.outcome : "";
        const side: "YES" | "NO" = outcomeRaw.toLowerCase() === "no" ? "NO" : "YES";
        const entry = Math.round(toNumber(raw.avgPrice) * 100);
        const current = Math.round(toNumber(raw.curPrice) * 100);
        const shares = toNumber(raw.size);
        const pnl = toNumber(raw.cashPnl ?? raw.percentPnl);

        return { marketId: conditionId, question, side, entry, current, shares, pnl };
      })
      .filter((p): p is PolyPosition => p !== null);
  } catch {
    return [];
  }
}

export type PolyTrade = {
  id: string;
  side: "BUY" | "SELL";
  outcome: string;
  /** Price in cents. */
  price: number;
  /** Notional in USD. */
  size: number;
  title: string;
  trader: string;
  timestamp: number;
};

/** Kult Sports: real recent trades on the given markets (Data API /trades). Returns [] on any failure. */
export async function fetchRecentTrades(conditionIds: string[], limit = 14): Promise<PolyTrade[]> {
  const ids = conditionIds.filter(Boolean).slice(0, 40);
  if (ids.length === 0) return [];
  try {
    const url = `${DATA_API_BASE}/trades?limit=${limit}&takerOnly=true&market=${encodeURIComponent(ids.join(","))}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const list: RawMarket[] = Array.isArray(json) ? (json as RawMarket[]) : [];
    return list
      .map((raw, i): PolyTrade | null => {
        const price = toNumber(raw.price);
        const shares = toNumber(raw.size);
        if (!price || !shares) return null;
        const wallet = typeof raw.proxyWallet === "string" ? raw.proxyWallet : "";
        const name = typeof raw.pseudonym === "string" && raw.pseudonym ? raw.pseudonym : typeof raw.name === "string" && raw.name ? raw.name : "";
        return {
          id: String(raw.transactionHash ?? i) + ":" + i,
          side: String(raw.side).toUpperCase() === "SELL" ? "SELL" : "BUY",
          outcome: typeof raw.outcome === "string" ? raw.outcome : "",
          price: Math.round(price * 100),
          size: Math.round(price * shares * 100) / 100,
          title: typeof raw.title === "string" ? raw.title : "",
          trader: name || (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-3)}` : "trader"),
          timestamp: toNumber(raw.timestamp) * 1000,
        };
      })
      .filter((t): t is PolyTrade => t !== null);
  } catch {
    return [];
  }
}
