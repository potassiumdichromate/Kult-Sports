// Kult Sports: sign-in, the office, and the flows that tie the screens to the
// API (see docs/KULT_SPORTS_FRONTEND_BRIEF.md).

import { createApi } from "./api.js";
import { createDemoApi } from "./demo.js";
import { Office, SPECIALTY_COLORS } from "./world.js";
import { archetypePortrait } from "./office3d.js";
import { $, el, show, toast, toastError, busy, fmtPts, fmtCredits, fmtCountdown, MARKET_LABEL, outcomeText, lineIcon } from "./ui.js";
import * as V from "./views.js";
import { mountPolymarket, unmountPolymarket } from "./polymarket.js";
import { createTour } from "./tour.js";

const params = new URLSearchParams(location.search);
// ?demo=1 / ?demo=fresh: the offline demo; ?demo=0: the real game even when the server defaults to the demo.
const demoMode = params.get("demo") === "0" ? null : params.get("demo");
// The Kult browser opens the game with the player's AI Arena token in the
// URL. Take it, then remove it from the address bar and history at once.
const handoff = params.get("jwt");
if (handoff) {
  params.delete("jwt"); params.delete("source");
  history.replaceState(null, "", `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`);
}
// Back from Hello Minds after "Let your Mind direct" (server.mjs redirects
// /minds/callback here). Keep the OAuth code and state for the Minds island,
// then clean the address bar.
const mindsCallback = params.has("mindsCallback") ? `?${params}` : null;
if (mindsCallback) history.replaceState(null, "", `${location.pathname}${location.hash}`);

// The API client needs config.json (its address), so it's created in boot().
let api = demoMode ? createDemoApi({ fresh: demoMode === "fresh" }) : null;
const state = {
  cfg: {}, me: null, agency: null, fixtures: null, talent: null, predictions: null, ledger: null,
  leaderboards: {}, lbKind: "weekly", matchFilter: "upcoming", room: null, view: "office", inOffice: false, analysing: false,
  // Your Mind directs: the link status, the account's Minds (when choosing), and a key shown once.
  mind: null, mindsList: null, mindKey: null
};
const canvas = $("office"), office = new Office(canvas);
if (new URLSearchParams(location.search).has("debug")) window.ks = { office };

// ------------------------------------------------------------------ shared context for views
const ctx = {
  state,
  go: (v) => setView(v),
  openMatch: (id) => openMatch(id),
  runAnalysis: (id) => runAnalysis(id),
  savePicks: (id, draft, btn) => savePicks(id, draft, btn),
  lockPicks: (id, draft, btn) => lockPicks(id, draft, btn),
  hire: (c, btn) => hire(c, btn),
  fire: (a, btn) => fire(a, btn),
  openAnalyst: (id) => openAnalyst(id),
  changeCeo: (id, btn) => changeCeo(id, btn),
  connectMind: (btn) => connectMind(btn),
  chooseMind: (id, btn) => chooseMind(id, btn),
  newMindKey: (btn) => newMindKey(btn),
  unlinkMind: (btn) => unlinkMind(btn),
  loadLeaders: (k) => loadLeaders(k),
  closeSheet: (id) => show(id, false),
  signOut: () => signOutEverywhere(),
  portrait: (analystId) => { const p = office.person(analystId); return p ? office.portraitOf(p.look) : office.portraitOf(office.lookFor(analystId)); },
  portraitFor: (key) => office.portraitOf(office.lookFor(key)),
  // Polymarket: the Privy island (wallet), a fresh AI Arena token, the CEO's portrait.
  loadPrivy: () => loadPrivy(),
  arenaToken: () => freshArenaToken(),
  ceoPortrait: () => ceoPortrait(),
  loadFixtures: () => api.fixtures().then((fx) => applyFixtures(fx.fixtures))
};

// The CEO's 3D portrait, rendered once per archetype; each call gets its own copy.
const ceoPortraits = new Map();
function ceoPortrait() {
  const arch = state.agency ? ceoInfo(state.agency).archetype : "HYBRID";
  if (!ceoPortraits.has(arch)) ceoPortraits.set(arch, archetypePortrait("models/", arch));
  const ph = el("span", { class: "ph" });
  ceoPortraits.get(arch).then((c) => {
    if (!c || !ph.isConnected) return;
    const copy = document.createElement("canvas");
    copy.width = c.width; copy.height = c.height;
    copy.getContext("2d").drawImage(c, 0, 0);
    ph.replaceWith(copy);
  });
  return ph;
}

// ------------------------------------------------------------------ office loop
function fit() {
  const box = $("stage").getBoundingClientRect();
  if (!box.width || !box.height) return;
  office.setInsets(stageInsets(box));
  office.resize(box.width, box.height);
}

// On desktop the office fills the screen and panels float over it: frame the
// room in the space they leave (the canvas still draws behind them).
function stageInsets(box) {
  if (getComputedStyle($("stage")).position !== "fixed") return { top: 0, right: 0, bottom: 0, left: 0 };
  const r = (id) => { const n = $(id); return n && !n.hidden && n.getClientRects().length ? n.getBoundingClientRect() : null; };
  const hud = r("hud"), feed = r("feed"), con = r("console"), nav = r("sidebar");
  // The nav is a rail on the left on desktop (a bar along the bottom on phones).
  const rail = nav && nav.right < box.left + box.width / 3 ? nav : null;
  const lows = [con, !rail ? nav : null].filter(Boolean).map((x) => x.top);
  return {
    top: hud ? hud.bottom - box.top + 6 : 0,
    right: feed ? box.right - feed.left + 6 : 0,
    bottom: lows.length ? box.bottom - Math.min(...lows) + 6 : 0,
    left: rail ? rail.right - box.left + 6 : 16
  };
}
{
  const ro = new ResizeObserver(() => fit());
  for (const id of ["stage", "hud", "feed", "console", "sidebar"]) if ($(id)) ro.observe($(id));
}

