// Kult Sports web server (no dependencies).
//
// - Serves the game from public/.
// - /api/*            -> the Kult Sports API (API_URL), for local development.
//                        In production set PUBLIC_API_URL: browsers then call the
//                        API directly (it must list this site in CORS_ORIGINS),
//                        so its per-IP rate limit applies per player rather than
//                        to this one server.
// - /arena/auth/privy -> AI Arena's POST /v1/auth/privy (AI_ARENA_API_URL),
//                        which turns a Privy login into an AI Arena token. The
//                        AI Arena gateway only accepts browser calls from its
//                        own site, so the exchange runs server to server.
// - /config.json      -> public settings for the page (Privy app id, Minds client id).
// - /arena/minds/*    -> AI Arena's /v1/marketplace/minds/link and /mine, so the
//                        player's Mind is linked to their agent too (one KULT key).
// - /minds/callback   -> where Hello Minds returns after a player links their Mind.
//                        Redirected to the game page (one URL, relative assets) with
//                        the OAuth code and state kept, plus mindsCallback=1.
// - /pm/*             -> Polymarket's public, read-only market data (Gamma
//                        search/markets/comments, CLOB price history, Data API
//                        positions/trades), so the Polymarket board loads on
//                        networks that can't reach those hosts. GET only, a
//                        fixed list of paths, cached briefly. Funding (bridge)
//                        and trading (CLOB orders) never go through here: the
//                        player's browser calls Polymarket itself.
// - /arena/polymarket/*, /arena/league/leaderboard, /arena/f1/drivers
//                     -> AI Arena (agent market reads, the deposit-wallet relayer,
//                        top agents, F1 drivers), server to server like the rest.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const PORT = Number(process.env.PORT || 4400);
const API_URL = (process.env.API_URL || "https://pixel-agency-api.onrender.com").replace(/\/$/, "");
const AI_ARENA_API_URL = (process.env.AI_ARENA_API_URL || "https://aiarena-gateway.kult.games").replace(/\/$/, "");
const PUBLIC_CONFIG = JSON.stringify({
  apiUrl: (process.env.PUBLIC_API_URL || "").replace(/\/$/, "") || null,
  privyAppId: process.env.PRIVY_APP_ID || null,
  privyClientId: process.env.PRIVY_CLIENT_ID || null,
  aiArenaUrl: process.env.AI_ARENA_APP_URL || "https://app.kult.games",
  // Hello Minds OAuth client (public id) for "Your Mind directs"; unset hides the feature.
  mindsClientId: process.env.MINDS_CLIENT_ID || null,
  // The spec a player's Mind builds its Skill from (must be the public API address).
  directorSpecUrl: `${(process.env.PUBLIC_API_URL || "").replace(/\/$/, "") || API_URL}/v1/director/openapi.json`,
  // The AI Arena Mind API: talking to other agents, negotiating, relationships.
  mindApiSpecUrl: `${AI_ARENA_API_URL}/v1/marketplace/mind/openapi.json`,
  // Polymarket Builder Code (a public bytes32 attribution code) for orders and bridge deposits.
  polymarketBuilderCode: process.env.POLYMARKET_BUILDER_CODE || null
});
// Polymarket read-only data: the hosts and paths the board may read.
const PM_READS = {
  gamma: { host: "https://gamma-api.polymarket.com", paths: ["/public-search", "/markets", "/comments"] },
  clob: { host: "https://clob.polymarket.com", paths: ["/prices-history"] },
  data: { host: "https://data-api.polymarket.com", paths: ["/positions", "/trades"] }
};
const PM_TTL_MS = 20_000;
const pmCache = new Map(); // upstream url -> { at, status, type, body }
let pmDownUntil = 0; // after a failed read, skip Polymarket briefly
// AI Arena routes the Polymarket board uses: [path pattern, method].
const ARENA_ROUTES = [
  [/^\/arena\/polymarket\/signals\/[^/]+$/, "GET"],
  [/^\/arena\/polymarket\/signals\/[^/]+\/[0-9a-f-]{36}\/generate$/i, "POST"],
  [/^\/arena\/polymarket\/relayer\/submit$/, "POST"],
  [/^\/arena\/league\/leaderboard$/, "GET"],
  [/^\/arena\/f1\/drivers$/, "GET"]
];
// The page links its CSS and scripts under /v/<build>/, so each deploy has new
// URLs and no cache in front (Cloudflare's browser TTL included) can keep an old
// office; the scripts' relative imports follow the same prefix. The page itself
// is never cached.
const BUILD = (process.env.RENDER_GIT_COMMIT || "").slice(0, 12) || Date.now().toString(36);
const PAGE = readFileSync(join(ROOT, "index.html"), "utf8")
  .replace(/(<(?:link|script)\b[^>]*\b(?:href|src)=")(?![a-z]+:|\/|\?|#)([^"]+")/g, `$1v/${BUILD}/$2`);
// DEMO_MODE=1 (or "fresh": before founding an agency) opens the offline demo
// (public/js/demo.js) for every visitor; ?demo=0 still reaches the real game.
const DEMO = (() => { const v = String(process.env.DEMO_MODE || "").trim().toLowerCase(); return v === "fresh" ? "fresh" : ["1", "true", "on", "yes"].includes(v) ? "1" : null; })();
const MAX_BODY = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 90_000; // the API can be cold on Render; analysis takes a few seconds

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".woff2": "font/woff2", ".glb": "model/gltf-binary"
};

