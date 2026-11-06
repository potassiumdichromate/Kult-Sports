// Polymarket in Kult Sports: the old Kult browser's League → Polymarket board
// (Football and Formula 1), rebuilt in the Kult Sports glass design.
//
// Everything is real: live Polymarket markets, price history, event chat,
// resolved markets, recent trades and the player's positions; your CEO's
// market read from AI Arena; trading through the player's own Polymarket
// deposit wallet (public/polymarket/kult-polymarket.js, built from
// polymarket-island/). KULT is a signal layer only: Polymarket runs the
// markets, custody and settlement.

import { el, toast, fmtDay, fmtTime, isLive, isFinished } from "./ui.js";

const CONFIDENCE_PCT = { LOW: 60, MEDIUM: 75, HIGH: 90 };
const STATUS_LABEL = {
  "switching-network": "Switching to Polygon…",
  "deploying-wallet": "Setting up your Polymarket wallet…",
  wrapping: "Funding the trade (check your wallet)…",
  approving: "Approving (check your wallet)…",
  "deriving-key": "Setting up trading…",
  "placing-order": "Placing order…",
  withdrawing: "Withdrawing (check your wallet)…"
};
const OUTCOME_COLORS = ["#7cc4ff", "#4fd8ff", "#ffc94d", "#ff9f5a", "#a78bfa", "#ff7eb6"];
const PL_CLUBS = ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton & Hove Albion", "Chelsea", "Coventry City", "Crystal Palace", "Everton", "Fulham", "Hull City", "Ipswich Town", "Leeds United", "Liverpool", "Manchester City", "Manchester United", "Newcastle United", "Nottingham Forest", "Sunderland", "Tottenham Hotspur"];
const CREST_IDS = { "real madrid": 86, barcelona: 81, "atletico madrid": 78, "bayern munich": 5, bayern: 5, dortmund: 4, "borussia dortmund": 4, inter: 108, juventus: 109, "ac milan": 98, milan: 98, napoli: 113, psg: 524, "paris saint-germain": 524, arsenal: 57, "aston villa": 58, bournemouth: 1044, brentford: 402, "brighton & hove albion": 397, chelsea: 61, "coventry city": 1076, "crystal palace": 354, everton: 62, fulham: 63, "hull city": 322, "ipswich town": 349, "leeds united": 341, liverpool: 64, "manchester city": 65, "manchester united": 66, "newcastle united": 67, "nottingham forest": 351, sunderland: 71, "tottenham hotspur": 73 };
const PAGE = 24;

// Polymarket's cube mark (official logo pack), tinted with currentColor.
const PM_MARK = "M42.76 24.28V0L0 12.04v28.93l42.76 12.04V24.27zm-4.13-1.16V5.42L7.21 14.27zm-3.08 3.39L4.14 17.66v17.69l31.42-8.85zM7.21 38.75l31.42 8.85V29.89L7.21 38.74v.02z";
function pmMark(cls = "pm-mark") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 42.76 53.01"); svg.setAttribute("class", cls); svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path d="${PM_MARK}" fill="currentColor" fill-rule="evenodd"/>`;
  return svg;
}

// ---------------------------------------------------------------- state
const pm = {
  sport: "football", tab: "market",
  source: "loading", markets: [], shown: PAGE, selectedId: null, highlightId: null,
  history: {}, events: [], eventIndex: 0, eventHist: {}, comments: [], commentsLoading: false,
  resolved: null, trades: null, news: null, leaders: null, leadersError: null,
  f1: null, drivers: new Map(), f1Expanded: null, f1Stake: 10,
  signals: {}, signalBusy: null, signalError: {},
  stakes: {}, trade: null, // { key, status, error, placed }
  wallet: null, // { address, usdc, pusd, depositWallet }
  positions: null,
  pulseFilter: "upcoming"
};
let ctx = null, root = null, lib = null, libPromise = null, timers = [], mounted = false, observer = null;
let drawerPaint = null; // repaints the open F1 outcomes sheet, if any

const fill = (node, ...kids) => node && node.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
function compactUsd(v) {
  if (v >= 1e7) return `$${Math.round(v / 1e6)}M`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1e4) return `$${Math.round(v / 1e3)}K`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(v || 0)}`;
}
const dirOf = (n) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
const arrow = (d) => el("span", { class: `pm-arrow ${d}`, "aria-hidden": "true" }, d === "up" ? "▲" : d === "down" ? "▼" : "•");
const change = (n) => el("span", { class: `pm-change ${dirOf(n)}` }, arrow(dirOf(n)), ` ${n > 0 ? "+" : ""}${n}¢ 24h`);
const panel = (cls, ...kids) => el("section", { class: `pm-panel ${cls || ""}` }, ...kids);
const panelHead = (title, sub, ...right) => el("div", { class: "pm-panel-head" },
  el("div", {}, el("h3", {}, title), sub ? el("p", {}, sub) : null), right.length ? el("div", { class: "pm-head-right" }, ...right) : null);
const liveDot = (label = "Live") => el("span", { class: "pm-live" }, el("i"), label);
const skeleton = (h = 80) => el("div", { class: "pm-skel", style: `height:${h}px` });
function crestFor(team) {
  const id = CREST_IDS[String(team || "").toLowerCase().trim()];
  return id ? `https://crests.football-data.org/${id}.png` : null;
}
function initials(name) { return String(name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }
function avatar(src, label, cls = "pm-avatar") {
  return src ? el("img", { class: cls, src, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: (e) => e.currentTarget.replaceWith(el("span", { class: `${cls} ph` }, initials(label))) })
    : el("span", { class: `${cls} ph` }, initials(label));
}

function every(ms, fn) { const t = setInterval(() => { if (mounted && document.visibilityState === "visible") fn(); }, ms); timers.push(t); }

async function loadLib() {
  if (lib) return lib;
  libPromise ??= import("../polymarket/kult-polymarket.js").then((m) => {
    m.configure({ builderCode: ctx.state.cfg.polymarketBuilderCode, submitRelayer: (payload) => arena("POST", "/arena/polymarket/relayer/submit", payload, true) });
    lib = m;
    return m;
  });
  return libPromise;
}

// AI Arena (through server.mjs). auth: send the player's AI Arena token.
async function arena(method, path, body, auth = false) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    const token = await ctx.arenaToken();
    if (!token) throw new Error("Your AI Arena session expired. Sign in again to continue.");
    headers.authorization = `Bearer ${token}`;
  }
  let res;
  try { res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error("AI Arena can't be reached right now."); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.message || data?.error?.message || (typeof data?.error === "string" ? data.error : null) || `AI Arena error (${res.status})`), { status: res.status });
  return data;
}

// ---------------------------------------------------------------- mount
export function mountPolymarket(rootEl, context) {
  ctx = context;
  // Already showing (an agency refresh re-renders the open view): keep the board as it is.
  if (mounted && root === rootEl && rootEl.childElementCount) return;
  root = rootEl;
  const first = !mounted;
  mounted = true;
  render();
  if (first) start();
}

export function unmountPolymarket() {
  mounted = false;
  for (const t of timers) clearInterval(t);
  timers = [];
  observer?.disconnect(); observer = null;
}

async function start() {
  try { await loadLib(); } catch (e) { console.warn("[polymarket] bundle failed", e); pm.source = "offline"; render(); return; }
  if (!mounted) return;
  loadMarkets(); loadEvents(); refreshWallet(true);
  every(60_000, loadMarkets);
  every(15_000, () => { if (pm.sport === "football" && pm.tab === "market") loadComments(); });
  every(20_000, () => { if (pm.sport === "football" && pm.tab === "analysis") loadTrades(); });
  every(30_000, () => { if (pm.sport === "f1") loadF1(); });
  every(10 * 60_000, () => { if (pm.news) loadNews(); });
  every(45_000, () => refreshWallet(false));
}