const bubbles = new Map();
function say(id, text, ms = 4200) {
  const p = office.person(id);
  if (!p) return;
  bubbles.get(id)?.node.remove();
  const color = p.isCeo ? "var(--gold)" : SPECIALTY_COLORS[p.specialty] || "var(--accent)";
  const node = el("div", { class: "bubble" }, el("b", { style: `color:${color}` }, p.isCeo ? `${p.name} · CEO` : p.name), text);
  $("bubbles").append(node);
  bubbles.set(id, { node, until: performance.now() + ms });
}
function placeBubbles(now) {
  const rect = canvas.getBoundingClientRect(), stage = $("stage").getBoundingClientRect(), k = rect.width / office.W;
  for (const [id, b] of bubbles) {
    const a = office.anchor(id);
    if (!a || now > b.until + 400) { b.node.remove(); bubbles.delete(id); continue; }
    if (now > b.until) b.node.classList.add("fade");
    b.node.style.left = `${rect.left - stage.left + a[0] * k}px`;
    b.node.style.top = `${rect.top - stage.top + a[1] * k - 4}px`;
  }
}
let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.inOffice && $("stage").getClientRects().length) { office.update(dt); office.draw(); placeBubbles(now); }
  else for (const [id, b] of bubbles) if (now > b.until) { b.node.remove(); bubbles.delete(id); } // don't replay old lines later
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

const toOffice = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * office.W, ((e.clientY - r.top) / r.height) * office.H]; };
canvas.addEventListener("pointermove", (e) => {
  const [x, y] = toOffice(e), p = office.hit(x, y), d = p ? -1 : office.hitDesk(x, y);
  office.hoverDesk = d;
  canvas.style.cursor = p || d >= 0 ? "pointer" : "default";
  const tip = $("tooltip");
  if (p) {
    tip.textContent = p.isCeo ? `${p.name} · CEO` : `${p.name} · ${p.title}`;
    const r = canvas.getBoundingClientRect(), s = $("stage").getBoundingClientRect();
    tip.style.left = `${e.clientX - s.left}px`; tip.style.top = `${e.clientY - s.top - 6}px`;
    tip.hidden = false;
    void r;
  } else tip.hidden = true;
});
canvas.addEventListener("pointerleave", () => { $("tooltip").hidden = true; office.hoverDesk = -1; });
canvas.addEventListener("click", (e) => {
  if (state.analysing || office.dragged) return;
  const [x, y] = toOffice(e), p = office.hit(x, y);
  if (p?.isCeo) return setView("agency");
  if (p) return openAnalyst(p.id);
  if (office.hitDesk(x, y) >= 0) setView("talent");
});

// ------------------------------------------------------------------ feed
// icon: a line icon name (e.g. "whistle") shown in place of the colour dot.
function log(who, text, color = "var(--accent)", cls = "", icon = null) {
  const list = $("log");
  list.querySelector(".empty")?.remove();
  const mark = icon ? lineIcon(icon, "feed-ico") : el("span", { class: "dot" });
  list.append(el("li", { class: cls, style: `--c:${color}` }, mark, el("div", {}, el("span", { class: "who" }, who), text)));
  while (list.children.length > 80) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}
const logSystem = (text) => log("Agency", text, "var(--gold)", "system");

// ------------------------------------------------------------------ icons
function setupIcons() {
  for (const slot of document.querySelectorAll(".ico-slot")) slot.replaceChildren(lineIcon(slot.dataset.icon));
  document.querySelector(".logo")?.replaceChildren(lineIcon("emblem", "logo-ico"));
}

// ------------------------------------------------------------------ sign-in
const SCREENS = ["entrance", "found", "no-agent"];
function showScreen(id) {
  show("booting", false);
  for (const s of SCREENS) show(s, s === id);
}
function showEntrance(message) {
  state.inOffice = false;
  for (const id of ["hud", "sidebar", "stage", "console", "feed"]) show(id, false);
  for (const id of Object.values(PANELS)) show(id, false);
  show("sign-in", Boolean(state.cfg.privyAppId) && !api.demo);
  show("kult-browser-hint", !state.cfg.privyAppId);
  show("paste", location.hostname === "localhost" || location.hostname === "127.0.0.1" || params.has("dev"));
  $("entrance-error").textContent = message || "";
  show("entrance-error", Boolean(message));
  showScreen("entrance");
}

let privyApi = null;
async function loadPrivy() {
  if (privyApi !== null) return privyApi || null;
  privyApi = false;
  if (api.demo || !state.cfg.privyAppId) return null;
  try {
    const mod = await import("../privy/kult-privy.js");
    privyApi = await mod.init({ appId: state.cfg.privyAppId, clientId: state.cfg.privyClientId || undefined });
  } catch (e) {
    console.warn("[kult-sports] Privy login unavailable", e);
    privyApi = false;
  }
  return privyApi || null;
}
async function sessionFromPrivy(privy) {
  const { accessToken } = await privy.tokens();
  return api.startSession(await api.arenaTokenFromPrivy(accessToken));
}

