// Kult Sports API client. In production the browser calls the API directly
// (config.json apiUrl); locally it goes through this site's /api proxy. The
// game session token lives in sessionStorage so a reload keeps the player
// signed in.

const KEY = "kultsports.session";
// The AI Arena token the game was entered with, kept briefly so the player's
// Mind can also be linked to their agent in AI Arena (it expires in ~15 minutes).
const ARENA_KEY = "kultsports.arena";
const ARENA_TOKEN_MAX_AGE_MS = 13 * 60_000;

export class ApiError extends Error {
  constructor(status, body, correlationId) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error || "error";
    this.correlationId = correlationId || body?.correlationId || null;
  }
}

function load() {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || "null"); return s && Date.parse(s.expiresAt) > Date.now() + 60_000 ? s : null; }
  catch { return null; }
}

export function createApi({ onUnauthorized, apiUrl } = {}) {
  const BASE = `${apiUrl || "/api"}/v1`;
  let session = load();

  async function request(method, path, body, { auth = true } = {}) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && session) headers.authorization = `Bearer ${session.token}`;
    let res;
    try {
      res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, { message: "You're offline or Kult Sports can't be reached." });
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new ApiError(res.status, data, res.headers.get("x-correlation-id"));
      if (res.status === 401 && auth) { session = null; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } onUnauthorized?.(err); }
      throw err;
    }
    return data;
  }
  const q = (params) => {
    const s = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
    return s ? `?${s}` : "";
  };

  return {
    demo: false,
    hasSession: () => Boolean(session),
    signOut() { session = null; try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(ARENA_KEY); } catch { /* ignore */ } },
    /** The AI Arena token if it is still fresh, else null. */
    storedArenaToken() {
      try { const t = JSON.parse(sessionStorage.getItem(ARENA_KEY) || "null"); return t && Date.now() - t.at < ARENA_TOKEN_MAX_AGE_MS ? t.token : null; }
      catch { return null; }
    },
    /** Links the Mind to an AI Arena agent (server.mjs forwards to AI Arena): one KULT key for every product. */
    async arenaLinkMind(arenaToken, agentId, accessToken, mindId) {
      let res;
      try {
        res = await fetch("/arena/minds/link", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${arenaToken}` }, body: JSON.stringify({ agentId, accessToken, ...(mindId && { mindId }) }) });
      } catch { throw new ApiError(0, { message: "AI Arena can't be reached right now." }); }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, { message: data?.error || "AI Arena could not link your Mind." });
      return data;
    },

    // AI Arena token (from the Kult browser, or a Privy login) -> game session.
    async startSession(aiArenaToken) {
      const out = await request("POST", "/auth/session", { aiArenaToken }, { auth: false });
      try { sessionStorage.setItem(ARENA_KEY, JSON.stringify({ token: aiArenaToken, at: Date.now() })); } catch { /* private mode */ }
      session = { token: out.token, expiresAt: out.expiresAt };
      try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch { /* private mode */ }
      return out;
    },
    // Privy access token -> AI Arena token (server-side exchange, see server.mjs).
    async arenaTokenFromPrivy(accessToken) {
      let res;
      try {
        res = await fetch("/arena/auth/privy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken }) });
      } catch { throw new ApiError(0, { message: "AI Arena can't be reached right now." }); }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.accessToken) throw new ApiError(res.status, { message: data?.error || "AI Arena could not verify your login." });
      return data.accessToken;
    },

    me: () => request("GET", "/me"),
    createAgency: (name, ceoAgentId) => request("POST", "/agency", { name, ceoAgentId }),
    agency: () => request("GET", "/agency"),
    setCeo: (ceoAgentId) => request("PUT", "/agency/ceo", { ceoAgentId }),
    ledger: () => request("GET", "/agency/ledger"),

    talent: () => request("GET", "/talent"),
    hire: (candidateKey) => request("POST", "/staff", { candidateKey }),
    fire: (analystId) => request("DELETE", `/staff/${encodeURIComponent(analystId)}`),

    fixtures: (params) => request("GET", `/fixtures${q(params)}`),
    fixture: (id) => request("GET", `/fixtures/${encodeURIComponent(id)}`),
    analyze: (id) => request("POST", `/fixtures/${encodeURIComponent(id)}/analysis`),
    editPrediction: (id, picks) => request("PUT", `/fixtures/${encodeURIComponent(id)}/prediction`, picks),
    lock: (id) => request("POST", `/fixtures/${encodeURIComponent(id)}/prediction/lock`),
    predictions: () => request("GET", "/predictions"),

    // Your Mind directs (a Hello Minds agent makes the final calls; see Pixel Agency's docs).
    mindStatus: () => request("GET", "/agency/mind"),
    linkMind: (accessToken, mindId) => request("POST", "/agency/mind", mindId ? { accessToken, mindId } : { accessToken }),
    newMindKey: () => request("POST", "/agency/mind/keys"),
    unlinkMind: () => request("DELETE", "/agency/mind"),

    leaderboard: (kind, params) => request("GET", `/leaderboards/${kind === "weekly" ? "weekly" : "all-time"}${q(params)}`)
  };
}