// ---------------------------------------------------------------- data
async function loadMarkets() {
  const list = await lib.fetchWorldCupMarkets(200);
  if (!mounted) return;
  if (!list.length) {
    if (!pm.markets.length) { pm.source = "offline"; render(); }
    return;
  }
  pm.markets = list.map((m) => ({ ...m, dir: dirOf(m.dayChange || 0), session: m.dayChange || 0 }));
  if (!pm.markets.some((m) => m.id === pm.selectedId)) pm.selectedId = pm.markets[0].id;
  const wasLoading = pm.source !== "live";
  pm.source = "live";
  if (pm.sport !== "football") return renderNotice();
  if (wasLoading) return render();
  renderNotice(); updateGrid(); renderSide(); if (pm.tab === "analysis") renderAnalysis();
}

async function loadEvents() {
  const list = await lib.fetchFootballEvents(10);
  if (!mounted) return;
  pm.events = [...list].sort((a, b) => b.commentCount - a.commentCount);
  pm.eventIndex = 0;
  selectEvent();
}

function selectEvent() {
  const ev = pm.events[pm.eventIndex];
  pm.comments = []; pm.eventHist = {};
  renderFeatured();
  if (!ev) return;
  for (const o of ev.outcomesDetail.slice(0, 4)) {
    if (!o.tokenId) continue;
    lib.fetchPriceHistory(o.tokenId).then((series) => {
      if (series.length < 2 || pm.events[pm.eventIndex] !== ev) return;
      pm.eventHist[o.tokenId] = series; renderFeatured();
    });
  }
  pm.commentsLoading = true;
  loadComments();
}

async function loadComments() {
  const ev = pm.events[pm.eventIndex];
  if (!ev) return;
  const list = await lib.fetchEventComments(ev.id, 8);
  if (pm.events[pm.eventIndex] !== ev) return;
  pm.commentsLoading = false;
  if (list.length) pm.comments = list;
  renderChat();
}

async function loadHistory(m) {
  if (!m?.tokenId || pm.history[m.id]) return;
  pm.history[m.id] = [];
  const series = await lib.fetchPriceHistory(m.tokenId);
  pm.history[m.id] = series;
  if (pm.tab === "analysis" && pm.selectedId === m.id) renderChart();
}