$("sign-in").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  show("entrance-error", false);
  busy(btn, true, "Signing in…");
  try {
    const privy = await loadPrivy();
    if (!privy) throw new Error("Sign-in isn't available here. Open Kult Sports from the Kult browser.");
    await privy.login();
    enter(await sessionFromPrivy(privy));
  } catch (e) {
    if (!/closed|exited|cancel/i.test(String(e?.message || e))) { $("entrance-error").textContent = e?.message || "Sign-in failed"; show("entrance-error"); }
  } finally { busy(btn, false); }
});
$("paste-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = $("paste-token").value.trim();
  if (!token) return;
  try { enter(await api.startSession(token)); } catch (err) { $("entrance-error").textContent = err.message; show("entrance-error"); }
});

async function signOutEverywhere() {
  api.signOut();
  try { await privyApi?.logout?.(); } catch { /* already out */ }
  location.href = location.pathname + (api.demo ? `?demo=${demoMode}` : "");
}
for (const b of document.querySelectorAll(".sign-out")) b.addEventListener("click", signOutEverywhere);

let expiring = false;
async function sessionExpired() {
  if (expiring) return;
  expiring = true;
  try {
    const privy = await loadPrivy();
    if (privy?.authenticated) { await sessionFromPrivy(privy); toast("Session renewed."); expiring = false; return; }
  } catch { /* fall through */ }
  expiring = false;
  showEntrance("Your session ended. Sign in again, or reopen Kult Sports from the Kult browser.");
}

function enter(out) {
  state.me = { player: out.player, agents: out.agents || [] };
  if (out.agency) return enterOffice(out.agency);
  const usable = state.me.agents.filter((a) => !a.isRetired);
  if (!usable.length) { $("no-agent-create").href = state.cfg.aiArenaUrl || "https://app.kult.games"; return showScreen("no-agent"); }
  showFound(usable);
}

function showFound(agents) {
  setTimeout(() => { if (!$("found").hidden) tour.offer("f-hello", forceTour); }, 400);
  $("found-player").textContent = state.me.player?.username || state.me.player?.walletAddress || "your KULT account";
  const list = $("found-agents");
  state.ceoPick = agents[0];
  // The archetype's 3D model, rendered once it loads.
  const portrait = (a) => {
    const ph = el("span", { class: "ph" });
    archetypePortrait("models/", a.archetype).then((c) => { if (c) ph.replaceWith(c); });
    return ph;
  };
  list.replaceChildren(...agents.map((a) => {
    const b = el("button", { type: "button", class: "ceo-pick agent-pick", "aria-pressed": a === state.ceoPick ? "true" : "false", onclick: () => {
      for (const x of list.children) x.setAttribute("aria-pressed", "false");
      b.setAttribute("aria-pressed", "true");
      state.ceoPick = a;
    } }, portrait(a), el("b", {}, a.name), el("span", { class: "meta" }, [a.clan, a.archetype?.toLowerCase(), a.eloRating ? `ELO ${a.eloRating}` : null].filter(Boolean).join(" · ")));
    return b;
  }));
  showScreen("found");
  $("found-name").focus();
}
$("found-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("found-error"), btn = $("found-btn"), name = $("found-name").value.trim();
  err.hidden = true;
  if (!/^[A-Za-z0-9 '&.-]{3,32}$/.test(name)) { err.textContent = "Use 3–32 letters, numbers, spaces and ' & . -"; err.hidden = false; return; }
  if (!state.ceoPick) { err.textContent = "Pick your CEO."; err.hidden = false; return; }
  busy(btn, true, "Opening…");
  try { enterOffice(await api.createAgency(name, state.ceoPick.id), true); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { busy(btn, false); }
});
$("no-agent-retry").addEventListener("click", async () => { try { enter(await api.me()); } catch (e) { toastError(e); } });

// ------------------------------------------------------------------ agency state
function ceoInfo(a) {
  const agent = state.me?.agents?.find((x) => x.id === a.ceo.agentId);
  return { name: a.ceo.name, archetype: agent?.archetype || "HYBRID" };
}
function applyAgency(a) {
  const prev = state.agency;
  state.agency = a;
  $("agency-name").textContent = a.name;
  $("agency-sub").textContent = `${a.staff.length} analyst${a.staff.length === 1 ? "" : "s"} · ${a.desks} desks`;
  $("ceo-badge").textContent = `CEO ${a.ceo.name}${a.ceo.clan ? ` · ${a.ceo.clan}` : ""}`;
  $("hud-level").textContent = a.level;
  $("hud-points").textContent = fmtPts(a.points);
  const prevAt = [0, 50, 150, 300, 500][a.level - 1] ?? 0;
  $("hud-level-bar").style.width = `${a.nextLevelAt ? Math.max(0, Math.min(100, ((a.points - prevAt) / (a.nextLevelAt - prevAt)) * 100)) : 100}%`;
  const credits = $("credits");
  credits.textContent = fmtCredits(a.credits);
  if (prev && prev.credits !== a.credits) { credits.parentElement.classList.remove("bump"); void credits.offsetWidth; credits.parentElement.classList.add("bump"); }
  office.setAgency({ ceo: ceoInfo(a), staff: a.staff, desks: a.desks });
  if (prev && a.level > prev.level) {
    office.celebrate(5); office.confetti();
    logSystem(`Level ${a.level}! A new desk is ready: ${a.desks} desks now.`);
    toast(`Level ${a.level}: +1 desk`);
  }
  if (prev && a.staff.length < prev.staff.length) {
    const gone = prev.staff.filter((s) => !a.staff.some((x) => x.id === s.id));
    for (const g of gone) if (!state.firing?.has(g.id)) logSystem(`${g.name} has left the agency.`);
  }
  if (state.view !== "office" && PANELS[state.view]) renderView(state.view);
}

async function refreshAll() {
  try {
    const [a, fx] = await Promise.all([api.agency(), api.fixtures()]);
    applyAgency(a);
    applyFixtures(fx.fixtures);
  } catch (e) { if (e.status !== 401) console.warn("[kult-sports] refresh failed", e); }
}

function applyFixtures(list) {
  const prev = new Map((state.fixtures || []).map((f) => [f.fixtureId, f]));
  state.fixtures = list;
  for (const f of list) {
    const was = prev.get(f.fixtureId)?.prediction?.status;
    if (was && was !== "SETTLED" && f.prediction?.status === "SETTLED") {
      log("Full time", `${f.homeTeam} v ${f.awayTeam}: +${fmtPts(f.prediction.points)} points, ${fmtCredits(Math.round(f.prediction.points * 10))} credits.`, "var(--accent)", "", "whistle");
      office.screen = { mode: "result", title: `${f.homeTeam} v ${f.awayTeam}`, big: `+${fmtPts(f.prediction.points)} PTS`, lines: ["CHECK THE MATCH ROOM"] };
      office.celebrate(4);
      toast(`Result in: +${fmtPts(f.prediction.points)} points`);
    }
  }
  if (!state.analysing && office.screen.mode !== "result") idleScreen();
  V.renderConsole($("console"), ctx);
  if (state.view === "matches") renderView("matches");
}

function idleScreen() {
  const next = (state.fixtures || []).filter((f) => f.open).sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt))[0];
  office.screen = next ? { mode: "idle", title: `${short(next.homeTeam)} v ${short(next.awayTeam)}`, sub: next.leagueName } : { mode: "idle", title: null };
}
const short = (team) => (team.length > 10 ? team.split(" ").map((w) => w[0]).join("").slice(0, 3) : team);

