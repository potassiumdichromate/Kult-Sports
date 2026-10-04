// Kult Sports screens (everything outside the office canvas). Each renderer
// gets the shared context from app.js: state, actions and helpers.

import {
  el, stars, fmtPts, fmtCredits, fmtCountdown, fmtTime, fmtDay, fmtAgo,
  MARKETS, MARKET_LABEL, MARKET_POINTS, outcomeOf, outcomeText, pickText, isLive, isFinished
} from "./ui.js";
import { SPECIALTY_COLORS } from "./world.js";

// replaceChildren() would print "null" for skipped (conditional) parts.
const fill = (root, ...kids) => root.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const head = (eyebrow, title, ...right) => el("div", { class: "dash-head" },
  el("div", {}, el("p", { class: "eyebrow" }, eyebrow), el("h2", { class: "display" }, title)),
  right.length ? el("div", { class: "dash-controls" }, ...right) : null);
const section = (title, small, ...kids) => el("section", { class: "dash-section" }, el("h3", {}, title, small ? el("small", {}, small) : null), ...kids);
const stat = (k, v, c) => el("div", { class: "stat", style: `--c:${c}` }, el("span", { class: "k" }, k), el("span", { class: "v" }, v));
const specChip = (a) => el("span", { class: "chip", style: `--c:${SPECIALTY_COLORS[a.specialty] || "var(--accent)"}` }, el("i"), a.title);
const marketsOf = (list) => el("div", { class: "markets" }, (list || []).map((m) => el("span", {}, MARKET_LABEL[m] || m)));
const clan = (c) => (c ? el("span", { class: `clan ${c}` }, c) : null);

// Fixture status for lists: what the player can still do, or what happened.
export function fixtureStatus(f) {
  const p = f.prediction;
  if (p?.status === "SETTLED") return { cls: "settled", text: `+${fmtPts(p.points)} pts` };
  if (p?.status === "VOID") return { cls: "void", text: "Void" };
  if (p?.status === "LOCKED") return { cls: "locked", text: "Locked" };
  if (p?.status === "DRAFT") return f.open ? { cls: "draft", text: "Draft" } : { cls: "closed", text: "Closed" };
  if (f.open) return { cls: "open", text: `Locks in ${fmtCountdown(Date.parse(f.lockAt) - Date.now())}`, lock: f.lockAt };
  if (isLive(f.status)) return { cls: "closed", text: "Live" };
  if (["PST", "CANC", "ABD"].includes(f.status)) return { cls: "void", text: f.status === "PST" ? "Postponed" : "Cancelled" };
  return { cls: "closed", text: isFinished(f.status) ? "Full time" : "Closed" };
}

// ---------------------------------------------------------------- console (under the office)
export function renderConsole(root, ctx) {
  const { state } = ctx;
  const next = (state.fixtures || []).filter((f) => f.open).sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt))[0];
  if (!next) {
    fill(root, 
      el("div", { class: "next-match" }, el("div", { class: "teams" }, "No open matches right now"), el("div", { class: "meta" }, "Fixtures come from the top five European leagues. Check back soon.")),
      el("div", { class: "console-actions" }, el("button", { type: "button", class: "btn", onclick: () => ctx.go("matches") }, "All matches")));
    return;
  }
  const st = fixtureStatus(next);
  fill(root, 
    el("div", { class: "next-match" },
      el("p", { class: "eyebrow", style: "margin:0 0 4px" }, `Next match · ${next.leagueName}`),
      el("div", { class: "teams" }, `${next.homeTeam} v ${next.awayTeam}`),
      el("div", { class: "meta" }, ctx.state.sportsIcon?.("stopwatch") ? el("img", { class: "inline-ico", src: ctx.state.sportsIcon("stopwatch"), alt: "" }) : null, `${fmtDay(next.kickoffAt)} ${fmtTime(next.kickoffAt)} · picks lock in `, el("span", { class: "countdown", "data-until": next.lockAt }, fmtCountdown(Date.parse(next.lockAt) - Date.now())), next.prediction ? el("span", { class: `status ${st.cls}`, style: "margin-left:8px" }, st.text) : null)),
    el("div", { class: "console-actions" },
      el("button", { type: "button", class: "btn", onclick: () => ctx.go("matches") }, "All matches"),
      el("button", { type: "button", class: "btn primary", onclick: () => ctx.openMatch(next.fixtureId) }, next.prediction ? "Open match room" : "Analyse this match")));
}

