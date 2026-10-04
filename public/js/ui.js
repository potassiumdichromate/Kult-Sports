// Small DOM and formatting helpers shared by the Kult Sports screens.

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return node;
}

export const show = (id, on = true) => { const n = typeof id === "string" ? $(id) : id; if (n) n.hidden = !on; };

let toastTimer = null;
export function toast(message, bad = false, correlationId = null) {
  const t = $("toast");
  t.replaceChildren(...[el("span", {}, message), correlationId ? el("span", { class: "muted small" }, ` (ref ${String(correlationId).slice(0, 8)})`) : null].filter(Boolean));
  t.className = bad ? "bad" : "";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3500);
}
export const toastError = (e) => toast(e?.message || "Something went wrong", true, e?.correlationId);

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Working…"; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

// ---------------------------------------------------------------- numbers & time
export const fmtPts = (p) => { const n = Number(p || 0); return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
export const fmtCredits = (c) => Number(c || 0).toLocaleString();
export function fmtCountdown(ms) {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s % 60}s`;
}
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export function fmtDay(iso) {
  const d = new Date(iso), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}
export const fmtAgo = (iso) => {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

export function stars(n) {
  const k = Math.max(0, Math.min(5, Number(n) || 0));
  return el("span", { class: "stars", title: `${k} of 5 stars`, "aria-label": `${k} of 5 stars` }, "★".repeat(k), el("span", { class: "off" }, "★".repeat(5 - k)));
}

// ---------------------------------------------------------------- football
export const MARKETS = ["outcome", "score", "corners", "cards", "scorer"];
export const MARKET_LABEL = { outcome: "Outcome", score: "Exact score", corners: "Corners", cards: "Cards", scorer: "Goal scorer" };
export const MARKET_POINTS = { outcome: "5", score: "7 (3.5 close)", corners: "10 (5 close)", cards: "10 (5 close)", scorer: "20" };
export const outcomeOf = (s) => (s.home > s.away ? "HOME" : s.home < s.away ? "AWAY" : "DRAW");
export const outcomeText = (o, f) => (o === "HOME" ? `${f.homeTeam} win` : o === "AWAY" ? `${f.awayTeam} win` : "Draw");
export function pickText(market, picks, f) {
  if (!picks) return "—";
  if (market === "outcome") return picks.outcome ? outcomeText(picks.outcome, f) : "—";
  if (market === "score") return picks.score ? `${picks.score.home}–${picks.score.away}` : "—";
  if (market === "corners") return picks.corners ?? "—";
  if (market === "cards") return picks.cards ?? "—";
  if (market === "scorer") return picks.scorerName || (picks.scorerId ? "Selected player" : "No scorer");
  return "—";
}
export const isLive = (status) => ["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(status);
export const isFinished = (status) => ["FT", "AET", "PEN"].includes(status);

// Pixel icons from rows of '#'.
export function pixelIcon(rows, cls = "ico") {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${rows[0].length} ${rows.length}`);
  svg.setAttribute("class", cls); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("shape-rendering", "crispEdges");
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== "#") return;
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", 1); r.setAttribute("height", 1);
    svg.append(r);
  }));
  return svg;
}
export const ICONS = {
  ball: ["....####....", "..##.##.##..", ".#..####..#.", ".#.#....#.#.", "#.#......#.#", "####....####", "####....####", "#.#......#.#", ".#.#....#.#.", ".#..####..#.", "..##.##.##..", "....####...."],
  talent: ["....###.....", "...#####....", "...#####....", "....###.....", "..#######...", ".#########..", ".#########.#", ".########.###", "..#######..#.", "............", "............", "............"].map((r) => r.slice(0, 12)),
  history: ["..########..", "..#......#..", "####....####", "#..........#", "#.######...#", "#..........#", "#.#####....#", "#..........#", "#.######...#", "#..........#", "############", "............"],
  trophy: ["############", "#.########.#", "#.########.#", ".#.######.#.", "..########..", "...######...", "....####....", ".....##.....", ".....##.....", "...######...", "...######...", "............"]
};