async function loadResolved() { pm.resolved = await lib.fetchResolvedFootballMarkets(8); if (pm.tab === "analysis") renderAnalysis(); }
async function loadTrades() {
  const ids = pm.markets.slice(0, 40).map((m) => m.conditionId).filter(Boolean);
  const list = await lib.fetchRecentTrades(ids, 14);
  pm.trades = list;
  if (pm.tab === "analysis") renderTrades();
}
async function loadNews() { pm.news = await lib.fetchFootballNews(10); renderNews(); }
async function loadLeaders() {
  try { pm.leaders = await arena("GET", "/arena/league/leaderboard?scope=global&limit=6"); pm.leadersError = null; }
  catch (e) { pm.leaders = []; pm.leadersError = e.status === 503 ? "The League season is between rounds, so there are no ranked agents right now." : e.message; }
  if (pm.tab === "analysis") renderAnalysis();
}
async function loadF1() {
  // Driver photos come from AI Arena's synced F1 roster; markets show without waiting for them.
  if (!pm.driversRequested) {
    pm.driversRequested = true;
    arena("GET", "/arena/f1/drivers").then((out) => {
      for (const d of out?.drivers || []) if (d.image) pm.drivers.set(normDriver(d.name), d.image);
      if (pm.drivers.size && pm.sport === "f1" && pm.f1) renderBody();
    }).catch(() => { pm.driversRequested = false; });
  }
  pm.f1 = await lib.fetchF1Markets(100);
  if (pm.sport === "f1") { renderNotice(); renderBody(); }
}
const normDriver = (n) => String(n || "").toLowerCase().replace(/\b(jr\.?|sr\.?|ii|iii)\b/g, "").replace(/[.'-]/g, "").trim();

async function loadSignals(marketId) {
  if (marketId in pm.signals) return;
  pm.signals[marketId] = null;
  try {
    const list = await arena("GET", `/arena/polymarket/signals/${encodeURIComponent(marketId)}`);
    const mine = (list || []).find((s) => s.agentId === ctx.state.agency?.ceo?.agentId);
    if (mine) { pm.signals[marketId] = mine; refreshCard(marketId); if (pm.f1Expanded === marketId) { renderBody(); drawerPaint?.(); } }
  } catch { /* no read yet */ }
}

async function refreshWallet(silent) {
  if (!lib || ctx.api.demo) return;
  const privy = await ctx.loadPrivy().catch(() => null);
  const w = privy?.authenticated ? privy.wallet() : null;
  if (!w) { if (pm.wallet) { pm.wallet = null; renderWallet(); } return; }
  try {
    const b = await lib.balances(w.address);
    pm.wallet = { address: w.address, ...b };
    const positions = await lib.fetchUserPositions(b.depositWallet);
    const changed = JSON.stringify(positions) !== JSON.stringify(pm.positions);
    pm.positions = positions;
    renderWallet();
    if (changed) { updateGrid(true); if (pm.tab === "analysis") renderPositions(); }
  } catch (e) { if (!silent) toast(e.message || "Couldn't read your Polygon balances.", true); }
}
const positionFor = (conditionId) => (conditionId && pm.positions ? pm.positions.find((p) => p.marketId === conditionId) : null);

// ---------------------------------------------------------------- actions
// The player's wallet from the Privy island, signing in first if needed.
async function playerWallet() {
  if (ctx.api.demo) throw new Error("Trading is off in the demo. Sign in to trade on Polymarket.");
  const privy = await ctx.loadPrivy();
  if (!privy) throw new Error("Sign-in isn't available here, so trading is off.");
  if (!privy.authenticated) await privy.login();
  const w = privy.wallet();
  if (!w) throw new Error("No wallet on this account yet. Try again in a moment.");
  return w;
}

function setTradeStatus(status) {
  if (!pm.trade) return;
  pm.trade.status = status;
  paintTrade();
}

async function buy(key, market, side, amount) {
  if (pm.trade && !["done", "idle"].includes(pm.trade.status) && !pm.trade.error) return toast("Another order is still going through.", true);
  const tokenId = side === "YES" ? market.tokenId : market.noTokenId;
  if (!tokenId) return;
  amount = Number(amount);
  if (!(amount >= 0.1)) return toast("Enter a stake of at least $0.10.", true);
  pm.trade = { key, status: "switching-network", error: null, placed: null };
  paintTrade();
  try {
    const out = await lib.createTrader(await playerWallet(), setTradeStatus).placeMarketBuy(tokenId, amount);
    pm.trade = { key, status: "done", error: null, placed: { side, amount, orderId: out?.orderId } };
    toast(`${side} order placed on Polymarket.`);
    refreshWallet(true);
  } catch (e) {
    const msg = /closed|exited|cancel|rejected/i.test(String(e?.message)) ? "Cancelled." : e?.message || "Couldn't place that order. Try again.";
    pm.trade = { key, status: "idle", error: msg, placed: null };
  }
  paintTrade();
}

// Every trade status line on screen (the board and the F1 outcomes sheet) is
// tagged with its key; repaint them in place.
function paintTrade() {
  for (const n of document.querySelectorAll("[data-trade-key]")) paintTradeLine(n);
  for (const b of document.querySelectorAll("[data-buy]")) b.disabled = tradeBusy() || b.dataset.off === "1";
}
const tradeBusy = () => Boolean(pm.trade && !pm.trade.error && !["done", "idle"].includes(pm.trade.status));
function paintTradeLine(n) {
  const t = pm.trade;
  if (!t || t.key !== n.dataset.tradeKey) return fill(n);
  if (t.error) return fill(n, el("span", { class: "pm-err" }, t.error));
  if (t.placed) return fill(n, el("span", { class: "pm-ok" }, `✓ ${t.placed.side} order placed · ${usd(t.placed.amount)}${t.placed.orderId ? ` · ${String(t.placed.orderId).slice(0, 10)}…` : ""}`));
  if (STATUS_LABEL[t.status]) return fill(n, el("span", { class: "pm-busy" }, el("i", { class: "pm-spin" }), STATUS_LABEL[t.status]));
  fill(n);
}
const tradeLine = (key) => { const n = el("p", { class: "pm-trade-line", "data-trade-key": key, "aria-live": "polite" }); paintTradeLine(n); return n; };

async function askAgent(market) {
  const ceo = ctx.state.agency?.ceo;
  if (!ceo) return;
  if (ctx.api.demo) { pm.signalError[market.id] = "Agent reads are off in the demo."; return refreshCard(market.id); }
  pm.signalBusy = market.id; pm.signalError[market.id] = null; refreshCard(market.id);
  if (pm.f1Expanded === market.id) { renderBody(); drawerPaint?.(); }
  try {
    const s = await arena("POST", `/arena/polymarket/signals/${encodeURIComponent(market.id)}/${encodeURIComponent(ceo.agentId)}/generate`, { question: market.question, ...(market.category && { category: market.category }) }, true);
    pm.signals[market.id] = s;
  } catch (e) {
    pm.signalError[market.id] = e.status === 429 ? "Too many reads in a minute. Try again shortly." : e.message;
  }
  pm.signalBusy = null; refreshCard(market.id);
  if (pm.f1Expanded === market.id) { renderBody(); drawerPaint?.(); }
}

function stakeInput(key, def = 10) {
  pm.stakes[key] ??= def;
  return el("label", { class: "pm-stake" }, el("span", {}, "Stake"),
    el("span", { class: "pm-stake-box" }, "$", el("input", { type: "number", min: "0.1", step: "0.1", inputmode: "decimal", value: String(pm.stakes[key]), "aria-label": "Stake in USDC", oninput: (e) => { pm.stakes[key] = e.target.value; } })),
    el("span", {}, "USDC"));
}
const buyBtn = (cls, label, price, off, onclick) => el("button", { type: "button", class: `pm-buy ${cls}`, "data-buy": "1", "data-off": off ? "1" : "0", disabled: off || tradeBusy() || null, onclick }, el("span", {}, label), el("b", {}, `${price}¢`));

// ---------------------------------------------------------------- page
function render() {
  if (!root || !mounted) return;
  observer?.disconnect(); observer = null;
  const sportTabs = el("div", { class: "pm-sport", role: "tablist", "aria-label": "Sport" },
    [["football", "Football", "matches"], ["f1", "Formula 1", "stopwatch"]].map(([id, label]) =>
      el("button", { type: "button", role: "tab", "aria-selected": String(pm.sport === id), class: pm.sport === id ? "on" : null, onclick: () => { if (pm.sport !== id) { pm.sport = id; if (id === "f1" && !pm.f1) loadF1(); render(); } } }, label)));
  fill(root,
    el("div", { class: "dash-head pm-head" },
      el("div", {}, el("p", { class: "eyebrow" }, pmMark("pm-mark sm"), "Polymarket"), el("h2", { class: "display" }, pm.sport === "f1" ? "Formula 1 markets" : "Football markets")),
      el("div", { class: "dash-controls" }, sportTabs)),
    el("div", { id: "pm-notice" }),
    el("div", { id: "pm-wallet" }),
    el("div", { id: "pm-body" }));
  renderNotice(); renderWallet(); renderBody();
}

function renderNotice() {
  const n = root?.querySelector("#pm-notice");
  if (!n) return;
  const source = pm.sport === "f1" ? (!pm.f1 ? "loading" : pm.f1.length ? "live" : "offline") : pm.source;
  const badge = source === "live" ? ["live", "Live Polymarket data"] : source === "loading" ? ["loading", "Loading markets…"] : ["off", "Polymarket offline"];
  fill(n, el("div", { class: "pm-notice" },
    el("p", {}, "KULT is a signal layer only. Markets, prices, trading, execution, custody and settlement are provided by Polymarket. KULT never custodies funds or executes trades. No cash value."),
    el("span", { class: `pm-badge ${badge[0]}` }, badge[1])));
}

function renderWallet() {
  const n = root?.querySelector("#pm-wallet");
  if (!n) return;
  if (ctx.api.demo) return fill(n, el("div", { class: "pm-wallet" }, el("p", { class: "muted small" }, "Demo: live markets and prices are real; trading, funding and agent reads need a signed-in KULT account.")));
  const w = pm.wallet;
  if (!w) {
    return fill(n, el("div", { class: "pm-wallet" },
      el("div", { class: "pm-wallet-copy" }, el("b", {}, "Trade with your KULT wallet"), el("span", { class: "muted small" }, "Your Privy wallet trades on Polygon through its own Polymarket wallet. Nothing is held by KULT.")),
      el("button", { type: "button", class: "btn primary small", onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const p = await ctx.loadPrivy(); if (!p) throw new Error("Sign-in isn't available here."); await p.login(); await refreshWallet(false); } catch (err) { if (!/closed|exited|cancel/i.test(String(err?.message))) toast(err.message, true); } b.disabled = false; } }, "Connect wallet")));
  }
  fill(n, el("div", { class: "pm-wallet" },
    el("div", { class: "pm-bal" }, el("span", {}, "Your Polygon USDC"), el("b", {}, usd(w.usdc))),
    el("div", { class: "pm-bal gold" }, el("span", {}, "Tradeable (pUSD)"), el("b", {}, usd(w.pusd))),
    el("div", { class: "pm-bal addr" }, el("span", {}, "Polymarket wallet"), el("code", { title: w.depositWallet }, `${w.depositWallet.slice(0, 6)}…${w.depositWallet.slice(-4)}`)),
    el("div", { class: "pm-wallet-actions" },
      el("button", { type: "button", class: "btn primary small", onclick: () => openFund() }, "Fund wallet"),
      el("button", { type: "button", class: "btn small", onclick: () => openWithdraw() }, "Withdraw"))));
}

function renderBody() {
  const body = root?.querySelector("#pm-body");
  if (!body) return;
  observer?.disconnect(); observer = null;
  if (pm.sport === "f1") return renderF1(body);
  const tabs = [["market", "Live Market", pm.source === "live" ? "Live" : pm.source === "loading" ? "…" : "Offline"], ["pulse", "Match Pulse", `${(ctx.state.fixtures || []).length} fixtures`], ["analysis", "Analysis", `${pm.markets.length} markets`]];
  fill(body,
    el("div", { class: "pm-tabs", role: "tablist", "aria-label": "Board" }, tabs.map(([id, label, meta]) =>
      el("button", { type: "button", role: "tab", "aria-selected": String(pm.tab === id), class: pm.tab === id ? "on" : null, onclick: () => { if (pm.tab !== id) { pm.tab = id; renderBody(); } } }, el("span", {}, label), el("small", {}, meta)))),
    el("div", { id: "pm-view" }));
  const view = body.querySelector("#pm-view");
  if (pm.source === "loading") return fill(view, el("div", { class: "pm-grid" }, [0, 1, 2, 3, 4, 5].map(() => skeleton(230))));
  if (pm.tab === "pulse") return renderPulse(view);
  if (pm.tab === "analysis") return renderAnalysis();
  fill(view,
    el("div", { id: "pm-featured" }),
    el("div", { class: "pm-row" }, plHero(), el("div", { id: "pm-side", class: "pm-side" })),
    el("div", { id: "pm-grid", class: "pm-grid" }),
    el("div", { id: "pm-more" }));
  renderFeatured(); renderSide(); updateGrid(true);
}