// ---------------------------------------------------------------- matches
export function renderMatches(root, ctx) {
  const { state } = ctx, filter = state.matchFilter || "upcoming";
  const all = [...(state.fixtures || [])].sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt));
  const list = filter === "upcoming" ? all.filter((f) => !isFinished(f.status) && f.prediction?.status !== "SETTLED" && Date.parse(f.kickoffAt) > Date.now() - 3 * 3600e3)
    : filter === "mine" ? all.filter((f) => f.prediction) : all.filter((f) => isFinished(f.status) || f.prediction?.status === "SETTLED").reverse();
  const tabs = el("div", { class: "filters", role: "group", "aria-label": "Show" }, [["upcoming", "Upcoming"], ["mine", "My picks"], ["results", "Results"]].map(([k, label]) =>
    el("button", { type: "button", "aria-pressed": k === filter ? "true" : "false", onclick: () => { state.matchFilter = k; renderMatches(root, ctx); } }, label)));
  const body = [];
  let day = null;
  for (const f of list) {
    const d = fmtDay(f.kickoffAt);
    if (d !== day) { body.push(el("div", { class: "day-head" }, d)); day = d; }
    const st = fixtureStatus(f);
    body.push(el("button", { type: "button", class: "fx-row", onclick: () => ctx.openMatch(f.fixtureId) },
      el("div", { class: "when" }, el("b", {}, fmtTime(f.kickoffAt)), f.leagueName),
      el("div", { style: "min-width:0" }, el("div", { class: "teams" }, `${f.homeTeam} v ${f.awayTeam}`), el("div", { class: "league" }, f.venue || "")),
      el("span", { class: `status ${st.cls}`, ...(st.lock ? { "data-until": f.lockAt, "data-prefix": "Locks in " } : {}) }, st.text),
      el("span", { class: "btn small go" }, f.prediction ? "Open" : f.open ? "Analyse" : "View")));
  }
  fill(root, 
    head("Matchday", "Matches", tabs),
    el("p", { class: "muted small", style: "margin:0 0 6px" }, "Top five European leagues. Picks lock 5 minutes before kickoff; results arrive about 2 hours after."),
    body.length ? el("div", { class: "list" }, body)
      : el("p", { class: "empty-dash" }, state.fixtures ? (filter === "mine" ? "You haven't analysed a match yet." : filter === "results" ? "No finished matches in this range yet." : "No matches scheduled right now.") : "Loading fixtures…"));
}