let pollTimer = null;
async function enterOffice(agency, fresh = false) {
  for (const s of SCREENS) show(s, false);
  show("booting", false);
  for (const id of ["hud", "sidebar", "stage", "console", "feed"]) show(id, true);
  state.inOffice = true;
  applyAgency(agency);
  fit(); requestAnimationFrame(fit);
  setView("office");
  logSystem(fresh ? `Welcome to ${agency.name}! You have ${fmtCredits(agency.credits)} credits. Hire analysts, then analyse a match.` : `Welcome back to ${agency.name}.`);
  if (agency.credits < agency.payroll.weeklyTotal) logSystem(`Payday needs ${fmtCredits(agency.payroll.weeklyTotal)} credits and you have ${fmtCredits(agency.credits)}. Win points before Monday.`);
  setTimeout(() => say("ceo", fresh ? "Welcome to the agency! Let's hire a desk." : agency.staff.length ? "Morning, team. Who's playing today?" : "Empty desks… let's find some analysts."), 700);
  try { applyFixtures((await api.fixtures()).fixtures); } catch (e) { if (e.status !== 401) { state.fixtures = []; V.renderConsole($("console"), ctx); toastError(e); } }
  if (mindsCallback) finishMindsLink();
  // A player who founded the agency mid-tour carries on with it; anyone else new gets it here.
  if (!tour.running && !mindsCallback) setTimeout(() => { if (state.inOffice && state.view === "office") tour.offer("o-hello", forceTour); }, 1500);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === "visible" && state.inOffice && !state.analysing) refreshAll(); }, 90_000);
}

