// The Kult Sports office: an isometric pixel-art analysis agency, adapted
// from Kult Create's office renderer. The painted room (art/office.png) gives
// the floor projection; desks, analysts, the CEO and effects are sprites drawn
// on top. The number of desks follows the agency's level (3 to 7), one
// analyst sits at each staffed desk, and empty desks invite a hire.

export const W = 768, H = 512;
export let iso = (gx, gy, z = 0) => [gx * 16, gy * 8 - z]; // replaced by the art's projection

// Desk centres (grid). The first three fill the front row; more desks appear
// as the agency levels up.
const SLOTS = [[4.6, 8.8], [7.0, 8.8], [9.8, 8.8], [4.6, 4.8], [7.4, 4.8], [2.2, 8.8], [12.2, 8.8]];
const AISLES = [1.7, 6.6, 10.4];
const CORRIDOR_X = 13.55;
// The rug's inner field (canvas px), measured on art/office.png: painted as a pitch.
const RUG = { L: [392, 226], T: [452.5, 194.5], R: [582.5, 265.5], B: [519.5, 298.5] };

// One look per analyst, picked from the ten character sprites.
const LOOKS = ["producer", "designer", "artdirector", "illustrator", "background", "marketing", "engineer", "qa", "playtester", "publisher"];
export const SPECIALTY_COLORS = { form: "#7ee081", lineups: "#5ec8f2", weather: "#9fd8ff", odds: "#f2c14e", set_pieces: "#ff9f5a", discipline: "#f78c6b", scorers: "#c792ea" };

const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