// ---------------------------------------------------------------- match room
export function renderMatchRoom(root, ctx) {
  const { state } = ctx, room = state.room;
  if (!room?.data) { fill(root, el("p", { class: "muted" }, "Loading the match room…")); return; }
  const { fixture: f, squad, absences, outcome, analysesUsed, analysesAllowed, prediction: p, analysis } = room.data;
  const open = f.open && Date.now() < Date.parse(f.lockAt);
  const result = outcome?.regulation;

  const header = el("div", { class: "match-head" },
    el("div", { class: "side" }, f.homeTeam),
    el("div", { class: "mid" }, result ? el("div", { class: "score-big" }, `${result.home}–${result.away}`) : el("div", { class: "vs" }, "VS"),
      el("div", { class: "muted small" }, result ? "Full time" : `${fmtDay(f.kickoffAt)} ${fmtTime(f.kickoffAt)}`)),
    el("div", { class: "side away" }, f.awayTeam));
  const meta = el("div", { class: "match-meta" },
    el("span", { class: "chip" }, f.leagueName), f.venue ? el("span", {}, `${f.venue}${f.venueCity ? `, ${f.venueCity}` : ""}`) : null,
    open ? el("span", {}, "Picks lock in ", el("span", { class: "countdown", "data-until": f.lockAt, "data-on-zero": "room" }, fmtCountdown(Date.parse(f.lockAt) - Date.now()))) : el("span", { class: "status closed" }, isLive(f.status) ? "Live" : "Picks closed"));

  // Left: the desk's analysis.
  const left = [];
  if (analysis) {
    const support = (id) => MARKETS.filter((m) => analysis.combined.markets?.[m]?.support?.includes(id));
    left.push(el("div", { class: "card" },
      el("h3", {}, "Desk analysis", el("small", {}, `${analysis.reports.length} report${analysis.reports.length === 1 ? "" : "s"} · ${fmtAgo(analysis.createdAt)}`)),
      analysis.reports.length ? analysis.reports.map((r) => el("div", { class: "report" },
        ctx.portrait(r.analystId) || el("span", { class: "ph" }),
        el("div", { style: "min-width:0" },
          el("div", {}, el("span", { class: "who" }, r.name), " ", stars(r.skill)),
          el("div", { class: "title" }, r.title, support(r.analystId).length ? ` · backs the final ${support(r.analystId).map((m) => MARKET_LABEL[m].toLowerCase()).join(", ")}` : ""),
          r.brief?.available ? el("p", { class: "narr" }, r.brief.narrative) : el("p", { class: "narr muted" }, "No research brief was available for this match."),
          r.signals?.length ? el("ul", {}, r.signals.map((s) => el("li", {}, s))) : null,
          el("div", { class: "note" }, r.note))))
        : el("p", { class: "muted" }, "No analysts at the desk: your CEO made every call alone."),
      el("div", { class: "summary" }, el("b", {}, "CEO's call"), analysis.combined.summary)));
  } else {
    left.push(el("div", { class: "card" }, el("h3", {}, "Desk analysis"),
      el("div", { class: "empty-card" }, open
        ? (state.agency?.staff?.length ? `Your ${state.agency.staff.length} analyst${state.agency.staff.length === 1 ? "" : "s"} will read this match, then your CEO drafts the picks.` : "No analysts yet: your CEO will draft every pick alone (all gut calls). Hire analysts for sharper reads.")
        : "No analysis was run for this match.")));
  }
  left.push(el("div", { class: "card" }, el("h3", {}, "Team news", el("small", {}, `${squad.length} players`)),
    absences.length ? el("ul", { class: "absences" }, absences.map((a) => el("li", {}, `${a.name} (${a.side === "HOME" ? f.homeTeam : f.awayTeam}): ${a.type}${a.reason ? `, ${a.reason}` : ""}`))) : el("p", { class: "muted small" }, "No reported absences.")));

  // Right: picks.
  const right = [];
  const runBtn = (label) => el("button", { type: "button", class: "btn primary", disabled: !open || analysesUsed >= analysesAllowed || (p && p.status !== "DRAFT") || null, onclick: () => ctx.runAnalysis(f.fixtureId) }, label);
  const runsLeft = el("p", { class: "muted small", style: "margin:6px 0 0" }, `Analyses used: ${analysesUsed} of ${analysesAllowed}.`);

  if (!p) {
    right.push(el("div", { class: "card" }, el("h3", {}, "Your picks"),
      open ? [el("p", { class: "muted small" }, "Run the desk analysis to get a draft. You can edit it, then lock it in."), runBtn("Run desk analysis"), runsLeft]
        : el("p", { class: "muted" }, "Picks for this match are closed.")));
  } else if (p.status === "DRAFT" && open) {
    right.push(pickEditor(p, f, squad, analysis, ctx), el("div", { class: "card" },
      el("h3", {}, "Re-run analysis"),
      el("p", { class: "muted small" }, "Worth it after hiring: it replaces the draft and your edits."),
      runBtn(`Run again (${analysesAllowed - analysesUsed} left)`)));
  } else if (p.status === "SETTLED" || p.status === "VOID") {
    right.push(el("div", { class: "card" }, el("h3", {}, el("span", {}, ctx.state.sportsIcon?.("whistle") ? el("img", { class: "inline-ico", src: ctx.state.sportsIcon("whistle"), alt: "" }) : null, p.status === "VOID" ? "Void" : "Full time"), el("small", {}, p.settledAt ? `settled ${fmtAgo(p.settledAt)}` : "")),
      el("div", { class: "breakdown" }, MARKETS.map((m, i) => {
        const b = p.breakdown?.[m] || { result: "VOID", points: 0 };
        return el("div", { class: `bd ${b.result}`, style: `animation-delay:${i * 0.18}s` },
          el("span", { class: "m" }, MARKET_LABEL[m]), el("span", { class: "pick" }, pickText(m, p.picks, f)), el("span", { class: "res" }, b.result), el("span", { class: "pts" }, `+${fmtPts(b.points)}`));
      })),
      el("div", { class: "total-pts" }, el("span", {}, `${p.exactHits} exact`), el("span", { class: "v" }, `+${fmtPts(p.points)} pts`)),
      el("p", { class: "muted small" }, `${Math.round(Number(p.points || 0) * 10).toLocaleString()} credits earned.`)));
  } else {
    right.push(el("div", { class: "card" },
      el("h3", {}, p.status === "LOCKED" ? (p.autoLocked ? "Auto-locked" : "Locked") : "Closed", el("small", {}, p.lockedAt ? fmtAgo(p.lockedAt) : "")),
      readonlyPicks(p, f),
      el("p", { class: "muted small", style: "margin-top:10px" }, isFinished(f.status) ? "Scoring this match… results usually land about 2 hours after kickoff." : "Results arrive about 2 hours after kickoff.")));
  }

  fill(root, 
    el("div", { class: "dash-head" }, el("button", { type: "button", class: "btn small ghost", onclick: () => ctx.go("matches") }, "‹ Matches"), el("span")),
    header, meta,
    el("div", { class: "room-grid" }, el("div", {}, left), el("div", {}, right)));
}