// ------------------------------------------------------------------ views
const PANELS = { matches: "matches-view", match: "match-view", talent: "talent-view", history: "history-view", leaders: "leaders-view", agency: "agency-view", polymarket: "polymarket-view" };
function setView(view) {
  if (state.view === "polymarket" && view !== "polymarket") unmountPolymarket();
  state.view = view;
  document.body.classList.toggle("panel-open", view in PANELS);
  for (const [name, id] of Object.entries(PANELS)) show(id, name === view);
  const navView = view === "match" ? "matches" : view;
  for (const b of document.querySelectorAll(".nav-item")) {
    const on = b.dataset.view === navView;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  if (view === "office") { fit(); return; }
  renderView(view);
  $(PANELS[view]).scrollTop = 0;
  if (view === "talent") api.talent().then((t) => { state.talent = t; if (state.view === "talent") renderView("talent"); }).catch(toastError);
  if (view === "history") api.predictions().then((p) => { state.predictions = p.predictions; if (state.view === "history") renderView("history"); }).catch(toastError);
  if (view === "agency") api.ledger().then((l) => { state.ledger = l; if (state.view === "agency") renderView("agency"); }).catch(toastError);
  if (view === "agency" && state.cfg.mindsClientId && !api.demo) loadMindStatus();
  if (view === "leaders") loadLeaders(state.lbKind);
  if (view === "matches" && !state.fixtures) api.fixtures().then((fx) => applyFixtures(fx.fixtures)).catch(toastError);
}
function renderView(view) {
  const root = $(PANELS[view]);
  if (!root || !state.agency) return;
  ({ matches: V.renderMatches, match: V.renderMatchRoom, talent: V.renderTalent, history: V.renderHistory, leaders: V.renderLeaders, agency: V.renderAgency, polymarket: mountPolymarket })[view](root, ctx);
}
for (const b of document.querySelectorAll(".nav-item")) b.addEventListener("click", () => { if (!state.analysing) setView(b.dataset.view); });
for (const b of document.querySelectorAll("[data-view-link]")) b.addEventListener("click", () => setView(b.dataset.viewLink));
for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", () => show(b.dataset.close, false));

async function loadLeaders(kind) {
  state.lbKind = kind;
  renderView("leaders");
  try { state.leaderboards[kind] = await api.leaderboard(kind, { limit: 50 }); renderView("leaders"); } catch (e) { toastError(e); }
}

// Live countdowns everywhere (data-until), once a second.
setInterval(() => {
  for (const n of document.querySelectorAll("[data-until]")) {
    const left = Date.parse(n.dataset.until) - Date.now();
    n.textContent = `${n.dataset.prefix || ""}${left > 0 ? fmtCountdown(left) : "now"}`;
    if (left <= 0 && n.dataset.onZero === "room" && !n.dataset.fired && state.room) { n.dataset.fired = "1"; reloadRoom(); }
  }
}, 1000);

// ------------------------------------------------------------------ confirm
function confirmBox(title, text, yes = "Confirm") {
  return new Promise((resolve) => {
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    $("confirm-yes").textContent = yes;
    show("confirm");
    const done = (v) => { show("confirm", false); $("confirm-yes").onclick = $("confirm-no").onclick = null; resolve(v); };
    $("confirm-yes").onclick = () => done(true);
    $("confirm-no").onclick = () => done(false);
  });
}

// ------------------------------------------------------------------ match room
async function openMatch(id) {
  state.room = { fixtureId: id, data: null, draft: null };
  setView("match");
  await reloadRoom();
}
async function reloadRoom() {
  const id = state.room?.fixtureId;
  if (!id) return;
  try {
    const data = await api.fixture(id);
    if (state.room?.fixtureId !== id) return;
    state.room.data = data;
    state.room.draft = null;
    if (state.view === "match") renderView("match");
  } catch (e) { toastError(e); if (e.status === 404) setView("matches"); }
}
function syncFixture(id, prediction) {
  const f = state.fixtures?.find((x) => String(x.fixtureId) === String(id));
  if (f) f.prediction = prediction ? { status: prediction.status, points: prediction.points } : null;
  V.renderConsole($("console"), ctx);
}

async function savePicks(id, draft, btn) {
  busy(btn, true, "Saving…");
  try {
    const { prediction } = await api.editPrediction(id, { outcome: draft.outcome, score: draft.score, corners: draft.corners, cards: draft.cards, scorerId: draft.scorerId || null });
    state.room.data.prediction = prediction;
    state.room.draft = null;
    renderView("match");
    toast("Picks saved.");
  } catch (e) { toastError(e); busy(btn, false); }
}

async function lockPicks(id, draft, btn) {
  if (!(await confirmBox("Lock your picks?", "Once locked they can't be changed. Points arrive after the final whistle.", "Lock picks"))) return;
  busy(btn, true, "Locking…");
  try {
    if (draft) await api.editPrediction(id, { outcome: draft.outcome, score: draft.score, corners: draft.corners, cards: draft.cards, scorerId: draft.scorerId || null });
    const { prediction } = await api.lock(id);
    state.room.data.prediction = prediction;
    state.room.draft = null;
    syncFixture(id, prediction);
    renderView("match");
    const f = state.room.data.fixture;
    log(`${state.agency.ceo.name} · CEO`, `Locked: ${outcomeText(prediction.picks.outcome, f)}, ${prediction.picks.score.home}-${prediction.picks.score.away}, ${prediction.picks.corners} corners, ${prediction.picks.cards} cards${prediction.picks.scorerName ? `, ${prediction.picks.scorerName} to score` : ""}.`, "var(--gold)");
    office.screen = { mode: "picks", locked: true, title: `${short(f.homeTeam)} v ${short(f.awayTeam)}`, lines: picksLines(prediction.picks, f) };
    toast("Picks locked. Good luck!");
  } catch (e) { toastError(e); busy(btn, false); }
}
const picksLines = (p, f) => [
  `${p.outcome === "DRAW" ? "DRAW" : `${short(p.outcome === "HOME" ? f.homeTeam : f.awayTeam)} WIN`} ${p.score.home}-${p.score.away}`,
  `${p.corners} CORNERS · ${p.cards} CARDS`,
  p.scorerName ? `${p.scorerName} TO SCORE` : "NO SCORER"
];

// The desk analysis, played out in the office.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function runAnalysis(id) {
  if (state.analysing) return;
  const f = state.room?.data?.fixture || state.fixtures?.find((x) => String(x.fixtureId) === String(id));
  if (!f) return;
  state.analysing = true;
  setView("office");
  const title = `${short(f.homeTeam)} v ${short(f.awayTeam)}`;
  const staff = state.agency.staff.map((a) => office.person(a.id)).filter(Boolean);
  office.clearNotes();
  office.screen = { mode: "work", title, lines: ["BRIEFING THE DESK"] };
  say("ceo", staff.length ? `Team, ${f.homeTeam} v ${f.awayTeam}. Give me your reads!` : `No analysts yet. I'll read ${f.homeTeam} v ${f.awayTeam} myself.`, 3500);
  log(`${state.agency.ceo.name} · CEO`, `Desk analysis: ${f.homeTeam} v ${f.awayTeam} (${f.leagueName}).`, "var(--gold)");
  office.setAll("working");
  if (!staff.length) office.setState("ceo", "working");
  const chatter = setInterval(() => {
    const p = staff[Math.floor(Math.random() * staff.length)];
    if (p) office.packet(p.id, SPECIALTY_COLORS[p.specialty] || "#3b8bff");
  }, 600);
  let i = 0;
  const lineTimer = setInterval(() => {
    const p = staff[i++ % Math.max(1, staff.length)];
    office.screen.lines = [...office.screen.lines, p ? `${p.name.split(" ")[0]}: ${({ form: "FORM", lineups: "TEAM NEWS", weather: "WEATHER", odds: "MARKETS", set_pieces: "SET PIECES", discipline: "CARDS", scorers: "SCORERS" })[p.specialty] || "READING"}` : "CEO: GUT FEEL"].slice(-3);
  }, 900);
  let out;
  try {
    out = await api.analyze(id);
  } catch (e) {
    clearInterval(chatter); clearInterval(lineTimer);
    office.setAll("idle"); office.setState("ceo", "idle");
    for (const p of staff) office.setState(p.id, "error");
    setTimeout(() => office.setAll("idle"), 3000);
    idleScreen();
    state.analysing = false;
    toastError(e);
    log("Agency", e.message, "var(--red)", "error");
    return;
  }
  clearInterval(chatter); clearInterval(lineTimer);
  office.setState("ceo", "idle");

  // Each analyst presents, the CEO checks in at their desk.
  const { analysis } = out;
  const skip = { on: false };
  const skipBtn = el("button", { type: "button", class: "btn small", onclick: () => { skip.on = true; } }, "Skip to picks");
  $("console").replaceChildren(el("div", { class: "next-match" }, el("div", { class: "teams" }, `${f.homeTeam} v ${f.awayTeam}`), el("div", { class: "meta" }, analysis.reports.length ? "Your analysts are presenting…" : "Your CEO is making the calls…")), el("div", { class: "console-actions" }, skipBtn));
  for (const r of analysis.reports) {
    const p = office.person(r.analystId);
    if (!skip.on && p) {
      office.visit(r.analystId, false);
      await wait(900);
    }
    office.setState(r.analystId, "done");
    office.addNote(SPECIALTY_COLORS[r.specialty] || "#3b8bff");
    office.packet(r.analystId, SPECIALTY_COLORS[r.specialty] || "#3b8bff");
    if (!skip.on) say(r.analystId, r.note, 3200);
    log(`${r.name} · ${r.title}`, `${r.brief?.available ? `${r.brief.narrative} ` : ""}${r.note}`, SPECIALTY_COLORS[r.specialty]);
    if (!skip.on) await wait(1700);
  }
  office.home();
  const gut = Object.entries(analysis.combined.markets || {}).filter(([, m]) => m.source === "ceo").map(([k]) => MARKET_LABEL[k].toLowerCase());
  if (gut.length) {
    office.setState("ceo", "gut");
    const list = gut.length > 1 ? `${gut.slice(0, -1).join(", ")} and ${gut.at(-1)}` : gut[0];
    if (!skip.on) { say("ceo", analysis.reports.length ? `Nobody covers ${list}. Gut call…` : "No analysts yet, so it's all gut calls. Rolling the dice…", 2400); await wait(2400); }
    office.setState("ceo", "idle");
  }
  const picks = analysis.combined.picks;
  office.screen = { mode: "picks", title, lines: picksLines(picks, f) };
  say("ceo", analysis.combined.summary.replace(/^[^:]+:\s*/, "Here's our call: "), 6000);
  log(`${state.agency.ceo.name} · CEO`, analysis.combined.summary, "var(--gold)");
  office.celebrate(2.5);

  state.room = { fixtureId: id, data: state.room?.fixtureId === id ? state.room.data : null, draft: null };
  syncFixture(id, out.prediction);
  if (!skip.on) await wait(2600);
  state.analysing = false;
  V.renderConsole($("console"), ctx);
  await reloadRoom();
  setView("match");
  toast("Draft ready: edit it or lock it in.");
}