// The page URL can carry the player's AI Arena token (?jwt=...): never leak it
// in a Referer, and don't let other sites frame the game unless allowed.
const SECURITY_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  ...(process.env.FRAME_ANCESTORS ? { "Content-Security-Policy": `frame-ancestors ${process.env.FRAME_ANCESTORS}` } : {})
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxy(req, res, target) {
  const headers = { accept: "application/json" };
  for (const h of ["authorization", "content-type", "x-correlation-id"]) if (req.headers[h]) headers[h] = req.headers[h];
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  let upstream;
  try {
    upstream = await fetch(target, { method: req.method, headers, body, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), redirect: "manual" });
  } catch {
    return json(res, 503, { error: "upstream_unavailable", message: "Kult Sports is waking up or unreachable. Try again in a moment." });
  }
  const out = { "Cache-Control": "no-store" };
  for (const h of ["content-type", "x-correlation-id", "retry-after"]) { const v = upstream.headers.get(h); if (v) out[h] = v; }
  send(res, upstream.status, Buffer.from(await upstream.arrayBuffer()), out);
}

async function polymarketRead(res, kind, path, search) {
  const src = PM_READS[kind];
  if (!src || !src.paths.includes(path)) return json(res, 404, { error: "not_found", message: "Unknown Polymarket path" });
  const target = `${src.host}${path}${search}`;
  const hit = pmCache.get(target);
  if (hit && Date.now() - hit.at < PM_TTL_MS) return send(res, hit.status, hit.body, { "Content-Type": hit.type, "Cache-Control": "no-store" });
  // While Polymarket is unreachable, answer at once instead of making every request wait out the timeout.
  if (Date.now() < pmDownUntil) return json(res, 503, { error: "upstream_unavailable", message: "Polymarket can't be reached right now." });
  let upstream;
  try {
    upstream = await fetch(target, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  } catch {
    pmDownUntil = Date.now() + 15_000;
    return json(res, 503, { error: "upstream_unavailable", message: "Polymarket can't be reached right now." });
  }
  const entry = { at: Date.now(), status: upstream.status, type: upstream.headers.get("content-type") || "application/json", body: Buffer.from(await upstream.arrayBuffer()) };
  if (upstream.ok) {
    pmCache.set(target, entry);
    if (pmCache.size > 500) pmCache.delete(pmCache.keys().next().value);
  }
  send(res, entry.status, entry.body, { "Content-Type": entry.type, "Cache-Control": "no-store" });
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  if (rel === "/index.html") return send(res, 200, req.method === "HEAD" ? undefined : PAGE, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
  const v = /^\/v\/([^/]+)(\/.*)$/.exec(rel);
  if (v) rel = v[2];
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep) && file !== ROOT) return send(res, 403, "Forbidden");
  let info;
  try { info = await stat(file); } catch { info = null; }
  if (!info?.isFile()) {
    // Unknown paths fall back to the game page (it has one URL).
    if (!extname(rel)) return serveStatic(req, res, "/");
    return send(res, 404, "Not found", { "Content-Type": "text/plain" });
  }
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  // Hashed Privy chunks and this build's versioned files never change;
  // everything else revalidates (ETag).
  const cache = /[\\/](?:privy|polymarket)[\\/]chunks[\\/]/.test(file) || v?.[1] === BUILD ? "public, max-age=31536000, immutable" : "no-cache";
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  if (req.headers["if-none-match"] === etag) return send(res, 304, undefined, { ETag: etag, "Cache-Control": cache });
  send(res, 200, req.method === "HEAD" ? undefined : await readFile(file), { "Content-Type": type, "Cache-Control": cache, ETag: etag });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (p === "/health") return json(res, 200, { ok: true, service: "kult-sports" });
    if (p === "/config.json") return send(res, 200, PUBLIC_CONFIG, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    if (p === "/arena/auth/privy") {
      if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed", message: "Use POST" });
      return await proxy(req, res, `${AI_ARENA_API_URL}/v1/auth/privy`);
    }
    if (p.startsWith("/api/")) return await proxy(req, res, `${API_URL}${p.slice(4)}${url.search}`);
    if (p === "/arena/minds/link" || p === "/arena/minds/mine") {
      if (req.method !== (p.endsWith("link") ? "POST" : "GET")) return json(res, 405, { error: "method_not_allowed", message: "Not allowed" });
      return await proxy(req, res, `${AI_ARENA_API_URL}/v1/marketplace/minds/${p.slice("/arena/minds/".length)}`);
    }
    const pm = /^\/pm\/(gamma|clob|data)(\/[a-z-]+)$/.exec(p);
    if (pm) {
      if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed", message: "Use GET" });
      return await polymarketRead(res, pm[1], pm[2], url.search);
    }
    const arena = ARENA_ROUTES.find(([re]) => re.test(p));
    if (arena) {
      if (req.method !== arena[1]) return json(res, 405, { error: "method_not_allowed", message: `Use ${arena[1]}` });
      return await proxy(req, res, `${AI_ARENA_API_URL}/v1${p.slice("/arena".length)}${url.search}`);
    }
    if (p === "/minds/callback") {
      const q = new URLSearchParams(url.search);
      q.set("mindsCallback", "1");
      return send(res, 302, undefined, { Location: `/?${q}`, "Cache-Control": "no-store" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method_not_allowed", message: "Not allowed" });
    if (DEMO && (p === "/" || p === "/index.html") && !url.searchParams.has("demo")) {
      const q = new URLSearchParams(url.search); q.set("demo", DEMO);
      return send(res, 302, undefined, { Location: `/?${q}`, "Cache-Control": "no-store" });
    }
    return await serveStatic(req, res, p);
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: "server_error", message: e.status ? e.message : "Something went wrong" });
  }
}).listen(PORT, () => console.log(`[kult-sports] http://localhost:${PORT} (api ${API_URL})`));
