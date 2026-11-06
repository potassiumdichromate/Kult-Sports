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

// Line icons (24x24, stroked in the current colour).
export const ICONS = {
  office: '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-5h4v5"/><path d="M9 10h.01M15 10h.01"/>',
  matches: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/><path d="M12 3v4M16 10l4.5-1.5M14.5 14.5l2.5 4M9.5 14.5l-2.5 4M8 10 3.5 8.5"/>',
  talent: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a7 7 0 0 1 14 0v1"/><path d="M19 8v6M16 11h6"/>',
  history: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h3"/>',
  leaders: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  agency: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  emblem: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/><circle cx="12" cy="11" r="3.5"/><path d="M12 7.5v1.2M8.6 10.2l1.2.4M15.4 10.2l-1.2.4"/>',
  whistle: '<path d="M10 9h11v4a6 6 0 1 1-11-3.3"/><circle cx="8" cy="15" r="2"/><path d="M14 9V6"/><path d="M3 6l3 2"/>',
  stopwatch: '<circle cx="12" cy="14" r="8"/><path d="M12 14V10M10 2h4M12 2v4M19 7l1.5-1.5"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/>',
  // Polymarket's cube mark, drawn as a line icon.
  polymarket: '<path d="M18.5 3 5.5 6.6v10.8L18.5 21z"/><path d="M5.5 6.6l13 5.4-13 5.4"/>'
};
export function lineIcon(name, cls = "ico") {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", cls); svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name] || ICONS.ball;
  return svg;
}