// ------------------------------------------------------------------ staff
async function hire(c, btn) {
  const a = state.agency;
  if (!(await confirmBox(`Hire ${c.name}?`, `${c.title}, ${c.skill}★. Costs ${fmtCredits(c.hireCost)} credits now and ${fmtCredits(c.weeklySalary)} every Monday.${a.credits - c.hireCost < a.payroll.weeklyTotal + c.weeklySalary ? " Careful: you'd be short for payday." : ""}`, "Hire"))) return;
  busy(btn, true, "Hiring…");
  try {
    const out = await api.hire(c.candidateKey);
    if (state.talent) state.talent.candidates = state.talent.candidates.filter((x) => x.candidateKey !== c.candidateKey);
    applyAgency(out.agency);
    office.setState(out.analyst.id, "done");
    log(`${out.analyst.name} · ${out.analyst.title}`, `Joined the agency. ${out.analyst.markets.map((m) => MARKET_LABEL[m]).join(" and ")} covered.`, SPECIALTY_COLORS[out.analyst.specialty]);
    toast(`${out.analyst.name} joined your desk.`);
    renderView("talent");
    setTimeout(() => say(out.analyst.id, `Hi boss! ${out.analyst.style.charAt(0).toUpperCase()}${out.analyst.style.slice(1)}, reporting in.`, 3500), 400);
  } catch (e) { toastError(e); busy(btn, false); }
}

function openAnalyst(id) {
  const a = state.agency.staff.find((s) => s.id === id);
  if (!a) return;
  V.renderAnalyst($("analyst-body"), a, ctx);
  show("analyst-sheet");
}