function readonlyPicks(p, f) {
  return el("dl", { class: "readonly-picks" }, MARKETS.flatMap((m) => [el("dt", {}, MARKET_LABEL[m]), el("dd", {}, pickText(m, p.picks, f))]));
}

// The CEO's editor: outcome, exact score (kept in agreement), corners, cards, scorer.
function pickEditor(p, f, squad, analysis, ctx) {
  const draft = ctx.state.room.draft ??= JSON.parse(JSON.stringify(p.picks));
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(p.picks);
  const source = (m) => analysis?.combined?.markets?.[m]?.source === "ceo" ? el("span", { class: "gut", title: "No analyst covers this market: your CEO's gut call" }, "GUT CALL") : el("span", { class: "desk-pick" }, "DESK");
  const card = el("div", { class: "card" });
  const rerender = () => card.replaceWith(pickEditor(p, f, squad, analysis, ctx));

  const setOutcome = (o) => {
    draft.outcome = o;
    const s = draft.score;
    if (o === "HOME" && s.home <= s.away) s.home = s.away + 1;
    if (o === "AWAY" && s.away <= s.home) s.away = s.home + 1;
    if (o === "DRAW" && s.home !== s.away) s.away = s.home = Math.max(s.home, s.away);
    rerender();
  };
  const stepper = (value, min, max, onChange, label) => el("span", { class: "stepper", role: "group", "aria-label": label },
    el("button", { type: "button", "aria-label": `Fewer ${label}`, disabled: value <= min || null, onclick: () => { onChange(value - 1); rerender(); } }, "−"),
    el("output", { "aria-live": "polite" }, value),
    el("button", { type: "button", "aria-label": `More ${label}`, disabled: value >= max || null, onclick: () => { onChange(value + 1); rerender(); } }, "+"));
  const setScore = (side, v) => { draft.score[side] = v; draft.outcome = outcomeOf(draft.score); };
  const scorer = el("select", { "aria-label": "Goal scorer", onchange: (e) => { draft.scorerId = e.target.value || null; draft.scorerName = draft.scorerId ? squad.find((s) => s.id === draft.scorerId)?.name : null; } },
    el("option", { value: "" }, "No scorer"),
    el("optgroup", { label: f.homeTeam }, squad.filter((s) => s.side === "HOME").map((s) => el("option", { value: s.id, selected: s.id === draft.scorerId || null }, s.name))),
    el("optgroup", { label: f.awayTeam }, squad.filter((s) => s.side === "AWAY").map((s) => el("option", { value: s.id, selected: s.id === draft.scorerId || null }, s.name))));

  card.append(
    el("h3", {}, "Your picks", el("small", {}, p.edited || dirty() ? "edited draft" : "desk draft")),
    el("div", { class: "editor" },
      el("div", { class: "ed-row" }, el("div", { class: "lab" }, `Outcome · ${MARKET_POINTS.outcome}`, source("outcome")),
        el("div", { class: "seg", role: "group", "aria-label": "Outcome" }, [["HOME", f.homeTeam], ["DRAW", "Draw"], ["AWAY", f.awayTeam]].map(([o, label]) =>
          el("button", { type: "button", "aria-pressed": draft.outcome === o ? "true" : "false", title: outcomeText(o, f), onclick: () => setOutcome(o) }, label.length > 12 ? `${label.slice(0, 11)}.` : label)))),
      el("div", { class: "ed-row" }, el("div", { class: "lab" }, `Exact score · ${MARKET_POINTS.score}`, source("score")),
        el("div", { class: "score-ed" }, el("span", { class: "team" }, f.homeTeam), stepper(draft.score.home, 0, 15, (v) => setScore("home", v), `${f.homeTeam} goals`),
          stepper(draft.score.away, 0, 15, (v) => setScore("away", v), `${f.awayTeam} goals`), el("span", { class: "team" }, f.awayTeam))),
      el("div", { class: "ed-row" }, el("div", { class: "lab" }, `Total corners · ${MARKET_POINTS.corners}`, source("corners")), stepper(draft.corners, 0, 30, (v) => { draft.corners = v; }, "corners")),
      el("div", { class: "ed-row" }, el("div", { class: "lab" }, `Total cards · ${MARKET_POINTS.cards}`, source("cards")), stepper(draft.cards, 0, 20, (v) => { draft.cards = v; }, "cards")),
      el("div", { class: "ed-row" }, el("div", { class: "lab" }, `Goal scorer · ${MARKET_POINTS.scorer}`, source("scorer")), scorer),
      el("div", { class: "lockbar" },
        el("button", { type: "button", class: "btn", disabled: !dirty() || null, onclick: (e) => ctx.savePicks(f.fixtureId, draft, e.currentTarget) }, dirty() ? "Save changes" : "No changes"),
        el("button", { type: "button", class: "btn primary", onclick: (e) => ctx.lockPicks(f.fixtureId, dirty() ? draft : null, e.currentTarget) }, "Lock picks"),
        el("p", { class: "muted small", style: "margin:0" }, "Not locked by you? It locks automatically 5 minutes before kickoff. Max 52 points."))));
  return card;
}

