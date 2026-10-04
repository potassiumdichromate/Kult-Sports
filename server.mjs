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
// - /config.json      -> public settings for the page (Privy app id).

import { createServer } from "node:http";
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
  aiArenaUrl: process.env.AI_ARENA_APP_URL || "https://app.kult.games"
});
const MAX_BODY = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 90_000; // the API can be cold on Render; analysis takes a few seconds

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".woff2": "font/woff2"
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

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
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
  // Hashed Privy chunks never change; everything else revalidates (ETag) so a
  // deploy shows up on the next load.
  const cache = /[\\/]privy[\\/]chunks[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache";
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
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method_not_allowed", message: "Not allowed" });
    return await serveStatic(req, res, p);
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: "server_error", message: e.status ? e.message : "Something went wrong" });
  }
}).listen(PORT, () => console.log(`[kult-sports] http://localhost:${PORT} (api ${API_URL})`));