// ---------------------------------------------------------------- live market: featured event
function renderFeatured() {
  const n = root?.querySelector("#pm-featured");
  if (!n) return;
  const ev = pm.events[pm.eventIndex];
  if (!ev) return fill(n, panel("pm-featured", pm.events.length || pm.source === "loading" ? skeleton(220) : el("p", { class: "empty-dash" }, "No featured football event on Polymarket right now.")));
  const outcomes = ev.outcomesDetail.slice(0, 5).map((o, i) => ({ ...o, color: OUTCOME_COLORS[i % OUTCOME_COLORS.length], series: o.tokenId ? pm.eventHist[o.tokenId] : null }));
  const cycle = (d) => { pm.eventIndex = (pm.eventIndex + d + pm.events.length) % pm.events.length; selectEvent(); };
  fill(n, panel("pm-featured",
    el("div", { class: "pm-feat-head" },
      el("div", { class: "pm-feat-title" }, ev.icon ? el("img", { class: "pm-ev-icon", src: ev.icon, alt: "", referrerpolicy: "no-referrer" }) : el("span", { class: "pm-ev-icon ph" }, "⚽"),
        el("div", { style: "min-width:0" }, el("p", { class: "pm-kicker" }, el("span", { class: "pm-tag" }, ev.category || "Football"), "Sports · Soccer"), el("h3", {}, ev.title))),
      pm.events.length > 1 ? el("div", { class: "pm-cycle" },
        el("button", { type: "button", "aria-label": "Previous event", onclick: () => cycle(-1) }, "‹"),
        el("span", {}, `${pm.eventIndex + 1}/${pm.events.length}`),
        el("button", { type: "button", "aria-label": "Next event", onclick: () => cycle(1) }, "›")) : null),
    el("div", { class: "pm-feat-body" },
      el("div", { class: "pm-feat-left" },
        el("ul", { class: "pm-outcomes" }, outcomes.map((o) => el("li", {}, el("span", { class: "pm-out-name" }, el("i", { style: `background:${o.color}` }), avatar(o.icon, o.label, "pm-out-ico"), o.label), el("b", {}, `${o.yes}%`)))),
        el("div", { class: "pm-chat" }, el("p", { class: "pm-kicker" }, liveDot("Live chat")), el("div", { id: "pm-chat-body" }))),
      el("div", { class: "pm-feat-right" },
        el("div", { class: "pm-legend" }, outcomes.slice(0, 4).map((o) => el("span", {}, el("i", { style: `background:${o.color}` }), o.label, el("b", {}, `${o.yes}%`)))),
        linesChart(outcomes.slice(0, 4).filter((o) => o.series?.length > 1)))),
    el("div", { class: "pm-feat-foot" }, el("span", {}, `${ev.volume} Vol`), el("span", {}, ev.endsLabel ? `Ends ${ev.endsLabel} · ` : "", pmMark("pm-mark sm"), "Polymarket"))));
  renderChat();
}

function renderChat() {
  const n = root?.querySelector("#pm-chat-body");
  if (!n) return;
  if (!pm.comments.length) return fill(n, el("p", { class: "muted small" }, pm.commentsLoading ? "Loading chat…" : "No comments on this market yet."));
  const loop = [...pm.comments, ...pm.comments];
  fill(n, el("div", { class: "pm-ticker" }, el("div", { class: "pm-ticker-track", style: `animation-duration:${Math.max(16, pm.comments.length * 5)}s` },
    loop.map((c) => el("div", { class: "pm-comment" }, avatar(c.avatar, c.author, "pm-c-av"), el("div", {}, el("b", {}, c.author.length > 18 ? `${c.author.slice(0, 8)}…` : c.author), el("p", {}, c.body)))))));
}