async function fire(a, btn) {
  if (!(await confirmBox(`Fire ${a.name}?`, "Their desk is freed for someone new. There's no refund of the hiring cost.", "Fire"))) return;
  busy(btn, true, "…");
  state.firing ??= new Set();
  state.firing.add(a.id);
  try {
    const out = await api.fire(a.id);
    show("analyst-sheet", false);
    applyAgency(out.agency);
    logSystem(`${a.name} has left the agency.`);
    toast(`${a.name} was let go.`);
  } catch (e) { toastError(e); busy(btn, false); }
}

async function changeCeo(agentId, btn) {
  if (agentId === state.agency.ceo.agentId) return;
  busy(btn, true, "…");
  try { applyAgency(await api.setCeo(agentId)); toast(`${state.agency.ceo.name} is your new CEO.`); say("ceo", "New boss in the building!"); }
  catch (e) { toastError(e); }
  finally { busy(btn, false); }
}

// ------------------------------------------------------------------ your Mind directs
// A player's Hello Minds agent can make the agency's final calls through its
// own API (Pixel Agency: /v1/director). Linking proves the player's Minds
// sign-in; the API then issues a director key, shown here once, which the
// player gives their Mind together with the director spec.
let mindsApi = null;
async function loadMinds() {
  if (mindsApi) return mindsApi;
  if (!state.cfg.mindsClientId) throw new Error("Linking a Mind isn't available here.");
  const mod = await import("../minds/kult-minds.js");
  mindsApi = mod.init({ clientId: state.cfg.mindsClientId, redirectUri: `${location.origin}/minds/callback` });
  return mindsApi;
}

async function loadMindStatus() {
  try { state.mind = await api.mindStatus(); if (state.view === "agency") renderView("agency"); }
  catch (e) { if (e.status !== 404) toastError(e); }
}

function applyMindLink(out) {
  state.mind = { ...(state.mind || {}), mind: out.mind };
  state.mindsList = out.mind?.mindId ? null : out.minds;
  if (out.key) { state.mindKey = out.key.key; state.mindKeyKind = "director"; }
}

// A fresh AI Arena token: renewed through Privy when possible, else the one
// the game was entered with while it is still valid.
async function freshArenaToken() {
  try {
    if (privyApi?.authenticated) return await api.arenaTokenFromPrivy((await privyApi.tokens()).accessToken);
  } catch { /* fall back to the stored one */ }
  return api.storedArenaToken();
}

// Link the directing Mind to the agency's CEO agent in AI Arena too, so one
// KULT key lets it direct here and talk, negotiate and build relationships as
// that agent. Best effort: without a fresh AI Arena token the game-only key stands.
async function linkMindToAgent(accessToken) {
  const mindId = state.mind?.mind?.mindId;
  const arenaToken = mindId ? await freshArenaToken() : null;
  if (!mindId || !arenaToken) return;
  try {
    const out = await api.arenaLinkMind(arenaToken, state.agency.ceo.agentId, accessToken, mindId);
    state.mindAgent = out.linked;
    if (out.key) { state.mindKey = out.key.key; state.mindKeyKind = "kult"; }
  } catch (e) {
    toast(`Your Mind directs the agency. It couldn't be linked to ${state.agency.ceo.name} in AI Arena: ${e.message}`, true);
  }
}

async function connectMind(btn) {
  busy(btn, true, "Opening Hello Minds…");
  try { await (await loadMinds()).signIn(); } // leaves the page
  catch (e) { toastError(e); busy(btn, false); }
}

async function finishMindsLink() {
  try {
    const minds = await loadMinds();
    await minds.handleRedirect(mindsCallback);
    const token = await minds.accessToken();
    if (!token) throw new Error("Hello Minds sign-in didn't finish. Try again.");
    applyMindLink(await api.linkMind(token));
    await linkMindToAgent(token);
    setView("agency");
    loadMindStatus();
    toast(state.mind?.mind?.mindId ? `${state.mind.mind.name || "Your Mind"} now directs ${state.agency.name}.` : "Minds account linked. Choose which Mind directs.");
  } catch (e) { toastError(e); }
}

async function chooseMind(mindId, btn) {
  busy(btn, true, "…");
  try {
    const token = await (await loadMinds()).accessToken();
    if (!token) throw new Error("Your Hello Minds sign-in expired. Link your Mind again.");
    applyMindLink(await api.linkMind(token, mindId));
    await linkMindToAgent(token);
    await loadMindStatus();
    toast(`${state.mind?.mind?.name || "Your Mind"} now directs ${state.agency.name}.`);
  } catch (e) { toastError(e); busy(btn, false); }
}

async function newMindKey(btn) {
  busy(btn, true, "…");
  try { state.mindKey = (await api.newMindKey()).key.key; state.mindKeyKind = "director"; await loadMindStatus(); toast("New director key ready. Give it to your Mind."); }
  catch (e) { toastError(e); busy(btn, false); }
}

async function unlinkMind(btn) {
  if (!confirm("Unlink your Mind? Its director keys stop working at once. Its career record stays.")) return;
  busy(btn, true, "…");
  try {
    await api.unlinkMind();
    try { await mindsApi?.signOut(); } catch { /* already out */ }
    Object.assign(state, { mind: { mind: null, keys: [] }, mindsList: null, mindKey: null });
    renderView("agency");
    toast("Your Mind no longer directs the agency.");
  } catch (e) { toastError(e); busy(btn, false); }
}