export class Office {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.W = W; this.H = H; this.dpr = 1;
    this.art = null;
    this.t = 0;
    this.people = new Map();
    this.desks = [];                 // [{ slot, x, y, analystId|null }]
    this.particles = [];
    this.notes = [];
    this.screen = { mode: "idle", lines: [] };
    this.portrait = null;
    this.lightsOn = true;
    this.hoverDesk = -1;
    this.ceoHome = [6.8, 1.9];
    this.screenCanvas = document.createElement("canvas");
    this.screenCanvas.width = 156 * 4; this.screenCanvas.height = 66 * 4;
    this.neonCanvas = document.createElement("canvas");
    this.neonCanvas.width = 480; this.neonCanvas.height = 300;
  }

  // ---------------------------------------------------------------- art
  useArt(manifest, images, urlOf = (f) => `art/${f}`) {
    const bg = manifest.background;
    if (!bg || !images[bg.file]) return false;
    const pr = bg.projection;
    iso = (gx, gy, z = 0) => [pr.origin[0] + gx * pr.ex[0] + gy * pr.ey[0], pr.origin[1] + gx * pr.ex[1] + gy * pr.ey[1] - z * pr.zScale];
    this.art = { manifest, images, bg, img: images[bg.file], urlOf, loading: new Set() };
    this.W = manifest.canvas.width; this.H = manifest.canvas.height;
    this.ceoHome = this.gridAt(bg.rugCenter);
    this.setPixelScale(2);
    return true;
  }

  // Canvas pixels per office pixel (matched to the screen by the page).
  setPixelScale(k) {
    if (!(k > 0)) return;
    const w = Math.round(this.W * k), h = Math.round(this.H * k);
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.dpr = w / this.W;
    this.canvas.width = w; this.canvas.height = h;
  }

  gridAt([px, py]) {
    const pr = this.art.bg.projection, dx = px - pr.origin[0], dy = py - pr.origin[1];
    const det = pr.ex[0] * pr.ey[1] - pr.ey[0] * pr.ex[1];
    return [(dx * pr.ey[1] - pr.ey[0] * dy) / det, (pr.ex[0] * dy - dx * pr.ex[1]) / det];
  }

  // ---------------------------------------------------------------- agency
  // ceo: { name, archetype }; staff: Analyst[]; desks: number of desks.
  setAgency({ ceo, staff = [], desks = 3 }) {
    this.ceoArchetype = String(ceo?.archetype || "hybrid").toLowerCase();
    const keep = new Map(this.people);
    this.people.clear();
    const used = new Set();
    this.desks = SLOTS.slice(0, Math.max(0, Math.min(7, desks))).map(([x, y], slot) => ({ slot, x, y, analystId: null }));
    staff.slice(0, this.desks.length).forEach((a, i) => {
      // A stable, distinct look per analyst.
      let k = hash(a.id) % LOOKS.length;
      while (used.has(LOOKS[k]) && used.size < LOOKS.length) k = (k + 1) % LOOKS.length;
      used.add(LOOKS[k]);
      const d = this.desks[i];
      d.analystId = a.id;
      const prev = keep.get(a.id), [sx, sy] = this.seatOf(d);
      this.people.set(a.id, {
        ...a, look: LOOKS[k], isCeo: false, desk: d, x: sx, y: sy, path: [], walking: false, facing: 1,
        state: prev?.state || "idle", stateAt: prev?.stateAt || 0, phase: (hash(a.id) % 100) / 100 * Math.PI * 2
      });
    });
    const prevCeo = keep.get("ceo");
    this.people.set("ceo", {
      id: "ceo", name: ceo?.name || "CEO", isCeo: true, desk: null,
      x: prevCeo?.x ?? this.ceoHome[0], y: prevCeo?.y ?? this.ceoHome[1], path: prevCeo?.path || [], walking: false, facing: 1,
      state: prevCeo?.state || "idle", stateAt: prevCeo?.stateAt || 0, phase: 1.3
    });
  }

  seatOf(d) { return [d.x - 0.75, d.y - 0.8]; }
  person(id) { return this.people.get(id); }
  setState(id, state) { const p = this.people.get(id); if (p) { p.state = state; p.stateAt = this.t; } }
  setAll(state) { for (const p of this.people.values()) if (!p.isCeo) { p.state = state; p.stateAt = this.t; } }

  // The CEO walks to stand in front of an analyst's desk, then goes back.
  visit(id, back = true) {
    const ceo = this.people.get("ceo"), target = this.people.get(id);
    if (!ceo || !target || target.isCeo) return;
    this.walkTo(ceo, [target.desk.x, target.desk.y + 0.95], back ? () => setTimeout(() => this.walkTo(ceo, this.ceoHome), 1400) : null);
  }
  home() { const ceo = this.people.get("ceo"); if (ceo) this.walkTo(ceo, this.ceoHome); }

  walkTo(p, [tx, ty], done) {
    const aisleOf = (y) => AISLES.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
    const from = aisleOf(p.y), to = aisleOf(ty), pts = [];
    if (Math.abs(p.y - from) > 0.05) pts.push([p.x, from]);
    if (from !== to) pts.push([CORRIDOR_X, from], [CORRIDOR_X, to]);
    pts.push([tx, to]);
    if (Math.abs(ty - to) > 0.05) pts.push([tx, ty]);
    p.path = pts;
    p.onArrive = done || null;
  }

  // ---------------------------------------------------------------- effects
  packet(fromId, color) {
    const p = this.people.get(fromId);
    if (!p || !this.art) return;
    const [sx, sy] = this.anchor(fromId), [tx, ty] = this.quadCenter(this.art.bg.screen);
    this.particles.push({ kind: "packet", sx, sy, tx, ty, t0: this.t, dur: 0.9, color });
  }
  confetti() {
    if (!this.art) return;
    const [cx, cy] = this.quadCenter(this.art.bg.screen);
    const colors = ["#7ee081", "#f2c14e", "#5ec8f2", "#ffffff", "#3ddc84", "#f78c6b"];
    for (let i = 0; i < 90; i += 1) {
      this.particles.push({ kind: "confetti", x: cx + (Math.random() - 0.5) * 80, y: cy - Math.random() * 10, vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 60, t0: this.t, dur: 2.6 + Math.random(), color: colors[i % colors.length] });
    }
  }
  addNote(color) { if (this.notes.length < 24) this.notes.push({ color }); }
  clearNotes() { this.notes = []; }
  isHappy(p) { return (p.state === "done" && this.t - p.stateAt < 3) || (p.celebrateUntil ?? 0) > this.t; }
  celebrate(seconds = 5) {
    let i = 0;
    for (const p of this.people.values()) { p.celebrateUntil = this.t + seconds + (i++ % 4) * 0.15; p.celebrateFrom = this.t + (i % 3) * 0.12; }
  }

  // ---------------------------------------------------------------- picking
  anchor(id) {
    const p = typeof id === "string" ? this.people.get(id) : id;
    if (!p) return null;
    const [fx, fy] = iso(p.x, p.y);
    if (p.isCeo) { const c = this.ceoArt(); return [fx, fy - (c ? c.m.frame[1] * (c.m.scale || 1) : 60) - 2]; }
    const c = this.art?.manifest.characters?.[p.look];
    return [fx, fy - (c ? c.frame[1] : 56) - 2];
  }

  hit(x, y) {
    let best = null;
    for (const p of this.people.values()) {
      const [fx, fy] = iso(p.x, p.y);
      const c = p.isCeo ? this.ceoArt()?.m : this.art?.manifest.characters?.[p.look];
      const w = c ? c.frame[0] * 0.7 : 24, h = c ? c.frame[1] : 56;
      if (x >= fx - w / 2 && x <= fx + w / 2 && y >= fy - h && y <= fy) if (!best || p.y > best.y) best = p;
    }
    return best;
  }

  // An empty desk under the pointer (its slot index), or -1.
  hitDesk(x, y) {
    for (const d of this.desks) {
      if (d.analystId) continue;
      const [cx, cy] = iso(d.x - 0.3, d.y - 0.2);
      if (Math.abs(x - cx) < 34 && y > cy - 64 && y < cy + 14) return d.slot;
    }
    return -1;
  }

  // ---------------------------------------------------------------- loop
  update(dt) {
    this.t += dt;
    for (const p of this.people.values()) {
      if (!p.path.length) { p.walking = false; continue; }
      p.walking = true;
      const [tx, ty] = p.path[0];
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy), step = 3.2 * dt;
      if (Math.abs(dx - dy) > 0.01) p.facing = dx - dy > 0 ? 1 : -1;
      if (d <= step) {
        p.x = tx; p.y = ty; p.path.shift();
        if (!p.path.length) { p.walking = false; const f = p.onArrive; p.onArrive = null; f?.(); }
      } else { p.x += (dx / d) * step; p.y += (dy / d) * step; }
    }
    this.particles = this.particles.filter((q) => this.t - q.t0 < q.dur);
  }

  draw() {
    const g = this.ctx, A = this.art;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    if (!A) return;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(A.img, 0, 0, this.W, this.H);
    g.imageSmoothingEnabled = false;
    this.drawPitch(g);
    // Wall: live match screen, neon sign, CEO portrait, sticky notes.
    this.paintScreen();
    this.drawInQuad(g, this.screenCanvas, A.bg.screen, true);
    if (A.bg.neon) { this.paintNeon(); this.drawInQuad(g, this.neonCanvas, this.insetQuad(A.bg.neon, 0.07, 0.1), true); }
    const ceo = this.ceoArt();
    const portrait = this.portrait?.complete && this.portrait.naturalWidth ? this.portrait : ceo?.m.portrait && A.images[ceo.m.portrait];
    if (portrait) this.drawInQuad(g, portrait, A.bg.portrait, true);
    this.notes.forEach((n, i) => {
      const col = i % 6, row = Math.floor(i / 6), u = 0.06 + col * 0.155, v = 0.1 + row * 0.22, q = A.bg.whiteboard;
      this.poly(g, [this.quadPoint(q, u, v), this.quadPoint(q, u + 0.12, v), this.quadPoint(q, u + 0.12, v + 0.17), this.quadPoint(q, u, v + 0.17)], n.color);
    });
    // Depth-sorted floor objects.
    const items = [];
    for (const d of this.desks) {
      items.push({ k: d.x + d.y + 0.5, draw: () => this.drawDesk(g, d) });
      if (!d.analystId) items.push({ k: d.x + d.y - 0.6, draw: () => this.drawEmptyChair(g, d) });
    }
    for (const p of this.people.values()) items.push({ k: p.x + p.y + 0.02, draw: () => this.drawPerson(g, p) });
    for (const [name, x, y] of [["podium", 6.15, 1.1], ["plant", 0.7, 11.3], ["plant", 13.3, 0.7], ["cooler", 0.6, 0.6], ["coffee", 13.0, 10.8]]) items.push({ k: x + y, draw: () => this.drawProp(g, name, x, y) });
    items.sort((a, b) => a.k - b.k);
    for (const it of items) it.draw();
    this.drawSteam(g, 13.0, 10.8);
    for (const d of this.desks) if (!d.analystId) this.drawHireMarker(g, d);
    this.drawStatusIcons(g);
    this.drawParticles(g);
    if (!this.lightsOn) { g.fillStyle = "rgba(4,12,9,0.55)"; g.fillRect(0, 0, this.W, this.H); }
  }

  // ---------------------------------------------------------------- primitives
  poly(g, pts, fill) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
    g.closePath(); g.fillStyle = fill; g.fill();
  }
  quadCenter(q) { return [(q.tl[0] + q.tr[0] + q.bl[0] + q.br[0]) / 4, (q.tl[1] + q.tr[1] + q.bl[1] + q.br[1]) / 4]; }
  quadPoint(q, u, v) { return [q.tl[0] + u * (q.tr[0] - q.tl[0]) + v * (q.bl[0] - q.tl[0]), q.tl[1] + u * (q.tr[1] - q.tl[1]) + v * (q.bl[1] - q.tl[1])]; }
  insetQuad(q, ix, iy) { const P = (u, v) => this.quadPoint(q, u, v); return { tl: P(ix, iy), tr: P(1 - ix, iy), bl: P(ix, 1 - iy), br: P(1 - ix, 1 - iy) }; }
  drawInQuad(g, img, q, smooth = false) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    g.save();
    g.transform((q.tr[0] - q.tl[0]) / w, (q.tr[1] - q.tl[1]) / w, (q.bl[0] - q.tl[0]) / h, (q.bl[1] - q.tl[1]) / h, q.tl[0], q.tl[1]);
    g.imageSmoothingEnabled = smooth; if (smooth) g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0);
    g.restore();
  }
  sprite(kind, name) {
    const m = this.art?.manifest[kind]?.[name], img = m && this.art.images[m.file];
    return img ? { m, img } : null;
  }

  // The CEO rug as a little pitch: touchlines, halfway line, centre circle, boxes.
  drawPitch(g) {
    const P = (u, v) => { // u along the long side (L->T is short, T->R long), v across
      const a = [RUG.L[0] + (RUG.T[0] - RUG.L[0]) * v, RUG.L[1] + (RUG.T[1] - RUG.L[1]) * v];
      const b = [RUG.B[0] + (RUG.R[0] - RUG.B[0]) * v, RUG.B[1] + (RUG.R[1] - RUG.B[1]) * v];
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    };
    // Mowing stripes.
    for (let i = 0; i < 8; i += 2) this.poly(g, [P(i / 8, 0), P((i + 1) / 8, 0), P((i + 1) / 8, 1), P(i / 8, 1)], "rgba(255,255,255,0.05)");
    g.strokeStyle = "rgba(240,255,246,0.75)"; g.lineWidth = 1;
    const line = (pts, close = false) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); if (close) g.closePath(); g.stroke(); };
    const m = 0.06;
    line([P(m, m), P(1 - m, m), P(1 - m, 1 - m), P(m, 1 - m)], true);
    line([P(0.5, m), P(0.5, 1 - m)]);
    line(Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return P(0.5 + Math.cos(a) * 0.09, 0.5 + Math.sin(a) * 0.2); }));
    line([P(m, 0.28), P(0.2, 0.28), P(0.2, 0.72), P(m, 0.72)]);
    line([P(1 - m, 0.28), P(0.8, 0.28), P(0.8, 0.72), P(1 - m, 0.72)]);
    g.fillStyle = "rgba(240,255,246,0.9)"; const [cx, cy] = P(0.5, 0.5); g.fillRect(cx - 1, cy - 1, 2, 2);
  }

  // ---------------------------------------------------------------- wall
  paintNeon() {
    const c = this.neonCanvas, s = c.getContext("2d"), t = this.t;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.fillStyle = "#0b1a14"; s.fillRect(0, 0, c.width, c.height);
    const flick = (seed) => { const k = Math.sin(t * 17 + seed) + Math.sin(t * 5.3 + seed * 3); return k < -1.75 ? 0.15 : k < -1.55 ? 0.6 : 1; };
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.4);
    const word = (text, y, size, color, seed) => {
      const a = flick(seed) * pulse;
      s.font = `${size}px "Press Start 2P", monospace`; s.textAlign = "center"; s.textBaseline = "middle";
      s.globalAlpha = a; s.shadowColor = color; s.shadowBlur = 28 * a; s.fillStyle = color; s.fillText(text, c.width / 2, y);
      s.shadowBlur = 8 * a; s.fillStyle = "#ffffff"; s.globalAlpha = a * 0.55; s.fillText(text, c.width / 2, y);
      s.globalAlpha = 1; s.shadowBlur = 0;
    };
    word("KULT", c.height * 0.33, 86, "#3ddc84", 1.1);
    word("SPORTS", c.height * 0.72, 62, "#ffd166", 4.7);
  }

  // The big screen: next match, analysis in progress, or the CEO's picks.
  paintScreen() {
    const c = this.screenCanvas, s = c.getContext("2d"), S = this.screen, CW = 156, CH = 66;
    s.setTransform(c.width / CW, 0, 0, c.height / CH, 0, 0);
    s.imageSmoothingEnabled = false;
    s.fillStyle = "#06221a"; s.fillRect(0, 0, CW, CH);
    s.textBaseline = "top";
    const text = (str, x, y, color, size = 6) => { s.font = `${size}px "Press Start 2P", monospace`; s.fillStyle = color; s.fillText(String(str).toUpperCase(), x, y); };
    const fit = (str, n) => (str.length > n ? `${str.slice(0, n - 1)}.` : str);
    if (S.mode === "work") {
      text("DESK ANALYSIS", 5, 5, "#ffd166");
      text(fit(S.title || "", 24), 5, 16, "#e6fff2");
      (S.lines || []).slice(-3).forEach((l, i) => text(fit(l, 24), 5, 28 + i * 8, "#8fd7b5", 5));
      s.fillStyle = "#0e3a2c"; s.fillRect(5, 56, 146, 5);
      s.fillStyle = "#3ddc84"; s.fillRect(5, 56, Math.round(146 * ((this.t * 0.35) % 1)), 5);
    } else if (S.mode === "picks") {
      text(S.locked ? "LOCKED IN" : "CEO'S PICKS", 5, 5, S.locked ? "#7ee081" : "#ffd166");
      text(fit(S.title || "", 24), 5, 16, "#e6fff2");
      (S.lines || []).slice(0, 4).forEach((l, i) => text(fit(l, 24), 5, 27 + i * 8, "#e6fff2", 5));
    } else if (S.mode === "result") {
      text("FULL TIME", 5, 5, "#5ec8f2");
      text(fit(S.title || "", 24), 5, 16, "#e6fff2");
      text(S.big || "", 5, 30, "#7ee081", 10);
      (S.lines || []).slice(0, 1).forEach((l) => text(fit(l, 24), 5, 50, "#ffd166", 5));
    } else {
      text("KULT SPORTS", 5, 5, "#3ddc84", 8);
      if (S.title) {
        text("NEXT MATCH", 5, 20, "#8fd7b5", 5);
        text(fit(S.title, 24), 5, 30, "#e6fff2");
        text(fit(S.sub || "", 26), 5, 42, "#ffd166", 5);
        text(Math.floor(this.t * 1.5) % 2 ? "READY FOR ANALYSIS_" : "READY FOR ANALYSIS", 5, 54, "#5ec8f2", 5);
      } else {
        text(Math.floor(this.t * 1.5) % 2 ? "NO MATCHES RIGHT NOW_" : "NO MATCHES RIGHT NOW", 5, 30, "#8fd7b5", 5);
      }
    }
    s.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < CH; y += 2) s.fillRect(0, y, CW, 0.5);
  }

  // ---------------------------------------------------------------- floor
  drawDesk(g, d) {
    const s = this.sprite("sprites", "desk");
    if (!s) return;
    const left = iso(d.x - 1, d.y + 0.45), right = iso(d.x + 1, d.y - 0.45), front = iso(d.x + 1, d.y + 0.45);
    const cx = (left[0] + right[0]) / 2, top = front[1] - s.m.h + 2;
    g.drawImage(s.img, Math.round(cx - s.m.w / 2), Math.round(top));
    const p = d.analystId && this.people.get(d.analystId);
    if (p?.state === "working") {
      g.fillStyle = `rgba(126,255,190,${0.18 + 0.08 * Math.sin(this.t * 6)})`;
      g.fillRect(Math.round(cx - s.m.w * 0.36), Math.round(top), Math.round(s.m.w * 0.34), Math.round(s.m.h * 0.42));
    }
    if (p) this.drawDeskProp(g, p.specialty, Math.round(cx + s.m.w * 0.12), Math.round(top + s.m.h * 0.3));
  }

  // A small pixel prop on the desk for the analyst's specialty.
  drawDeskProp(g, specialty, x, y) {
    const R = (dx, dy, w, h, c) => { g.fillStyle = c; g.fillRect(x + dx, y + dy, w, h); };
    const ink = "#0b1a14";
    switch (specialty) {
      case "form": R(-1, -9, 12, 10, ink); R(0, -8, 10, 8, "#e6fff2"); R(1, -3, 2, 2, "#3ddc84"); R(4, -5, 2, 4, "#3ddc84"); R(7, -7, 2, 6, "#3ddc84"); break;
      case "lineups": R(0, -10, 9, 11, ink); R(1, -9, 7, 9, "#f2e6c8"); R(3, -11, 3, 2, "#9aa0a6"); R(2, -7, 5, 1, "#5a6b62"); R(2, -5, 5, 1, "#5a6b62"); R(2, -3, 3, 1, "#f78c6b"); break;
      case "weather": R(0, -8, 12, 7, ink); R(1, -7, 10, 5, "#06221a"); R(2, -6, 8, 1, "#3ddc84"); R(4, -5, 4, 2, "#9fd8ff"); R(5, -9, 2, 2, "#ffd166"); break;
      case "odds": R(-1, -8, 13, 8, ink); R(0, -7, 11, 6, "#04140f"); R(1, -6, 3, 1, "#7ee081"); R(5, -6, 3, 1, "#f78c6b"); R(1, -3, 4, 1, "#ffd166"); R(6, -3, 3, 1, "#7ee081"); break;
      case "set_pieces": R(0, -9, 11, 9, ink); R(1, -8, 9, 7, "#1f7a4f"); R(5, -8, 1, 7, "#e6fff2"); R(2, -6, 1, 1, "#ffffff"); R(8, -4, 1, 1, "#f2c14e"); break;
      case "discipline": R(0, -9, 5, 8, ink); R(1, -8, 3, 6, "#ffd166"); R(4, -8, 5, 8, ink); R(5, -7, 3, 6, "#e5484d"); break;
      case "scorers": R(1, -8, 7, 7, ink); R(2, -7, 5, 5, "#ffffff"); R(4, -6, 1, 1, ink); R(3, -4, 1, 1, ink); R(5, -4, 1, 1, ink); break;
      default: break;
    }
  }

  drawEmptyChair(g, d) {
    const s = this.sprite("sprites", "chair");
    if (!s) return;
    const [sx, sy] = iso(...this.seatOf(d));
    g.globalAlpha = 0.9;
    g.drawImage(s.img, Math.round(sx - s.m.w / 2), Math.round(sy - s.m.h + 2));
    g.globalAlpha = 1;
  }

  // "+ HIRE" sign floating over an empty desk.
  drawHireMarker(g, d) {
    const [sx, sy] = iso(...this.seatOf(d));
    const bob = Math.round(Math.sin(this.t * 2.6 + d.slot) * 2), hot = this.hoverDesk === d.slot;
    const x = Math.round(sx - 19), y = Math.round(sy - 54 + bob);
    g.fillStyle = "#04140f"; g.fillRect(x - 1, y - 1, 40, 14);
    g.fillStyle = hot ? "#3ddc84" : "#0f3d2d"; g.fillRect(x, y, 38, 12);
    g.font = '6px "Press Start 2P", monospace'; g.textBaseline = "top";
    g.fillStyle = hot ? "#04140f" : "#7ee081"; g.fillText("+ HIRE", x + 3, y + 3);
    g.fillStyle = "#04140f"; g.fillRect(x + 17, y + 12, 4, 3);
  }

  drawProp(g, name, x, y) {
    const s = this.sprite("sprites", name);
    if (!s) return;
    const [fx] = iso(x, y), base = iso(x + 0.3, y + 0.3)[1];
    g.drawImage(s.img, Math.round(fx - s.m.w / 2), Math.round(base - s.m.h + 1));
  }

  drawSteam(g, x, y) {
    const s = this.sprite("sprites", "coffee");
    if (!s) return;
    const [fx] = iso(x, y), base = iso(x + 0.3, y + 0.3)[1];
    const ex = Math.round(fx - s.m.w * 0.12), ey = Math.round(base - s.m.h + 4);
    for (let i = 0; i < 8; i++) {
      const k = (this.t * 0.4 + i / 8) % 1;
      const px = Math.round(ex + Math.sin(k * 6 + i * 1.7) * 3 + k * 3), py = Math.round(ey - k * 26), size = k < 0.3 ? 2 : 3;
      g.fillStyle = `rgba(236,255,246,${(0.75 * (1 - k) ** 0.8).toFixed(3)})`;
      g.fillRect(px, py, size, size);
      if (k > 0.45) g.fillRect(px + size, py + 1, 2, 2);
    }
  }

  // ---------------------------------------------------------------- people
  ceoArt() {
    const m = this.art?.manifest.ceo?.[this.ceoArchetype] || this.art?.manifest.ceo?.hybrid;
    if (!m) return null;
    for (const f of [m.file, m.portrait]) {
      if (!f || this.art.images[f] || this.art.loading.has(f)) continue;
      this.art.loading.add(f);
      const img = new Image();
      img.onload = () => { this.art.images[f] = img; };
      img.src = this.art.urlOf(f);
    }
    const img = this.art.images[m.file];
    return img ? { m, img } : null;
  }

  frameOf(p) {
    if (p.walking) return 3;
    if (this.isHappy(p)) return 2;
    if (p.state === "working") return Math.floor(this.t * 3 + p.phase) % 4 === 0 ? 0 : 1;
    p.fidgetAt ??= this.t + 2 + ((p.phase * 7) % 6);
    if (this.t > p.fidgetAt + 1.1) p.fidgetAt = this.t + 4 + Math.random() * 8;
    if (this.t > p.fidgetAt) return Math.floor(this.t * 6) % 2 ? 1 : 0;
    return 0;
  }

  drawPerson(g, p) {
    const [fx, fy] = iso(p.x, p.y);
    if (p.isCeo) {
      const ceo = this.ceoArt();
      if (!ceo) return;
      const { m, img } = ceo, s = m.scale || 1, [fw, fh] = m.frame, walkFrames = m.poses.length - 2;
      let frame = 0;
      if (p.walking) frame = 2 + (Math.floor(this.t * 10) % walkFrames);
      else {
        p.fidgetAt ??= this.t + 3;
        if (this.t > p.fidgetAt + 1.4) p.fidgetAt = this.t + 5 + Math.random() * 7;
        if (this.t > p.fidgetAt) frame = 1;
      }
      const hop = !p.walking && this.isHappy(p) ? Math.floor((this.t - (p.celebrateFrom ?? p.stateAt)) * 7) % 2 * 2 : 0;
      const breath = !p.walking && Math.sin(this.t * 1.7 + p.phase) > 0.2 ? 0.5 : 0;
      const w = fw * s, h = fh * s, x = Math.round(fx - w / 2), y = Math.round(fy - h + 1 - hop);
      g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.ellipse(fx, fy, w * 0.32, 3, 0, 0, Math.PI * 2); g.fill();
      g.save();
      if (p.walking && (m.walkFaces === "right" ? p.facing < 0 : p.facing > 0)) { g.translate(Math.round(fx) * 2, 0); g.scale(-1, 1); }
      g.drawImage(img, frame * fw, 0, fw, fh, x, y, w, h);
      if (breath) { const split = Math.round(fh * 0.55); g.drawImage(img, frame * fw, 0, fw, split, x, y - breath, w, split * s); }
      g.restore();
      return;
    }
    const c = this.art.manifest.characters?.[p.look], img = c && this.art.images[c.file];
    if (!img) return;
    const [fw, fh] = c.frame, frame = this.frameOf(p);
    if (frame >= 2) { g.fillStyle = "rgba(0,0,0,0.28)"; g.beginPath(); g.ellipse(fx, fy, fw * 0.3, 3, 0, 0, Math.PI * 2); g.fill(); }
    const bob = p.walking ? Math.floor(this.t * 8) % 2 : 0;
    const hop = frame === 2 ? Math.floor((this.t - (p.celebrateFrom ?? p.stateAt)) * 7) % 2 : 0;
    const breath = !p.walking && Math.sin(this.t * (1.9 + (p.phase % 0.6)) + p.phase) > 0.2 ? 0.5 : 0;
    const x = Math.round(fx - fw / 2), y = Math.round(fy - fh + 1 - bob - hop), split = Math.round(fh * 0.58);
    g.drawImage(img, frame * fw, 0, fw, fh, x, y, fw, fh);
    if (breath) g.drawImage(img, frame * fw, 0, fw, split, x, y - breath, fw, split);
  }

  // Head-and-shoulders crop of a look (for cards and lists).
  portraitOf(look) {
    const c = this.art?.manifest.characters?.[look], img = c && this.art.images[c.file];
    if (!img) return null;
    const [fw, fh] = c.frame, probe = document.createElement("canvas");
    probe.width = fw; probe.height = fh;
    const pg = probe.getContext("2d");
    pg.drawImage(img, 0, 0, fw, fh, 0, 0, fw, fh);
    const alpha = pg.getImageData(0, 0, fw, fh).data;
    let top = 0;
    while (top < fh && ![...Array(fw).keys()].some((x) => alpha[(top * fw + x) * 4 + 3] > 0)) top++;
    const size = Math.round(fw * 0.82), out = document.createElement("canvas");
    out.width = size; out.height = size;
    const og = out.getContext("2d");
    og.imageSmoothingEnabled = false;
    og.drawImage(img, Math.round((fw - size) / 2), top, size, size, 0, 0, size, size);
    return out;
  }
  lookFor(id) { return LOOKS[hash(id) % LOOKS.length]; }

  drawStatusIcons(g) {
    for (const p of this.people.values()) {
      const [ax, ay] = this.anchor(p).map(Math.round), age = this.t - p.stateAt;
      if (p.state === "working") {
        for (let i = 0; i < 3; i += 1) { g.fillStyle = Math.floor(this.t * 4) % 4 > i ? "#ffffff" : "rgba(255,255,255,0.3)"; g.fillRect(ax - 5 + i * 4, ay - 4, 2, 2); }
      } else if ((p.state === "done" && age < 5) || p.state === "error") {
        const ic = this.sprite("icons", p.state);
        if (!ic) continue;
        const w = 20, h = Math.round((ic.m.h / ic.m.w) * w), lift = p.state === "done" ? Math.min(6, age * 12) : 0;
        g.drawImage(ic.img, Math.round(ax - w / 2), Math.round(ay - h - lift), w, h);
      } else if (p.state === "gut") { // the CEO rolls the dice on uncovered markets
        const spin = Math.floor(this.t * 8) % 4, x = ax - 6, y = ay - 16;
        g.fillStyle = "#04140f"; g.fillRect(x - 1, y - 1, 14, 14);
        g.fillStyle = "#ffffff"; g.fillRect(x, y, 12, 12);
        g.fillStyle = "#04140f";
        const dots = [[[5, 5]], [[2, 2], [8, 8]], [[2, 2], [5, 5], [8, 8]], [[2, 2], [8, 2], [2, 8], [8, 8]]][spin];
        for (const [dx, dy] of dots) g.fillRect(x + dx, y + dy, 2, 2);
      }
    }
  }

  drawParticles(g) {
    for (const q of this.particles) {
      const k = (this.t - q.t0) / q.dur;
      if (q.kind === "packet") {
        const x = q.sx + (q.tx - q.sx) * k, y = q.sy + (q.ty - q.sy) * k - Math.sin(k * Math.PI) * 40;
        g.fillStyle = q.color; g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
        g.fillStyle = "rgba(255,255,255,0.7)"; g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 1, 1);
      } else {
        const tt = this.t - q.t0, x = q.x + q.vx * tt, y = q.y + q.vy * tt + 60 * tt * tt;
        g.fillStyle = q.color; g.fillRect(Math.round(x), Math.round(y), 2, Math.floor(tt * 10) % 2 ? 2 : 1);
      }
    }
  }
}