// ---------------------------------------------------------------- talent
export function renderTalent(root, ctx) {
  const { state } = ctx, a = state.agency, t = state.talent;
  const full = a.staff.length >= a.desks, poor = a.credits < a.payroll.weeklyTotal;
  const notices = [];
  if (full) notices.push(el("p", { class: "notice" }, `All ${a.desks} desks are taken. Fire someone or level up for another desk${a.nextLevelAt ? ` (next level at ${fmtPts(a.nextLevelAt)} points)` : ""}.`));
  if (poor) notices.push(el("p", { class: "notice bad" }, `Payday is ${fmtCredits(a.payroll.weeklyTotal)} credits but you have ${fmtCredits(a.credits)}. Analysts you can't pay will quit.`));

  const staff = el("div", { class: "staff-grid" },
    a.staff.map((s) => el("button", { type: "button", class: "staff-card", onclick: () => ctx.openAnalyst(s.id) },
      ctx.portrait(s.id) || el("span", { class: "ph" }),
      el("div", { style: "min-width:0" }, el("div", { style: "font-weight:600" }, s.name), el("div", { class: "muted small" }, s.title), stars(s.skill)))),
    Array.from({ length: Math.max(0, a.desks - a.staff.length) }, () => el("div", { class: "staff-card empty" }, "Empty desk")));

  const cands = t ? t.candidates.map((c) => {
    const why = full ? "Desks full" : a.credits < c.hireCost ? "Not enough credits" : null;
    return el("article", { class: "cand" },
      el("div", { class: "cand-top" }, ctx.portraitFor(c.candidateKey) || el("span", { class: "ph" }),
        el("div", { style: "min-width:0" }, el("div", { class: "name" }, c.name), el("div", { class: "spec" }, c.title), stars(c.skill))),
      el("div", { class: "style" }, `“${c.style}”`),
      marketsOf(c.markets),
      el("div", { class: "money" }, el("span", {}, "Hire ", el("b", {}, fmtCredits(c.hireCost))), el("span", {}, el("b", {}, fmtCredits(c.weeklySalary)), " / week")),
      el("button", { type: "button", class: "btn primary", disabled: why || null, title: why || `Hire ${c.name}`, onclick: (e) => ctx.hire(c, e.currentTarget) }, why || "Hire"));
  }) : [];

  fill(root, 
    head("Weekly pool", "Talent", el("span", { class: "chip" }, `Desks ${a.staff.length}/${a.desks}`), el("span", { class: "chip", style: "--c:var(--gold)" }, el("i"), `${fmtCredits(a.credits)} credits`)),
    ...notices,
    section("Your desk", `${fmtCredits(a.payroll.weeklyTotal)} credits/week · payday in ${fmtCountdown(Date.parse(a.payroll.nextDueAt) - Date.now())}`, staff),
    section("Candidates", t ? `Week ${t.week.split("-W")[1]} · new pool in ${fmtCountdown(Date.parse(t.refreshesAt) - Date.now())}` : "",
      t ? (cands.length ? el("div", { class: "talent-grid" }, cands) : el("p", { class: "empty-dash" }, "You've hired everyone in this week's pool. A new pool arrives Monday.")) : el("p", { class: "muted" }, "Loading candidates…")));
}