function svgEl(tag, attrs) { const n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; }
function linesChart(lines) {
  const W = 640, H = 220, top = 14, bottom = 206;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "pm-chart", role: "img", "aria-label": "Price history, last week" });
  for (const g of [0.25, 0.5, 0.75]) svg.append(svgEl("line", { x1: 0, x2: W, y1: H * g, y2: H * g, stroke: "rgba(255,255,255,0.07)" }));
  if (!lines.length) {
    const wrap = el("div", { class: "pm-chart-wrap" }, svg, el("p", { class: "pm-chart-empty" }, "Loading price history…"));
    return wrap;
  }
  const all = lines.flatMap((l) => l.series);
  const max = Math.min(100, Math.max(...all) + 4), min = Math.max(0, Math.min(...all) - 4), span = Math.max(1, max - min);
  for (const l of lines) {
    const step = W / (l.series.length - 1);
    const d = l.series.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(bottom - (bottom - top) * ((v - min) / span)).toFixed(1)}`).join(" ");
    svg.append(svgEl("path", { d, fill: "none", stroke: l.color, "stroke-width": 2.4, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
  }
  for (const [i, g] of [max, (max + min) / 2, min].entries()) svg.append(Object.assign(svgEl("text", { x: W - 6, y: [top + 10, H / 2 + 4, bottom - 4][i], "text-anchor": "end", class: "pm-axis" }), { textContent: `${Math.round(g)}%` }));
  return el("div", { class: "pm-chart-wrap" }, svg);
}

// ---------------------------------------------------------------- live market: Premier League hero
function plHero() {
  const crest = (club) => el("span", { class: "pm-crest", title: club }, avatar(crestFor(club), club, "pm-crest-img"));
  return el("section", { class: "pm-pl", "aria-label": "Live Premier League odds and predictions" },
    el("img", { class: "pm-pl-bg", src: "art/polymarket/pl-stadium.webp", alt: "", "aria-hidden": "true" }),
    el("div", { class: "pm-pl-shade" }),
    el("div", { class: "pm-pl-logo" }, el("img", { src: "art/polymarket/pl-logo.webp", alt: "Premier League" })),
    el("div", { class: "pm-marquee", "aria-hidden": "true" }, el("div", { class: "pm-marquee-track" }, [...PL_CLUBS, ...PL_CLUBS].map(crest))),
    el("div", { class: "pm-pl-copy" },
      el("p", { class: "pm-pl-league" }, "Premier League"), el("p", { class: "pm-pl-season" }, "2026/27"),
      el("h3", {}, "Odds &", el("br"), "Predictions"),
      el("p", { class: "pm-pl-live" }, "Live now"),
      el("p", { class: "pm-pl-sub" }, "Live markets and your CEO's read on every Premier League matchweek on Polymarket.")));
}

// ---------------------------------------------------------------- live market: next match / movers
function renderSide() {
  const n = root?.querySelector("#pm-side");
  if (!n) return;
  const withKickoff = pm.markets.filter((m) => m.gameTime > 0 && m.tokenId);
  const kickoff = withKickoff.length ? Math.min(...withKickoff.map((m) => m.gameTime)) : 0;
  const priority = (q) => (/^will .+ win on /i.test(q) ? 0 : /end in a draw/i.test(q) ? 1 : 2);
  const list = withKickoff.filter((m) => m.gameTime === kickoff).sort((a, b) => priority(a.question) - priority(b.question)).slice(0, 4);
  if (!list.length) return fill(n, movers(pm.markets, "Trending movers", "Biggest price swings"));
  const name = list[0].eventTitle || "Next match";
  const [home, away] = name.split(/\s+vs\.?\s+/i);
  const live = Date.now() >= kickoff;
  fill(n, panel("pm-next",
    panelHead(home && away ? el("span", { class: "pm-vs" }, avatar(crestFor(home), home, "pm-flag"), home.trim(), el("em", {}, "vs."), avatar(crestFor(away), away, "pm-flag"), away.trim()) : name,
      live ? null : el("span", {}, "Kicks off in ", el("b", { class: "countdown", "data-until": new Date(kickoff).toISOString() }, "…")),
      el("span", { class: `pm-pill ${live ? "live" : ""}` }, live ? liveDot("Live now") : "Next match")),
    live ? el("p", { class: "muted small" }, "Match in progress, markets live.") : null,
    stakeInput("next"),
    el("div", { class: "pm-next-list" }, list.map((m) => el("div", { class: "pm-next-row" },
      el("button", { type: "button", class: "pm-next-q", title: "View the full market card", onclick: () => jumpTo(m.id) },
        el("p", {}, m.question),
        el("div", { class: "pm-next-pct" }, el("b", {}, m.yes), el("small", {}, "% chance"), m.session ? change(m.session) : null),
        el("div", { class: "pm-prob" }, el("i", { style: `width:${Math.min(100, Math.max(2, m.yes))}%` }))),
      el("div", { class: "pm-next-buys" },
        buyBtn("yes", "Yes", m.yes, !m.tokenId, () => buy("next", m, "YES", pm.stakes.next)),
        buyBtn("no", "No", 100 - m.yes, !m.noTokenId, () => buy("next", m, "NO", pm.stakes.next)))))),
    tradeLine("next")));
}

function movers(markets, title, sub, compact = false) {
  const list = [...markets].sort((a, b) => Math.abs(b.session) - Math.abs(a.session)).slice(0, compact ? 8 : 12);
  return panel("pm-movers",
    panelHead(title, sub, el("span", { class: "pm-pill" }, "Live market")),
    !list.length ? el("p", { class: "empty-dash" }, "No markets to rank yet.") :
      el("div", { class: "pm-movers-list" }, list.map((m) => el("button", { type: "button", class: "pm-mover", onclick: () => (pm.tab === "analysis" ? selectChart(m.id) : jumpTo(m.id)) },
        el("div", { class: "pm-mover-top" }, el("span", { class: "pm-kicker" }, `⚽ ${m.eventTitle || m.category}`), change(m.session)),
        el("p", {}, m.question),
        el("b", {}, `YES ${m.yes}¢`)))));
}

function jumpTo(id) {
  const idx = pm.markets.findIndex((m) => m.id === id);
  if (idx >= pm.shown) { pm.shown = idx + 1; updateGrid(true); }
  pm.highlightId = id; pm.selectedId = id;
  const card = root?.querySelector(`[data-market="${CSS.escape(id)}"]`);
  card?.classList.add("hl");
  card?.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => { card?.classList.remove("hl"); if (pm.highlightId === id) pm.highlightId = null; }, 2400);
}

// ---------------------------------------------------------------- live market: question cards
function updateGrid(full = false) {
  const grid = root?.querySelector("#pm-grid");
  if (!grid) return;
  const list = pm.markets.slice(0, pm.shown);
  if (!pm.markets.length) {
    fill(grid, el("p", { class: "empty-dash pm-span" }, "Polymarket unreachable, no live markets to show."));
    return fill(root.querySelector("#pm-more"));
  }
  if (full) {
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { observer.unobserve(e.target); loadSignals(e.target.dataset.market); }
    }, { root: root, rootMargin: "200px" });
    fill(grid, list.map(card));
    for (const c of grid.children) observer.observe(c);
  } else {
    for (const m of list) {
      const old = grid.querySelector(`[data-market="${CSS.escape(m.id)}"]`);
      if (old && !old.contains(document.activeElement) && old.dataset.price !== `${m.yes}|${m.volume}`) old.replaceWith(card(m));
    }
  }
  const more = pm.markets.length - pm.shown;
  fill(root.querySelector("#pm-more"), more > 0 ? el("div", { class: "pm-more" }, el("button", { type: "button", class: "btn small", onclick: () => { pm.shown += PAGE; updateGrid(true); } }, `Show ${Math.min(PAGE, more)} more · ${more} left`)) : null);
}

function refreshCard(id) {
  const old = root?.querySelector(`[data-market="${CSS.escape(id)}"]`);
  const m = pm.markets.find((x) => x.id === id);
  if (old && m) { const fresh = card(m); old.replaceWith(fresh); observer?.observe(fresh); }
}

function card(m) {
  const key = `card:${m.id}`, pos = positionFor(m.conditionId), real = Boolean(m.tokenId);
  return el("article", { class: `pm-card${pm.highlightId === m.id ? " hl" : ""}`, "data-market": m.id, "data-price": `${m.yes}|${m.volume}` },
    el("div", { class: "pm-card-top" }, el("span", { class: "pm-tag" }, m.category), el("span", { class: "muted small" }, `${m.volume} Vol`)),
    el("p", { class: "pm-kicker" }, m.eventTitle || "Prediction question"),
    el("h4", {}, m.question),
    el("div", { class: "pm-card-odds" }, el("b", {}, `${m.yes}%`), el("small", {}, "chance"), m.session ? change(m.session) : null),
    pos ? el("div", { class: `pm-pos ${pos.side === "YES" ? "yes" : "no"}` }, el("span", {}, `You hold ${pos.shares.toFixed(2)} ${pos.side} @ ${pos.entry}¢`), el("b", {}, `${pos.pnl >= 0 ? "+" : ""}${usd(pos.pnl)}`)) : null,
    stakeInput(key),
    el("div", { class: "pm-buys" },
      buyBtn("yes", "Buy Yes", m.yes, !real, () => buy(key, m, "YES", pm.stakes[key])),
      buyBtn("no", "Buy No", 100 - m.yes, !real || !m.noTokenId, () => buy(key, m, "NO", pm.stakes[key]))),
    tradeLine(key),
    agentRead(m));
}

function agentRead(m) {
  const s = pm.signals[m.id], busy = pm.signalBusy === m.id, err = pm.signalError[m.id], ceo = ctx.state.agency?.ceo;
  return el("div", { class: "pm-signal" },
    el("p", { class: "pm-kicker" }, `# ${ceo ? `${ceo.name}'s read` : "agent signal"}`),
    s ? el("div", { class: `pm-read ${s.signal === "YES" ? "yes" : "no"}` },
      ceoAvatar(),
      el("div", { style: "min-width:0" },
        el("b", {}, s.agentName || ceo?.name || "Your CEO"),
        el("p", { class: "pm-read-call" }, `${s.signal} · ${CONFIDENCE_PCT[s.confidence] ?? 70}%`),
        s.reasoning ? el("p", { class: "pm-read-why" }, s.reasoning) : null))
      : el("button", { type: "button", class: "btn small pm-ask", disabled: busy || !m.tokenId || null, onclick: () => askAgent(m) }, busy ? "Reading market…" : ceo ? `Get ${ceo.name}'s read` : "Get my agent's read"),
    err ? el("p", { class: "pm-err" }, err) : null);
}
function ceoAvatar() {
  const p = ctx.ceoPortrait?.();
  return p ? el("span", { class: "pm-read-av" }, p) : el("span", { class: "pm-read-av ph" }, initials(ctx.state.agency?.ceo?.name));
}

