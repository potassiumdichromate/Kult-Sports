// Offline demo (?demo=1): an in-memory stand-in for the Kult Sports API that
// follows the brief's rules, so the whole game can be tried and designed
// without an AI Arena account. ?demo=fresh starts before founding an agency.

import { ApiError } from "./api.js";

export const SPECIALTIES = {
  form: { title: "Form Analyst", markets: ["outcome", "score"] },
  lineups: { title: "Team News Scout", markets: ["outcome", "scorer"] },
  weather: { title: "Weather & Pitch Analyst", markets: ["score", "corners"] },
  odds: { title: "Market Analyst", markets: ["outcome", "score"] },
  set_pieces: { title: "Set-Piece Coach", markets: ["corners"] },
  discipline: { title: "Discipline Analyst", markets: ["cards"] },
  scorers: { title: "Striker Scout", markets: ["scorer"] }
};
const STYLES = { form: "streak reader", lineups: "dressing-room insider", weather: "wind watcher", odds: "value seeker", set_pieces: "dead-ball nerd", discipline: "whistle whisperer", scorers: "box hunter" };
const NAMES = ["Ada Pixel", "Kofi Voxel", "Mira Sprite", "Leo Raster", "Nia Bitmap", "Tomas Glyph", "Ivy Shader", "Rui Tiles", "Zara Palette", "Omar Dither", "Lena Kernel", "Bo Vector"];
const XP_TO_NEXT = { 1: 100, 2: 200, 3: 300, 4: 450, 5: null };
const LEVELS = [0, 50, 150, 300, 500];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));
const iso = (t) => new Date(t).toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const isoWeek = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y) / 864e5 + 1) / 7)).padStart(2, "0")}`;
};
const nextMonday = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + ((8 - (d.getUTCDay() || 7)) % 7 || 7)); return iso(d); };
const fail = (status, error, message) => { throw new ApiError(status, { error, message }, `demo-${uid().slice(0, 8)}`); };

export function createDemoApi({ fresh = false } = {}) {
  const now = Date.now(), H = 3600e3;
  const agents = [
    { id: "agent-nova", name: "Nova", clan: "ZEROG", archetype: "TACTICIAN", evolutionStage: "GENESIS", eloRating: 1284, isRetired: false },
    { id: "agent-kraken", name: "Kraken", clan: "BASE", archetype: "BERSERKER", evolutionStage: "AWAKENED", eloRating: 1190, isRetired: false },
    { id: "agent-luma", name: "Luma", clan: "SOLANA", archetype: "SUPPORT", evolutionStage: "GENESIS", eloRating: 1102, isRetired: false }
  ];
  const player = { userId: "demo-user", username: "demo", walletAddress: "0xdemo" };
  const week = isoWeek();

  const makeAnalyst = (specialty, skill, i) => ({
    id: uid(), name: NAMES[i % NAMES.length], specialty, title: SPECIALTIES[specialty].title,
    markets: SPECIALTIES[specialty].markets, skill, xp: skill === 5 ? 0 : Math.round(XP_TO_NEXT[skill] * 0.4),
    xpToNext: XP_TO_NEXT[skill], weeklySalary: 20 + skill * 20, style: STYLES[specialty], hiredAt: iso(now - 3 * 864e5)
  });

  let agency = null;
  const ledger = [];
  const credit = (delta, kind, ref) => { agency.credits += delta; ledger.unshift({ delta, balanceAfter: agency.credits, kind, ref, createdAt: iso(Date.now()) }); };
  const found = (name, ceo) => {
    agency = {
      id: uid(), name, ceo: { agentId: ceo.id, name: ceo.name, clan: ceo.clan },
      credits: 0, level: 1, points: 0, nextLevelAt: 50, desks: 3, staff: [],
      payroll: { weeklyTotal: 0, nextDueAt: nextMonday() }, standings: { weekly: null, allTime: null }, createdAt: iso(Date.now())
    };
    credit(1500, "grant", "founding");
  };
  const refresh = () => {
    agency.payroll.weeklyTotal = agency.staff.reduce((s, a) => s + a.weeklySalary, 0);
    agency.level = LEVELS.filter((p) => agency.points >= p).length;
    agency.desks = Math.min(7, 2 + agency.level);
    agency.nextLevelAt = LEVELS[agency.level] ?? null;
    // Standings follow the demo leaderboard.
    const rank = (kind) => board(kind).entries.find((e) => e.agencyId === agency.id);
    if (agency.points > 0) { const w = rank("weekly"), a = rank("all-time"); agency.standings = { weekly: w && { rank: w.rank, points: w.points }, allTime: a && { rank: a.rank, points: a.points } }; }
    return clone(agency);
  };

  // Teams and fixtures, relative to now.
  const squads = {
    Arsenal: ["Bukayo Saka", "Martin Odegaard", "Kai Havertz", "Gabriel Martinelli", "Declan Rice", "William Saliba"],
    Chelsea: ["Cole Palmer", "Nicolas Jackson", "Enzo Fernandez", "Noni Madueke", "Reece James", "Levi Colwill"],
    "Real Madrid": ["Kylian Mbappe", "Vinicius Junior", "Jude Bellingham", "Rodrygo", "Federico Valverde", "Antonio Rudiger"],
    Barcelona: ["Lamine Yamal", "Robert Lewandowski", "Raphinha", "Pedri", "Gavi", "Ronald Araujo"],
    Inter: ["Lautaro Martinez", "Marcus Thuram", "Nicolo Barella", "Hakan Calhanoglu", "Federico Dimarco", "Alessandro Bastoni"],
    Juventus: ["Dusan Vlahovic", "Kenan Yildiz", "Teun Koopmeiners", "Weston McKennie", "Gleison Bremer", "Andrea Cambiaso"],
    "Bayern Munich": ["Harry Kane", "Jamal Musiala", "Leroy Sane", "Michael Olise", "Joshua Kimmich", "Dayot Upamecano"],
    Dortmund: ["Serhou Guirassy", "Julian Brandt", "Karim Adeyemi", "Donyell Malen", "Emre Can", "Nico Schlotterbeck"],
    PSG: ["Ousmane Dembele", "Bradley Barcola", "Vitinha", "Joao Neves", "Achraf Hakimi", "Marquinhos"],
    Marseille: ["Mason Greenwood", "Amine Harit", "Adrien Rabiot", "Pierre-Emile Hojbjerg", "Leonardo Balerdi", "Geronimo Rulli"]
  };
  let nextId = 1035037;
  const fx = (league, leagueId, home, away, kickoff, venue, city) => ({
    fixtureId: nextId++, leagueId, leagueName: league, season: 2026, kickoffAt: iso(kickoff), homeTeam: home, awayTeam: away,
    homeTeamId: nextId * 2, awayTeamId: nextId * 2 + 1, status: kickoff < now - 2 * H ? "FT" : kickoff < now ? "2H" : "NS",
    venue, venueCity: city, lockAt: iso(kickoff - 5 * 60e3)
  });
  const fixtures = [
    fx("Premier League", 39, "Arsenal", "Chelsea", now + 2.5 * H, "Emirates Stadium", "London"),
    fx("La Liga", 140, "Real Madrid", "Barcelona", now + 27 * H, "Santiago Bernabeu", "Madrid"),
    fx("Serie A", 135, "Inter", "Juventus", now + 3 * 60e3 + 5 * 60e3 - 60e3, "San Siro", "Milan"),
    fx("Bundesliga", 78, "Bayern Munich", "Dortmund", now + 51 * H, "Allianz Arena", "Munich"),
    fx("Ligue 1", 61, "PSG", "Marseille", now - 26 * H, "Parc des Princes", "Paris")
  ];
  const squadOf = (f) => [
    ...squads[f.homeTeam].map((name, i) => ({ id: `${f.fixtureId}${i}`, name, side: "HOME" })),
    ...squads[f.awayTeam].map((name, i) => ({ id: `${f.fixtureId}${i + 50}`, name, side: "AWAY" }))
  ];
  const rooms = new Map(fixtures.map((f) => [f.fixtureId, {
    analysesUsed: 0, prediction: null, analysis: null,
    absences: [{ name: squads[f.awayTeam][5], side: "AWAY", type: "Missing Fixture", reason: "Hamstring" }, { name: squads[f.homeTeam][4], side: "HOME", type: "Questionable", reason: "Knock" }],
    outcome: null
  }]));
  const open = (f) => Date.now() < Date.parse(f.lockAt);

  // A settled past match so history and the breakdown can be seen.
  const past = fixtures[4], pastRoom = rooms.get(past.fixtureId);
  pastRoom.outcome = { status: "FINISHED", regulation: { home: 2, away: 1 }, scorers: [`${past.fixtureId}0`], totalCards: 5, totalCorners: 12 };

  // Desk analysis: each analyst reads the match through its own lens.
  const seed = (s) => [...String(s)].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381);
  function analyse(f) {
    const squad = squadOf(f), h = seed(f.fixtureId);
    const base = { home: 1 + (h % 3), away: (h >> 3) % 2 };
    const pickOutcome = (s) => (s.home > s.away ? "HOME" : s.home < s.away ? "AWAY" : "DRAW");
    const reports = agency.staff.map((a) => {
      const wobble = (seed(a.id + f.fixtureId) % 3) - 1, sharp = a.skill >= 3;
      const score = { home: Math.max(0, base.home + (sharp ? 0 : wobble)), away: Math.max(0, base.away + (sharp ? 0 : Math.max(0, -wobble))) };
      const rec = {};
      const conf = Math.round((0.45 + a.skill * 0.1) * 100) / 100;
      for (const m of a.markets) {
        if (m === "outcome") rec.outcome = { pick: pickOutcome(score), confidence: conf };
        if (m === "score") rec.score = { pick: score, confidence: conf };
        if (m === "corners") rec.corners = { pick: 9 + (h % 4) + (sharp ? 0 : wobble), confidence: conf };
        if (m === "cards") rec.cards = { pick: 3 + (h % 3) + (sharp ? 0 : wobble), confidence: conf };
        if (m === "scorer") { const p = squad[(h >> 2) % 3]; rec.scorer = { pick: { playerId: p.id, name: p.name }, confidence: conf }; }
      }
      const lines = {
        form: [`${f.homeTeam} have won 4 of their last 5 at home`, `${f.awayTeam} concede early in away games`],
        lineups: [`${rooms.get(f.fixtureId).absences[0].name} is out for ${f.awayTeam}`, `${f.homeTeam} name a near full-strength side`],
        weather: [`light rain expected in ${f.venueCity} at kickoff`, "a slick pitch should mean more corners"],
        odds: [`bookmakers make ${f.homeTeam} narrow favourites`, "the draw is drifting out"],
        set_pieces: [`${f.homeTeam} average 6.4 corners at home`, "both sides defend set pieces deep"],
        discipline: ["the referee shows 4.6 cards a game", "a heated derby atmosphere is expected"],
        scorers: [`${squad[(h >> 2) % 3].name} has scored in 3 straight games`, "the away full-back struggles in 1v1s"]
      }[a.specialty];
      const parts = [];
      if (rec.score) parts.push(`${rec.score.pick.home}-${rec.score.pick.away}`);
      else if (rec.outcome) parts.push(rec.outcome.pick === "DRAW" ? "a draw" : `${rec.outcome.pick === "HOME" ? f.homeTeam : f.awayTeam} to win`);
      if (rec.corners) parts.push(`${rec.corners.pick} corners`);
      if (rec.cards) parts.push(`${rec.cards.pick} cards`);
      if (rec.scorer) parts.push(`${rec.scorer.pick.name} to score`);
      return {
        analystId: a.id, name: a.name, title: a.title, specialty: a.specialty, skill: a.skill,
        brief: { available: true, narrative: `${lines[0][0].toUpperCase()}${lines[0].slice(1)}, and ${lines[1]}.`, source: "llm" },
        signals: lines, recommendations: rec, note: `Recommends ${parts.join(", ")}.`
      };
    });
    const vote = (m) => { const r = reports.filter((x) => x.recommendations[m]); return r.length ? r.sort((a, b) => b.skill - a.skill)[0].recommendations[m].pick : undefined; };
    const covered = (m) => reports.some((r) => r.recommendations[m]);
    const score = vote("score") || base;
    const scorer = vote("scorer") || { playerId: squad[0].id, name: squad[0].name };
    const picks = {
      outcome: pickOutcome(score), score, corners: vote("corners") ?? 10, cards: vote("cards") ?? 4,
      scorerId: scorer.playerId, scorerName: scorer.name
    };
    const markets = Object.fromEntries(["outcome", "score", "corners", "cards", "scorer"].map((m) => [m, {
      covered: covered(m), source: covered(m) ? "desk" : "ceo",
      support: reports.filter((r) => r.recommendations[m]).map((r) => r.analystId)
    }]));
    const gut = Object.entries(markets).filter(([, v]) => !v.covered).map(([k]) => k);
    const summary = `${agency.ceo.name}'s desk: ${picks.outcome === "DRAW" ? "a draw" : `${picks.outcome === "HOME" ? f.homeTeam : f.awayTeam} to win`}, ${score.home}-${score.away}, ${picks.corners} corners, ${picks.cards} cards, ${picks.scorerName} to score. Built from ${reports.length} analyst report${reports.length === 1 ? "" : "s"}.${gut.length ? ` Gut calls (no analyst covers them): ${gut.join(", ")}.` : ""}`;
    return { id: uid(), reports, combined: { picks, markets, summary }, createdAt: iso(Date.now()) };
  }

  const predictionFor = (f, room, picks, status = "DRAFT") => ({
    id: room.prediction?.id || uid(), fixtureId: f.fixtureId, match: `${f.homeTeam} vs ${f.awayTeam}`, leagueName: f.leagueName,
    kickoffAt: f.kickoffAt, lockAt: f.lockAt, week, status, picks, edited: false, lockedAt: null, autoLocked: false,
    settledAt: null, points: 0, exactHits: 0, breakdown: null
  });

  // Seeded state: an agency with two analysts and a settled past match.
  if (!fresh) {
    found("Pixel FC", agents[0]);
    const a1 = makeAnalyst("form", 3, 0), a2 = makeAnalyst("weather", 2, 1);
    agency.staff.push(a1, a2);
    credit(-205, "hire", a1.id); credit(-135, "hire", a2.id);
    const pr = predictionFor(past, pastRoom, { outcome: "HOME", score: { home: 2, away: 1 }, corners: 10, cards: 5, scorerId: `${past.fixtureId}1`, scorerName: squads.PSG[1] }, "SETTLED");
    Object.assign(pr, { lockedAt: iso(now - 27 * H), autoLocked: true, settledAt: iso(now - 24 * H), points: 22, exactHits: 3,
      breakdown: { outcome: { result: "EXACT", points: 5 }, score: { result: "EXACT", points: 7 }, corners: { result: "MISS", points: 0 }, cards: { result: "EXACT", points: 10 }, scorer: { result: "MISS", points: 0 } } });
    pastRoom.prediction = pr;
    agency.points = 22;
    credit(220, "winnings", pr.id);
  }

  // The weekly talent pool: 10 candidates, every specialty at least once.
  const specs = Object.keys(SPECIALTIES);
  const pool = Array.from({ length: 10 }, (_, i) => {
    const specialty = specs[i % specs.length], skill = 1 + ((i * 7) % 5);
    return { candidateKey: `${week}:${i}`, name: NAMES[(i + 2) % NAMES.length], specialty, title: SPECIALTIES[specialty].title, markets: SPECIALTIES[specialty].markets,
      skill, hireCost: 60 + skill * 85, weeklySalary: 20 + skill * 20, style: STYLES[specialty] };
  });
  const hired = new Set();

  const board = (kind) => {
    const rows = ["Golden Boot FC", "Offside Trap", "Xg Wizards", "Tiki Taka Labs", "Clean Sheet Co", "Park The Bus", "Late Winner", "Nutmeg Inc", "False Nine", "Top Bins"].map((n, i) => ({
      agencyId: `x${i}`, agencyName: n, ceo: { name: ["Orion", "Vex", "Pip", "Rook", "Saga", "Mako", "Nyx", "Bolt", "Echo", "Rune"][i], clan: ["ZEROG", "BASE", "SOLANA", "OKX"][i % 4] },
      points: (kind === "weekly" ? 60 : 420) - i * (kind === "weekly" ? 5.5 : 31), exactHits: 9 - Math.floor(i / 2), predictions: 6 - (i % 3)
    }));
    if (agency?.points) rows.push({ agencyId: agency.id, agencyName: agency.name, ceo: { name: agency.ceo.name, clan: agency.ceo.clan }, points: agency.points, exactHits: 3, predictions: 1 });
    rows.sort((a, b) => b.points - a.points || b.exactHits - a.exactHits);
    const entries = rows.map((r, i) => ({ rank: i + 1, ...r }));
    return { kind, week: kind === "weekly" ? week : null, entries, me: entries.find((e) => e.agencyId === agency?.id) || null };
  };

  const needAgency = () => { if (!agency) fail(404, "not_found", "create your agency first"); };
  const fixtureView = (f) => ({ ...clone(f), open: open(f), prediction: rooms.get(f.fixtureId).prediction ? { status: rooms.get(f.fixtureId).prediction.status, points: rooms.get(f.fixtureId).prediction.points } : null });

  return {
    demo: true,
    hasSession: () => true,
    signOut() {},
    async startSession() { await wait(300); return { token: "demo", expiresAt: iso(Date.now() + 12 * H), player, agents, agency: agency && refresh() }; },
    async arenaTokenFromPrivy() { return "demo"; },
    async me() { await wait(150); return { player, agents, agency: agency && refresh() }; },
    async createAgency(name, ceoAgentId) {
      await wait(300);
      if (agency) fail(409, "conflict", "you already have an agency");
      if (!/^[A-Za-z0-9 '&.-]{3,32}$/.test(name || "")) fail(400, "bad_request", "name must be 3-32 letters, numbers, spaces or ' & . -");
      const ceo = agents.find((a) => a.id === ceoAgentId);
      if (!ceo) fail(403, "forbidden", "that agent isn't yours");
      found(name.trim(), ceo);
      return refresh();
    },
    async agency() { await wait(120); needAgency(); return refresh(); },
    async setCeo(ceoAgentId) { await wait(200); needAgency(); const c = agents.find((a) => a.id === ceoAgentId); if (!c) fail(403, "forbidden", "that agent isn't yours"); agency.ceo = { agentId: c.id, name: c.name, clan: c.clan }; return refresh(); },
    async ledger() { await wait(120); needAgency(); return { credits: agency.credits, entries: clone(ledger) }; },
    async talent() { await wait(200); needAgency(); return { week, refreshesAt: nextMonday(), candidates: clone(pool.filter((c) => !hired.has(c.candidateKey))) }; },
    async hire(candidateKey) {
      await wait(300); needAgency();
      const c = pool.find((x) => x.candidateKey === candidateKey && !hired.has(x.candidateKey));
      if (!c) fail(404, "not_found", "that candidate isn't in this week's pool");
      if (agency.staff.length >= agency.desks) fail(409, "conflict", "all desks are taken");
      if (agency.credits < c.hireCost) fail(402, "insufficient_credits", "not enough credits to hire");
      hired.add(candidateKey);
      const a = { ...makeAnalyst(c.specialty, c.skill, 0), name: c.name, style: c.style, weeklySalary: c.weeklySalary, hiredAt: iso(Date.now()), xp: 0 };
      agency.staff.push(a);
      credit(-c.hireCost, "hire", a.id);
      return { analyst: clone(a), agency: refresh() };
    },
    async fire(id) {
      await wait(250); needAgency();
      const a = agency.staff.find((x) => x.id === id);
      if (!a) fail(404, "not_found", "unknown analyst");
      agency.staff = agency.staff.filter((x) => x.id !== id);
      return { fired: clone(a), agency: refresh() };
    },
    async fixtures() { await wait(200); needAgency(); return { fixtures: fixtures.map(fixtureView) }; },
    async fixture(id) {
      await wait(200); needAgency();
      const f = fixtures.find((x) => String(x.fixtureId) === String(id));
      if (!f) fail(404, "not_found", "unknown fixture");
      const room = rooms.get(f.fixtureId);
      return { fixture: { ...clone(f), open: open(f) }, squad: squadOf(f), absences: clone(room.absences), outcome: clone(room.outcome), analysesUsed: room.analysesUsed, analysesAllowed: 3, prediction: clone(room.prediction), analysis: clone(room.analysis) };
    },
    async analyze(id) {
      needAgency();
      const f = fixtures.find((x) => String(x.fixtureId) === String(id)), room = f && rooms.get(f.fixtureId);
      if (!f) fail(404, "not_found", "unknown fixture");
      if (!open(f)) fail(409, "conflict", "predictions for this match are closed");
      if (room.prediction?.status === "LOCKED") fail(409, "conflict", "your picks are already locked");
      if (room.analysesUsed >= 3) fail(429, "limit_reached", "analysis limit reached for this match");
      await wait(2200 + agency.staff.length * 350);
      room.analysesUsed += 1;
      room.analysis = analyse(f);
      room.prediction = predictionFor(f, room, clone(room.analysis.combined.picks));
      return { analysis: clone(room.analysis), prediction: clone(room.prediction), analysesUsed: room.analysesUsed, analysesAllowed: 3 };
    },
    async editPrediction(id, patch) {
      await wait(200); needAgency();
      const f = fixtures.find((x) => String(x.fixtureId) === String(id)), room = f && rooms.get(f.fixtureId);
      if (!room?.prediction) fail(409, "conflict", "run the desk analysis first");
      if (!open(f) || room.prediction.status !== "DRAFT") fail(409, "conflict", "predictions for this match are closed");
      const picks = { ...room.prediction.picks, ...patch };
      if (patch.scorerId !== undefined) picks.scorerName = patch.scorerId ? squadOf(f).find((p) => p.id === patch.scorerId)?.name : null;
      const want = picks.score.home > picks.score.away ? "HOME" : picks.score.home < picks.score.away ? "AWAY" : "DRAW";
      if (picks.outcome !== want) fail(400, "bad_request", "the exact score must agree with the outcome");
      room.prediction = { ...room.prediction, picks, edited: true };
      return { prediction: clone(room.prediction) };
    },
    async lock(id) {
      await wait(250); needAgency();
      const f = fixtures.find((x) => String(x.fixtureId) === String(id)), room = f && rooms.get(f.fixtureId);
      if (!room?.prediction) fail(409, "conflict", "run the desk analysis first");
      if (!open(f) || room.prediction.status !== "DRAFT") fail(409, "conflict", "predictions for this match are closed");
      room.prediction = { ...room.prediction, status: "LOCKED", lockedAt: iso(Date.now()) };
      return { prediction: clone(room.prediction) };
    },
    async predictions() { await wait(150); needAgency(); return { predictions: [...rooms.values()].map((r) => r.prediction).filter(Boolean).map(clone) }; },
    async leaderboard(kind) { await wait(200); return board(kind === "weekly" ? "weekly" : "all-time"); }
  };
}