// ---------------------------------------------------------------- history
export function renderHistory(root, ctx) {
  const list = ctx.state.predictions;
  const fake = (p) => ({ homeTeam: p.match.split(" vs ")[0], awayTeam: p.match.split(" vs ")[1] });
  fill(root, 
    head("Track record", "My predictions"),
    !list ? el("p", { class: "muted" }, "Loading…") : !list.length ? el("p", { class: "empty-dash" }, "No predictions yet. Analyse a match to make your first picks.")
      : el("div", { class: "list" }, list.map((p) => {
        const st = p.status === "SETTLED" ? { cls: "settled", text: `+${fmtPts(p.points)} pts` } : { cls: p.status.toLowerCase(), text: p.status === "DRAFT" ? "Draft" : p.status === "LOCKED" ? (p.autoLocked ? "Auto-locked" : "Locked") : "Void" };
        return el("button", { type: "button", class: "fx-row", onclick: () => ctx.openMatch(p.fixtureId) },
          el("div", { class: "when" }, el("b", {}, fmtDay(p.kickoffAt)), p.leagueName),
          el("div", { style: "min-width:0" }, el("div", { class: "teams" }, p.match), el("div", { class: "league" }, `${pickText("score", p.picks, fake(p))} · ${pickText("scorer", p.picks, fake(p))}`)),
          el("span", { class: `status ${st.cls}` }, st.text),
          el("span", { class: "btn small go" }, p.status === "SETTLED" ? `${p.exactHits} exact` : "Open"));
      })));
}

