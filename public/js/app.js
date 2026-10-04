// Kult Sports: sign-in, the office, and the flows that tie the screens to the
// API (see docs/KULT_SPORTS_FRONTEND_BRIEF.md).

import { createApi } from "./api.js";
import { createDemoApi } from "./demo.js";
import { Office, SPECIALTY_COLORS } from "./world.js";
import { $, el, show, toast, toastError, busy, fmtPts, fmtCredits, fmtCountdown, MARKET_LABEL, outcomeText, ICONS, pixelIcon } from "./ui.js";
import * as V from "./views.js";

const params = new URLSearchParams(location.search);
const demoMode = params.get("demo");
// The Kult browser opens the game with the player's AI Arena token in the
// URL. Take it, then remove it from the address bar and history at once.
const handoff = params.get("jwt");
if (handoff) {
  params.delete("jwt"); params.delete("source");
  history.replaceState(null, "", `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`);
}

// The API client needs config.json (its address), so it's created in boot().
let api = demoMode ? createDemoApi({ fresh: demoMode === "fresh" }) : null;
const state = {
  cfg: {}, me: null, agency: null, fixtures: null, talent: null, predictions: null, ledger: null,
  leaderboards: {}, lbKind: "weekly", matchFilter: "upcoming", room: null, view: "office", inOffice: false, analysing: false
};
const canvas = $("office"), office = new Office(canvas);
let scale = 1, artUrl = (f) => `art/${f}`;

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
  loadLeaders: (k) => loadLeaders(k),
  closeSheet: (id) => show(id, false),
  signOut: () => signOutEverywhere(),
  portrait: (analystId) => { const p = office.person(analystId); return p ? office.portraitOf(p.look) : office.portraitOf(office.lookFor(analystId)); },
  portraitFor: (key) => office.portraitOf(office.lookFor(key))
};

// ------------------------------------------------------------------ office loop
function fit() {
  const box = $("stage").getBoundingClientRect();
  if (!box.width || !box.height) return;
  scale = Math.max(0.4, Math.min(box.width / office.W, box.height / office.H));
  office.setPixelScale(scale * (window.devicePixelRatio || 1));
  canvas.style.width = `${Math.round(office.W * scale)}px`;
  canvas.style.height = `${Math.round(office.H * scale)}px`;
}
new ResizeObserver(fit).observe($("stage"));

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
  if (state.inOffice && $("stage").offsetParent) { office.update(dt); office.draw(); placeBubbles(now); }
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
  if (state.analysing) return;
  const [x, y] = toOffice(e), p = office.hit(x, y);
  if (p?.isCeo) return setView("agency");
  if (p) return openAnalyst(p.id);
  if (office.hitDesk(x, y) >= 0) setView("talent");
});

// ------------------------------------------------------------------ feed
function log(who, text, color = "var(--accent)", cls = "") {
  const list = $("log");
  list.querySelector(".empty")?.remove();
  list.append(el("li", { class: cls, style: `--c:${color}` }, el("span", { class: "dot" }), el("div", {}, el("span", { class: "who" }, who), text)));
  while (list.children.length > 80) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}
const logSystem = (text) => log("Agency", text, "var(--gold)", "system");

// ------------------------------------------------------------------ art
async function loadArt() {
  try {
    const manifest = await fetch(`art/manifest.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json());
    artUrl = (f) => `art/${f}${manifest.rev ? `?v=${manifest.rev}` : ""}`;
    const files = [...new Set([manifest.background, ...Object.values(manifest.sprites || {}), ...Object.values(manifest.characters || {}), ...Object.values(manifest.icons || {})].map((x) => x?.file).filter(Boolean))];
    const images = {};
    await Promise.all(files.map((f) => new Promise((resolve) => { const img = new Image(); img.onload = () => { images[f] = img; resolve(); }; img.onerror = resolve; img.src = artUrl(f); })));
    office.useArt(manifest, images, artUrl);
    state.manifest = manifest;
    const icon = (name) => (manifest.icons?.[name] && images[manifest.icons[name].file] ? artUrl(manifest.icons[name].file) : null);
    for (const slot of document.querySelectorAll(".ico-slot")) {
      const name = slot.dataset.icon, src = icon(name);
      slot.replaceWith(src ? el("img", { class: "ico", src, alt: "" }) : pixelIcon(ICONS[name] || ICONS.ball));
    }
    const coin = icon("coin");
    if (coin) for (const c of document.querySelectorAll(".coin")) c.replaceWith(el("img", { class: "coin-img", src: coin, alt: "" }));
  } catch (e) {
    console.warn("[kult-sports] art not loaded", e);
  }
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
  $("found-player").textContent = state.me.player?.username || state.me.player?.walletAddress || "your KULT account";
  const list = $("found-agents");
  state.ceoPick = agents[0];
  const portrait = (a) => {
    const m = state.manifest?.ceo?.[String(a.archetype || "hybrid").toLowerCase()] || state.manifest?.ceo?.hybrid;
    return m?.portrait ? el("img", { src: artUrl(m.portrait), alt: "" }) : el("span", { class: "ph" });
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
      log("Full time", `${f.homeTeam} v ${f.awayTeam}: +${fmtPts(f.prediction.points)} points, ${fmtCredits(Math.round(f.prediction.points * 10))} credits.`, "var(--accent)");
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
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === "visible" && state.inOffice && !state.analysing) refreshAll(); }, 90_000);
}

// ------------------------------------------------------------------ views
const PANELS = { matches: "matches-view", match: "match-view", talent: "talent-view", history: "history-view", leaders: "leaders-view", agency: "agency-view" };
function setView(view) {
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
  if (view === "leaders") loadLeaders(state.lbKind);
  if (view === "matches" && !state.fixtures) api.fixtures().then((fx) => applyFixtures(fx.fixtures)).catch(toastError);
}
function renderView(view) {
  const root = $(PANELS[view]);
  if (!root || !state.agency) return;
  ({ matches: V.renderMatches, match: V.renderMatchRoom, talent: V.renderTalent, history: V.renderHistory, leaders: V.renderLeaders, agency: V.renderAgency })[view](root, ctx);
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
    if (p) office.packet(p.id, SPECIALTY_COLORS[p.specialty] || "#3ddc84");
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
    office.addNote(SPECIALTY_COLORS[r.specialty] || "#3ddc84");
    office.packet(r.analystId, SPECIALTY_COLORS[r.specialty] || "#3ddc84");
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

// ------------------------------------------------------------------ boot
async function boot() {
  try { state.cfg = await fetch("/config.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})); } catch { state.cfg = {}; }
  api ??= createApi({ apiUrl: state.cfg.apiUrl, onUnauthorized: () => sessionExpired() });
  ctx.api = api;
  await loadArt();
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