// ---------------------------------------------------------------- match pulse
function renderPulse(view) {
  const fixtures = ctx.state.fixtures;
  if (!fixtures && !pm.fixturesRequested) {
    pm.fixturesRequested = true;
    ctx.loadFixtures?.().then(() => { if (pm.tab === "pulse") renderPulse(view); }).catch(() => {});
  }
  const filters = [["upcoming", "Upcoming"], ["live", "Live"], ["finished", "Finished"], ["all", "All"]];
  const now = Date.now();
  const list = !fixtures ? null : pm.pulseFilter === "live" ? fixtures.filter((f) => isLive(f.status))
    : pm.pulseFilter === "finished" ? fixtures.filter((f) => isFinished(f.status)).reverse()
    : pm.pulseFilter === "all" ? fixtures
    : fixtures.filter((f) => !isFinished(f.status) && Date.parse(f.kickoffAt) >= now - 3 * 3600e3);
  const count = (id) => (!fixtures ? 0 : id === "live" ? fixtures.filter((f) => isLive(f.status)).length : id === "finished" ? fixtures.filter((f) => isFinished(f.status)).length : 0);
  fill(view, el("div", { class: "pm-two" },
    panel("pm-fixtures",
      panelHead("Matches", "Top five European leagues · live from Kult Sports",
        el("div", { class: "filters" }, filters.map(([id, label]) => el("button", { type: "button", "aria-pressed": String(pm.pulseFilter === id), onclick: () => { pm.pulseFilter = id; renderPulse(view); } }, label, count(id) ? el("small", { class: "pm-count" }, count(id)) : null)))),
      !list ? skeleton(300) : !list.length ? el("p", { class: "empty-dash" }, `No ${pm.pulseFilter === "all" ? "" : `${pm.pulseFilter} `}matches right now.`) :
        el("div", { class: "pm-fx-list" }, list.slice(0, 60).map((f) => el("button", { type: "button", class: `pm-fx${isLive(f.status) ? " live" : ""}`, onclick: () => ctx.openMatch(f.fixtureId) },
          el("div", { class: "pm-fx-top" }, el("span", { class: "pm-tag" }, `${fmtDay(f.kickoffAt)} · ${fmtTime(f.kickoffAt)}`),
            isLive(f.status) ? liveDot("Live") : isFinished(f.status) ? el("span", { class: "pm-pill" }, "FT") : null, el("span", { class: "muted small" }, f.leagueName)),
          el("div", { class: "pm-fx-teams" }, el("span", {}, avatar(crestFor(f.homeTeam), f.homeTeam, "pm-flag"), f.homeTeam), el("em", {}, "VS"), el("span", {}, f.awayTeam, avatar(crestFor(f.awayTeam), f.awayTeam, "pm-flag"))))))),
    el("div", { id: "pm-news-slot" }, newsPanel("Football news & match facts", "Factual updates feeding the markets"))));
  if (!pm.news) loadNews();
}

function newsPanel(title, sub) {
  return panel("pm-news", panelHead(title, pm.news?.length ? "Live headlines · auto-refreshes" : sub, liveDot("")), el("div", { id: "pm-news-body" }, newsList()));
}
function newsList() {
  if (!pm.news) return skeleton(240);
  if (!pm.news.length) return el("p", { class: "empty-dash" }, "Headlines can't be loaded right now.");
  return el("div", { class: "pm-news-list" }, pm.news.map((n) => el("a", { class: "pm-news-item", href: n.link, target: "_blank", rel: "noopener noreferrer" },
    el("div", { class: "pm-news-top" }, el("span", { class: "pm-tag" }, n.source), el("span", { class: "muted small" }, n.timeLabel)),
    el("div", { class: "pm-news-main" }, n.image ? el("img", { src: n.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null,
      el("div", {}, el("b", {}, n.title), n.body ? el("p", {}, n.body) : null)))));
}
function renderNews() { const n = root?.querySelector("#pm-news-body"); if (n) fill(n, newsList()); }

// ---------------------------------------------------------------- analysis
function renderAnalysis() {
  const view = root?.querySelector("#pm-view");
  if (!view || pm.tab !== "analysis") return;
  if (!pm.resolved) loadResolved();
  if (!pm.trades) loadTrades();
  if (!pm.news) loadNews();
  if (!pm.leaders) loadLeaders();
  fill(view,
    el("div", { class: "pm-analysis" },
      el("div", { id: "pm-chart", class: "pm-a-chart" }),
      el("div", { class: "pm-a-movers" }, movers(pm.markets, "Trending movers", "Biggest price swings", true)),
      el("div", { class: "pm-a-left" }, topAgents(), el("div", { id: "pm-trades" }), resolvedPanel()),
      el("div", { class: "pm-a-right" }, newsPanel("News driving the board", "What's moving prices right now")),
      el("div", { id: "pm-positions", class: "pm-a-full" })));
  renderChart(); renderTrades(); renderPositions();
}

function selectChart(id) { pm.selectedId = id; renderChart(); }
function renderChart() {
  const n = root?.querySelector("#pm-chart");
  if (!n) return;
  const m = pm.markets.find((x) => x.id === pm.selectedId) || pm.markets[0];
  if (!m) return fill(n, panel("", el("p", { class: "empty-dash" }, "No live markets to chart.")));
  loadHistory(m);
  const series = pm.history[m.id]?.length > 1 ? pm.history[m.id] : null;
  const color = m.dir === "down" ? "#ff6b7d" : m.dir === "up" ? "#7cc4ff" : "#4fd8ff";
  const chips = pm.markets.slice(0, 30).map((x) => el("button", { type: "button", class: `pm-chip${x.id === m.id ? " on" : ""}`, onclick: () => selectChart(x.id) }, el("span", {}, x.short), el("b", { class: `pm-change ${x.dir}` }, `${x.yes}¢ `, arrow(x.dir))));
  fill(n, panel("pm-livechart",
    el("div", { class: "pm-lc-head" },
      el("div", { style: "min-width:0" }, el("p", { class: "pm-kicker" }, liveDot("Live price"), el("span", { class: "pm-tag" }, m.eventTitle || m.category)), el("h3", {}, m.question)),
      el("div", { class: "pm-lc-price" }, el("b", {}, m.yes, el("small", {}, "%")), change(m.session))),
    series ? linesChart([{ color, series }]) : el("div", { class: "pm-chart-wrap" }, el("p", { class: "pm-chart-empty" }, pm.history[m.id] ? "No price history for this market yet." : "Loading price history…")),
    el("div", { class: "pm-chips" }, chips)));
}

function topAgents() {
  const rows = pm.leaders;
  const accuracy = (record) => { const [w, l] = String(record || "0-0").split("-").map((x) => parseInt(x, 10) || 0); return w + l ? Math.round((w / (w + l)) * 100) : 0; };
  return panel("pm-agents",
    panelHead("Top agents", "Ranked by League reputation & prediction record", rows?.length ? el("span", { class: "pm-pill live" }, liveDot("Live standings")) : null),
    !rows ? el("div", { class: "pm-agent-grid" }, [0, 1, 2].map(() => skeleton(110))) :
      !rows.length ? el("p", { class: "empty-dash" }, pm.leadersError || "No ranked agents yet, check back once League picks start settling.") :
        el("div", { class: "pm-agent-grid" }, rows.map((r) => {
          const acc = accuracy(r.record);
          return el("article", { class: "pm-agent" },
            el("div", { class: "pm-agent-top" }, el("span", { class: `pm-rank${r.rank === 1 ? " gold" : ""}` }, r.rank), el("span", { class: "pm-agent-av" }, ctx.portraitFor?.(r.agentId) || initials(r.agentName)), el("b", {}, r.agentName)),
            el("div", { class: "pm-agent-stats" }, el("div", {}, el("small", {}, "Accuracy"), el("b", {}, `${acc}%`)), el("span", { class: "pm-pill gold" }, `${r.reputation} rep`)),
            el("div", { class: "pm-prob" }, el("i", { style: `width:${acc}%` })),
            el("p", { class: "pm-kicker" }, `${r.record} record · ${r.streak}W streak`));
        })));
}

function renderTrades() {
  const n = root?.querySelector("#pm-trades");
  if (!n) return;
  const list = pm.trades;
  fill(n, panel("pm-trades",
    panelHead("Recent trades", "Real fills on these markets, from Polymarket", liveDot("")),
    !list ? skeleton(160) : !list.length ? el("p", { class: "empty-dash" }, "No recent trades on these markets.") :
      el("div", { class: "pm-trade-list" }, list.map((t) => el("div", { class: "pm-trade" },
        el("span", { class: `pm-side ${/^no$/i.test(t.outcome) ? "no" : "yes"}` }, `${t.side} ${t.outcome || ""}`.trim()),
        el("span", { class: "pm-trade-who" }, t.trader),
        el("span", { class: "pm-trade-what", title: t.title }, t.title),
        el("b", {}, `${t.price}¢`), el("span", { class: "pm-gold" }, usd(t.size)))))));
}

function resolvedPanel() {
  const list = pm.resolved;
  return panel("pm-resolved",
    panelHead("Resolved markets", "Recently settled questions", el("span", { class: "muted small" }, `${list?.length ?? 0} settled`)),
    !list ? skeleton(120) : !list.length ? el("p", { class: "empty-dash" }, "No recently settled football markets found.") :
      el("div", { class: "pm-resolved-grid" }, list.map((m) => el("article", {},
        el("div", { style: "min-width:0" }, el("b", {}, m.question), el("p", { class: "pm-kicker" }, `${m.category} · settled ${m.settledLabel}`)),
        el("span", { class: `pm-side ${m.outcome === "YES" ? "yes" : "no"}` }, m.outcome)))));
}

function renderPositions() {
  const n = root?.querySelector("#pm-positions");
  if (!n) return;
  const rows = pm.positions, total = (rows || []).reduce((s, r) => s + r.pnl, 0);
  fill(n, panel("pm-positions",
    panelHead("Your positions", rows ? `${rows.length} open · live mark-to-market` : "Real Polymarket positions for your wallet",
      rows?.length ? el("b", { class: total >= 0 ? "pm-up" : "pm-down" }, `${total >= 0 ? "+" : ""}${usd(total)} P&L`) : null),
    !pm.wallet ? el("p", { class: "empty-dash" }, ctx.api.demo ? "Sign in to see your Polymarket positions." : "Connect your wallet above to see your positions.") :
      !rows ? skeleton(80) : !rows.length ? el("p", { class: "empty-dash" }, "No open Polymarket positions for this wallet yet.") :
        el("div", { class: "pm-table-wrap" }, el("table", { class: "lb pm-table" },
          el("thead", {}, el("tr", {}, ["Market", "Side", "Entry", "Current", "Shares", "P&L"].map((h, i) => el("th", { class: i > 1 ? "num" : null }, h)))),
          el("tbody", {}, rows.map((r) => el("tr", {},
            el("td", {}, r.question), el("td", {}, el("span", { class: `pm-side ${r.side === "YES" ? "yes" : "no"}` }, r.side)),
            el("td", { class: "num" }, `${r.entry}¢`), el("td", { class: "num" }, `${r.current}¢`), el("td", { class: "num" }, r.shares.toFixed(2)),
            el("td", { class: `num ${r.pnl >= 0 ? "pm-up" : "pm-down"}` }, `${r.pnl >= 0 ? "+" : ""}${usd(r.pnl)}`))))))));
}

// ---------------------------------------------------------------- formula 1
function f1Groups() {
  const byEvent = new Map();
  for (const m of pm.f1 || []) { const k = m.eventId ?? m.eventTitle ?? m.category; (byEvent.get(k) || byEvent.set(k, []).get(k)).push(m); }
  const lead = (list) => list[0]?.eventVolume || list.reduce((s, m) => s + m.volumeNum, 0);
  return [...byEvent.values()].map((list) => ({ title: list[0].eventTitle ?? list[0].category, list: list.sort((a, b) => b.yes - a.yes), volume: lead(list), liquidity: list[0]?.eventLiquidity ?? 0 }))
    .sort((a, b) => (b.list.length > 1) - (a.list.length > 1) || b.volume - a.volume);
}

function renderF1(body) {
  const groups = f1Groups();
  const stats = [["Events", groups.length], ["Outcomes", pm.f1?.length ?? 0], ["Volume", compactUsd(groups.reduce((s, g) => s + g.volume, 0))], ["Liquidity", compactUsd(groups.reduce((s, g) => s + g.liquidity, 0))]];
  fill(body,
    panel("pm-f1-head",
      el("div", { class: "pm-f1-title" }, el("span", { class: "pm-f1-ico" }, "F1"), el("div", {}, el("h3", {}, "Formula 1 markets ", liveDot("Live")), el("p", { class: "muted small" }, "Active markets from Polymarket"))),
      el("dl", { class: "pm-f1-stats" }, stats.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v)))),
      el("label", { class: "pm-stake pm-f1-stake" }, el("span", {}, "Trade"), el("span", { class: "pm-stake-box" }, "$", el("input", { type: "number", min: "0.1", step: "0.1", value: String(pm.f1Stake), "aria-label": "Trade amount in USDC", oninput: (e) => { pm.f1Stake = e.target.value; } })), el("span", {}, "USDC"))),
    !pm.f1 ? el("div", { class: "pm-grid f1" }, [0, 1, 2].map(() => skeleton(220))) :
      !groups.length ? el("p", { class: "empty-dash" }, "No live Formula 1 markets on Polymarket right now, check back later.") :
        el("div", { class: "pm-grid f1" }, groups.map((g) => f1Section(g))));
}