// ---------------------------------------------------------------- leaderboards
export function renderLeaders(root, ctx) {
  const { state } = ctx, kind = state.lbKind || "weekly", data = state.leaderboards?.[kind];
  const tabs = el("div", { class: "filters", role: "group", "aria-label": "Leaderboard" }, [["weekly", "Weekly"], ["all-time", "All time"]].map(([k, label]) =>
    el("button", { type: "button", "aria-pressed": k === kind ? "true" : "false", onclick: () => ctx.loadLeaders(k) }, label)));
  const mine = state.agency?.standings?.[kind === "weekly" ? "weekly" : "allTime"];
  fill(root, 
    head(kind === "weekly" ? `Week ${data?.week?.split("-W")[1] || ""}` : "Since launch", "Leaderboards", tabs),
    el("div", { class: "stats" },
      stat("Your rank", mine ? `#${mine.rank}` : "—", "var(--accent)"),
      stat("Your points", mine ? fmtPts(mine.points) : "0", "var(--gold)"),
      stat("Agencies listed", data ? String(data.entries.length) : "—", "var(--blue)")),
    !mine ? el("p", { class: "muted small" }, kind === "weekly" ? "You'll appear once one of your matches this week is settled." : "You'll appear once a match is settled.") : null,
    section(kind === "weekly" ? "This week" : "All time", "Ranked by points, then exact hits",
      !data ? el("p", { class: "muted" }, "Loading…") : !data.entries.length ? el("p", { class: "empty-dash" }, "No settled matches yet. Be the first on the board.")
        : el("table", { class: "lb" },
          el("thead", {}, el("tr", {}, el("th", {}, "#"), el("th", {}, "Agency"), el("th", { class: "num" }, "Points"), el("th", { class: "num hide-sm" }, "Exact"), el("th", { class: "num hide-sm" }, "Matches"))),
          el("tbody", {}, [...data.entries, ...(data.me && !data.entries.some((e) => e.agencyId === data.me.agencyId) ? [data.me] : [])].map((e) =>
            el("tr", { class: e.agencyId === state.agency?.id ? "me" : null },
              el("td", { class: "rank" }, e.rank),
              el("td", {}, el("div", { class: "ag" }, e.agencyName, e.agencyId === state.agency?.id ? " (you)" : ""), el("div", { class: "ceo" }, `CEO ${e.ceo?.name || "?"}`, clan(e.ceo?.clan))),
              el("td", { class: "num" }, fmtPts(e.points)), el("td", { class: "num hide-sm" }, e.exactHits), el("td", { class: "num hide-sm" }, e.predictions)))))));
}