// ------------------------------------------------------------------ tutorial
// Nova, the KULT guide (the same tutorial as Kult World's, js/tour.js), walks a
// new player through founding the agency and around the office. Once per
// player; the top bar's Tutorial button or ?tour shows it again.
const forceTour = params.has("tour");
const viewIs = (v) => state.view === v && state.inOffice;
const navSel = (v) => `#sidebar [data-view="${v}"]`;
const TOUR_LINES = {
  "f-hello": "Hi, I'm Nova, your KULT guide! Kult Sports is a football analysis agency: your AI Arena agent runs it, your analysts read every match, and real results win points. Let's open yours.",
  "f-name": "Name your agency. Pick something the leaderboard will remember: 3 to 32 letters.",
  "f-ceo": "Now pick your CEO. It's one of your own AI Arena agents, and it makes the final call on every pick.",
  "f-go": "That's all it takes. Open the agency!",
  "o-hello": "Welcome to your office! Your analysts work at these desks and your CEO walks the pitch rug. Let me show you around.",
  "o-hud": "Up top: your agency, its level and points, and your credits. Points come from real match results, and every level adds a desk.",
  "o-console": "This is the next open match. Analyse it and your analysts read it their own way, then your CEO locks the picks before kickoff.",
  "o-feed": "The office feed. Your analysts talk here: their reads, the results and payday.",
  "o-talent-go": "First, staff up. Open Talent.",
  "o-talent": "Every analyst has a specialty, from form to tactics to set pieces, and a weekly salary. Hire the ones whose read you trust. You can let them go later.",
  "o-matches-go": "Now open Matches.",
  "o-matches": "Every fixture from the top five European leagues. Open one for its match room: run an analysis and edit your picks until they lock.",
  "o-poly-go": "Open Polymarket.",
  "o-poly": "Live football and Formula 1 prediction markets from Polymarket. Ask your CEO for a read on any question, and trade from your own wallet if you like. KULT never holds your funds.",
  "o-history": "History keeps every pick you locked and the points it scored.",
  "o-leaders": "Leaders: the weekly and all-time leaderboards. Exact hits break ties.",
  "o-agency": "Agency: your level, payroll, credits and CEO. You can also let your Hello Mind direct the agency from here.",
  "o-office-go": "Back to the office.",
  "o-done": "You're all set. Hire a desk, analyse the next match and lock your picks before kickoff. Good luck, boss!"
};
const tour = createTour({
  guide: { img: "art/nova.png", name: "NOVA" },
  lines: TOUR_LINES,
  doneKeys: () => [`ks.tour.v1.${String(state.me?.player?.id || "anon")}`],
  onFinish: () => { office.celebrate?.(4); toast("Tutorial complete. Welcome to Kult Sports!"); },
  steps: [
    // Founding the agency.
    { id: "f-hello", phase: "found", next: true, nextLabel: "Let's go", title: "Welcome to Kult Sports" },
    { id: "f-name", phase: "found", target: "#found-name", next: true, interactive: true },
    { id: "f-ceo", phase: "found", target: "#found-agents", next: true, interactive: true },
    { id: "f-go", phase: "found", target: "#found-btn", done: () => state.inOffice, doneDelay: 1200 },
    // The office.
    { id: "o-hello", phase: "office", next: true, quiet: () => !state.inOffice },
    { id: "o-hud", phase: "office", target: "#hud", next: true },
    { id: "o-console", phase: "office", target: "#console", next: true, skip: () => $("console").hidden },
    { id: "o-feed", phase: "office", target: "#feed", next: true, skip: () => !$("feed").getClientRects().length },
    { id: "o-talent-go", phase: "office", target: navSel("talent"), done: () => viewIs("talent") },
    { id: "o-talent", phase: "office", target: "#talent-view", next: true, lost: () => !viewIs("talent"), fallback: "o-talent-go" },
    { id: "o-matches-go", phase: "office", target: navSel("matches"), done: () => viewIs("matches") },
    { id: "o-matches", phase: "office", target: "#matches-view", next: true, lost: () => !viewIs("matches"), fallback: "o-matches-go" },
    { id: "o-poly-go", phase: "office", target: navSel("polymarket"), done: () => viewIs("polymarket") },
    { id: "o-poly", phase: "office", target: "#polymarket-view", next: true, lost: () => !viewIs("polymarket"), fallback: "o-poly-go" },
    { id: "o-history", phase: "office", target: navSel("history"), next: true },
    { id: "o-leaders", phase: "office", target: navSel("leaders"), next: true },
    { id: "o-agency", phase: "office", target: navSel("agency"), next: true },
    { id: "o-office-go", phase: "office", target: navSel("office"), done: () => viewIs("office") },
    { id: "o-done", phase: "office", next: true, nextLabel: "Let's play", last: true, title: "You're the boss now" }
  ]
});
$("tour-btn").addEventListener("click", () => { if (!state.analysing) { setView("office"); tour.start("o-hello"); } });

// ------------------------------------------------------------------ boot
async function boot() {
  try { state.cfg = await fetch("/config.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})); } catch { state.cfg = {}; }
  api ??= createApi({ apiUrl: state.cfg.apiUrl, onUnauthorized: () => sessionExpired() });
  ctx.api = api;
  setupIcons();
  try {
    if (api.demo) return enter(await api.startSession("demo"));
    if (handoff) return enter(await api.startSession(handoff));
    if (api.hasSession()) return enter(await api.me());
    const privy = await loadPrivy();
    if (privy?.authenticated) return enter(await sessionFromPrivy(privy));
  } catch (e) {
    return showEntrance(e.status === 401 ? "Your Kult session has expired. Sign in again, or reopen Kult Sports from the Kult browser." : e.message);
  }
  showEntrance();
}
boot();