const driverPhoto = (label) => pm.drivers.get(normDriver(label));
function f1Section(g) {
  const grouped = g.list.length > 1, lead = g.list[0];
  return el("section", { class: "pm-panel pm-f1-card" },
    el("div", { class: "pm-f1-card-head" },
      lead.eventImage ? el("img", { class: "pm-ev-icon", src: lead.eventImage, alt: "", referrerpolicy: "no-referrer" }) : el("span", { class: "pm-ev-icon ph" }, "F1"),
      el("h4", {}, g.title),
      grouped ? null : el("div", { class: "pm-gauge", style: `--p:${lead.yes}` }, el("b", {}, `${lead.yes}%`), el("small", {}, "chance"))),
    el("div", { class: "pm-f1-rows" }, g.list.slice(0, grouped ? 2 : 1).map((m) => f1Row(m, grouped))),
    el("div", { class: "pm-f1-foot" }, el("span", {}, `${compactUsd(g.volume)} Vol.`),
      grouped && g.list.length > 2 ? el("button", { type: "button", class: "linkish", onclick: () => openF1Drawer(g) }, `View all ${g.list.length} ›`) : null));
}

function f1Row(m, grouped) {
  const key = `f1:${m.id}`, label = m.outcomeLabel ?? m.short, pos = positionFor(m.conditionId), open = pm.f1Expanded === m.id, real = Boolean(m.tokenId);
  if (open) loadSignals(m.id);
  return el("div", { class: `pm-f1-row${open ? " open" : ""}`, "data-market": m.id },
    el("div", { class: grouped ? "pm-f1-line" : "pm-f1-line single" },
      grouped ? avatar(driverPhoto(label), label, "pm-driver") : null,
      grouped ? el("div", { style: "min-width:0" }, el("b", { title: m.question }, label), pos ? el("p", { class: `pm-hold ${pos.side === "YES" ? "pm-up" : "pm-down"}` }, `Holding ${pos.shares.toFixed(2)} ${pos.side} · ${pos.pnl >= 0 ? "+" : ""}${usd(pos.pnl)}`) : null) : null,
      grouped ? el("span", { class: "pm-f1-pct" }, `${m.yes}%`) : null,
      el("button", { type: "button", class: `pm-askbtn${open ? " on" : ""}`, title: "Ask your CEO for a market read", "aria-label": `Ask my agent about ${label}`, onclick: () => { pm.f1Expanded = open ? null : m.id; renderBody(); } }, "✦", grouped ? null : " Ask"),
      buyBtn("yes", "Yes", m.yes, !real, () => buy(key, m, "YES", pm.f1Stake)),
      buyBtn("no", "No", 100 - m.yes, !real || !m.noTokenId, () => buy(key, m, "NO", pm.f1Stake))),
    tradeLine(key),
    open ? agentRead(m) : null);
}