// ---------------------------------------------------------------- agency
export function renderAgency(root, ctx) {
  const { state } = ctx, a = state.agency, ledger = state.ledger;
  const prevAt = [0, 50, 150, 300, 500][a.level - 1] ?? 0;
  const pct = a.nextLevelAt ? Math.round(((a.points - prevAt) / (a.nextLevelAt - prevAt)) * 100) : 100;
  const ceoAgent = state.me?.agents?.find((x) => x.id === a.ceo.agentId);
  const picker = el("select", { "aria-label": "Change CEO" }, (state.me?.agents || []).filter((x) => !x.isRetired).map((x) => el("option", { value: x.id, selected: x.id === a.ceo.agentId || null }, `${x.name} · ${x.clan || ""} ${x.archetype ? `· ${x.archetype.toLowerCase()}` : ""}`)));
  fill(root, 
    head("Agency", a.name),
    el("div", { class: "stats" },
      stat("Credits", fmtCredits(a.credits), "var(--gold)"),
      stat("Points", fmtPts(a.points), "var(--accent)"),
      stat("Level", `${a.level}${a.nextLevelAt ? "" : " (max)"}`, "var(--blue)"),
      stat("Desks", `${a.staff.length}/${a.desks}`, "#c792ea"),
      stat("Weekly rank", a.standings?.weekly ? `#${a.standings.weekly.rank}` : "—", "#7ee081"),
      stat("All-time rank", a.standings?.allTime ? `#${a.standings.allTime.rank}` : "—", "#ff9f5a")),
    section("Next level", a.nextLevelAt ? `${fmtPts(a.points)} / ${fmtPts(a.nextLevelAt)} points · +1 desk` : "Top level: all 7 desks",
      el("div", { class: "bar", style: "height:12px" }, el("i", { style: `--c:var(--accent);width:${Math.max(0, Math.min(100, pct))}%` }))),
    section("Payroll", `paid every Monday`,
      el("div", { class: "stats" }, stat("Weekly salaries", fmtCredits(a.payroll.weeklyTotal), "var(--red)"), stat("Next payday", fmtCountdown(Date.parse(a.payroll.nextDueAt) - Date.now()), "var(--gold)")),
      a.credits < a.payroll.weeklyTotal ? el("p", { class: "notice bad", style: "margin-top:8px" }, "You can't cover this week's salaries yet. Win points (1 credit per 0.1 point) or an analyst will quit.") : null),
    section("CEO", "your AI Arena agent",
      el("div", { class: "ceo-card" }, el("span", { class: "crown", "aria-hidden": "true" }, "♛"),
        el("div", { style: "min-width:0;flex:1" }, el("b", {}, a.ceo.name), clan(a.ceo.clan), el("div", { class: "muted small" }, ceoAgent?.archetype ? `${ceoAgent.archetype.toLowerCase()} · ELO ${ceoAgent.eloRating ?? "?"}` : "")),
        state.me?.agents?.length > 1 ? el("div", { class: "row" }, picker, el("button", { type: "button", class: "btn small", onclick: (e) => ctx.changeCeo(picker.value, e.currentTarget) }, "Make CEO")) : null)),
    section("Ledger", "last 100 entries",
      !ledger ? el("p", { class: "muted" }, "Loading…") : !ledger.entries.length ? el("p", { class: "empty-dash" }, "No credit activity yet.")
        : el("table", { class: "ledger" },
          el("thead", {}, el("tr", {}, el("th", {}, "When"), el("th", {}, "What"), el("th", { class: "amt" }, "Credits"), el("th", { class: "amt" }, "Balance"))),
          el("tbody", {}, ledger.entries.map((e) => el("tr", {},
            el("td", { class: "muted" }, fmtAgo(e.createdAt)),
            el("td", {}, { grant: e.ref === "founding" ? "Founding grant" : "Grant", hire: "Hired an analyst", salary: "Weekly salaries", winnings: "Match winnings" }[e.kind] || e.kind),
            el("td", { class: `amt ${e.delta < 0 ? "neg" : "pos"}` }, `${e.delta > 0 ? "+" : ""}${fmtCredits(e.delta)}`),
            el("td", { class: "amt" }, fmtCredits(e.balanceAfter))))))),
    el("div", { class: "actions" }, el("button", { type: "button", class: "btn ghost sign-out" }, "Sign out")));
  root.querySelector(".sign-out").addEventListener("click", ctx.signOut);
}

// ---------------------------------------------------------------- analyst card
export function renderAnalyst(root, a, ctx) {
  const pct = a.xpToNext ? Math.round((a.xp / a.xpToNext) * 100) : 100;
  fill(root, 
    el("div", { class: "analyst-head" }, ctx.portrait(a.id) || el("span", { class: "ph" }),
      el("div", {}, el("h2", { class: "display", style: "margin:0 0 6px" }, a.name), specChip(a), el("div", { style: "margin-top:6px" }, stars(a.skill)))),
    el("p", { class: "muted", style: "font-style:italic" }, `“${a.style}”`),
    el("dl", { class: "facts" },
      el("dt", {}, "Advises on"), el("dd", {}, marketsOf(a.markets)),
      el("dt", {}, "Salary"), el("dd", {}, `${fmtCredits(a.weeklySalary)} credits / week`),
      el("dt", {}, "Hired"), el("dd", {}, fmtAgo(a.hiredAt))),
    el("div", { class: "xp" }, el("div", { class: "muted small" }, a.xpToNext ? `XP ${a.xp} / ${a.xpToNext} to ${a.skill + 1} stars` : "Top skill: 5 stars"),
      el("div", { class: "bar" }, el("i", { style: `--c:var(--accent);width:${pct}%` }))),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "btn danger", onclick: (e) => ctx.fire(a, e.currentTarget) }, "Fire"),
      el("button", { type: "button", class: "btn primary", "data-close": "analyst-sheet", onclick: () => ctx.closeSheet("analyst-sheet") }, "Back to work")));
}