function openF1Drawer(g) {
  let q = "";
  const list = el("div", { class: "pm-drawer-list" });
  const paint = () => fill(list, (() => { const rows = g.list.filter((m) => `${m.outcomeLabel ?? ""} ${m.question}`.toLowerCase().includes(q)); return rows.length ? rows.map((m) => f1Row(m, true)) : el("p", { class: "empty-dash" }, `No outcomes match “${q}”.`); })());
  const sheet = openSheet("pm-drawer",
    el("div", { class: "pm-drawer-head" }, g.list[0].eventImage ? el("img", { class: "pm-ev-icon", src: g.list[0].eventImage, alt: "", referrerpolicy: "no-referrer" }) : null,
      el("div", {}, el("h2", { class: "display" }, g.title), el("p", { class: "muted small" }, `${g.list.length} outcomes · ${compactUsd(g.volume)} Vol.`))),
    el("input", { type: "search", placeholder: "Search outcomes", "aria-label": "Search outcomes", oninput: (e) => { q = e.target.value.trim().toLowerCase(); paint(); } }),
    list);
  paint();
  drawerPaint = paint;
  // Rows inside the sheet re-render the board when expanded; keep the sheet in sync.
  sheet.addEventListener("click", (e) => { if (e.target.closest(".pm-askbtn")) setTimeout(paint, 0); });
  sheet.onClose = () => { if (drawerPaint === paint) drawerPaint = null; };
}

// ---------------------------------------------------------------- sheets: fund + withdraw
function openSheet(cls, ...kids) {
  const overlay = el("div", { class: `overlay pm-overlay ${cls}`, role: "dialog", "aria-modal": "true" });
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); overlay.onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  overlay.append(el("div", { class: "sheet wide" }, el("button", { type: "button", class: "close", "aria-label": "Close", onclick: close }, "×"), ...kids));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  overlay.close = close;
  return overlay;
}

async function openFund() {
  const w = pm.wallet;
  if (!w) return;
  const TABS = [["evm", "EVM chains"], ["svm", "Solana"], ["btc", "Bitcoin"], ["tvm", "Tron"]];
  let tab = "evm", addresses = null, assets = null, error = null, status = null;
  const body = el("div", { class: "pm-fund" });
  const paint = () => {
    const mins = new Map();
    for (const a of assets || []) {
      if (lib.addressTypeForChainId(a.chainId) !== tab) continue;
      const isUsdc = a.token.symbol.toUpperCase().includes("USDC"), cur = mins.get(a.chainName);
      if (!cur || (isUsdc && !cur.isUsdc) || (isUsdc === cur.isUsdc && a.minCheckoutUsd < cur.min)) mins.set(a.chainName, { min: a.minCheckoutUsd, isUsdc });
    }
    const addr = addresses ? (tab === "tvm" ? addresses.tron : addresses[tab]) : null;
    fill(body,
      el("div", { class: "filters" }, TABS.map(([id, label]) => el("button", { type: "button", "aria-pressed": String(tab === id), onclick: () => { tab = id; status = null; paint(); } }, label))),
      error ? el("p", { class: "error" }, error) : !addresses ? el("p", { class: "muted" }, "Getting your deposit addresses…") :
        el("div", { class: "pm-addr" },
          el("p", { class: "pm-kicker" }, `Your ${TABS.find((t) => t[0] === tab)[1]} deposit address`),
          el("code", {}, addr || "Not available for this network"),
          addr ? el("div", { class: "row" },
            el("button", { type: "button", class: "btn small", onclick: async (e) => { try { await navigator.clipboard.writeText(addr); e.currentTarget.textContent = "Copied"; } catch { /* still on screen */ } } }, "Copy address"),
            el("button", { type: "button", class: "btn small ghost", onclick: async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = "Checking…"; try { status = await lib.polymarketBridgeApi.getStatus(addr); } catch (err) { status = { status: err.message }; } paint(); } }, "Check status")) : null,
          status ? el("p", { class: "muted small" }, `Status: ${typeof status.status === "string" ? status.status : JSON.stringify(status).slice(0, 200)}`) : null),
      mins.size ? el("div", { class: "pm-mins" }, el("p", { class: "pm-kicker" }, "Minimum deposit"), el("ul", {}, [...mins].map(([chain, v]) => el("li", {}, el("span", {}, chain), el("b", {}, `$${v.min}`))))) : null,
      el("p", { class: "muted small" }, "Only send supported assets to this address. Sending an unsupported token can result in a loss of funds. Deposits arrive in your Polymarket wallet as pUSD, ready to trade."));
  };
  openSheet("pm-fund-sheet",
    el("h2", { class: "display" }, "Fund your Polymarket wallet"),
    el("p", { class: "muted" }, "Send USDC (or another supported asset) from any chain below. Polymarket converts it to pUSD in your wallet, even if you only hold native USDC, not USDC.e."),
    body);
  paint();
  try { [addresses, assets] = await Promise.all([lib.polymarketBridgeApi.getDepositAddresses(w.depositWallet), lib.polymarketBridgeApi.getSupportedAssets().catch(() => [])]); }
  catch { error = "Couldn't reach Polymarket's bridge right now. Try again shortly."; }
  paint();
}

function openWithdraw() {
  const w = pm.wallet;
  if (!w) return;
  const amount = el("input", { type: "number", min: "0.01", step: "0.01", inputmode: "decimal", placeholder: "0.00", "aria-label": "Amount in pUSD" });
  const dest = el("input", { placeholder: "0x…", autocomplete: "off", spellcheck: "false", value: w.address, "aria-label": "Destination Polygon address" });
  const line = el("p", { class: "pm-trade-line", "aria-live": "polite" });
  const go = el("button", { type: "submit", class: "btn primary" }, "Withdraw");
  const form = el("form", { class: "pm-withdraw" },
    el("label", { class: "field" }, el("span", {}, "Amount ", el("button", { type: "button", class: "linkish", onclick: () => { amount.value = String(Math.floor((pm.wallet?.pusd || 0) * 100) / 100); } }, `Max ${usd(w.pusd)}`)), amount),
    el("label", { class: "field" }, "Send to (Polygon address)", dest),
    el("p", { class: "muted small" }, "Any Polygon address works, it doesn't have to be this wallet. One signature, no gas."),
    line, el("div", { class: "actions" }, go));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    go.disabled = true;
    try {
      const label = (s) => fill(line, STATUS_LABEL[s] ? el("span", { class: "pm-busy" }, el("i", { class: "pm-spin" }), STATUS_LABEL[s]) : null);
      const out = await lib.createTrader(await playerWallet(), label).withdraw(Number(amount.value), dest.value.trim());
      fill(line, el("span", { class: "pm-ok" }, `✓ Withdrawal submitted${out?.transactionID ? ` · ${String(out.transactionID).slice(0, 10)}…` : ""}`));
      refreshWallet(true);
    } catch (err) {
      fill(line, el("span", { class: "pm-err" }, /closed|exited|cancel|rejected/i.test(String(err?.message)) ? "Cancelled." : err.message));
    }
    go.disabled = false;
  });
  openSheet("pm-withdraw-sheet", el("h2", { class: "display" }, "Withdraw pUSD"), el("p", { class: "muted" }, `Tradeable balance: ${usd(w.pusd)}`), form);
}
