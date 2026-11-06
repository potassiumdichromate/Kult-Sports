// The Kult Sports office: a glowing 3D isometric football analysis agency
// (see office3d.js for the scene, shared with Kult Create). The CEO (the
// player's own agent model) stands on a pitch rug in front of the match
// screen. The number of desks follows the agency's level (3 to 7), one analyst
// sits at each staffed desk, and empty desks invite a hire.
import * as THREE from "three";
import { OfficeScene, M, FONT, box, canvasTex, LOOKS, hash } from "./office3d.js";

// Desk centres (grid). The first three fill the front row; more desks appear
// as the agency levels up.
const SLOTS = [[4.6, 8.8], [7.0, 8.8], [9.8, 8.8], [4.6, 4.8], [7.4, 4.8], [2.2, 8.8], [12.2, 8.8]];
const LAYOUT = { aisles: [1.7, 6.6, 10.4], corridorX: 13.55, ceoHome: [6.75, 1.95] };
const seatOf = (d) => [d.x - 0.75, d.y - 0.8];

// One look per analyst, picked from the ten staff looks.
const LOOK_NAMES = Object.keys(LOOKS);
export const SPECIALTY_COLORS = { form: "#a78bfa", lineups: "#5ec8f2", weather: "#9fd8ff", odds: "#f2c14e", set_pieces: "#ff9f5a", discipline: "#f78c6b", scorers: "#c792ea" };

const THEME = {
  bg: "#060b1a", slab: "#0c1530", edge: "#3b8bff", accents: ["#3b8bff", "#ffd166"],
  floor: ["#6b4a3a", "#74513f", "#7a5644", "#664535"],
  wall: "#1c2f66", wallDark: "#0c1533", wallTop: "#4f8dff", trim: "#7cc4ff",
  sky: ["#0c1a3a", "#22346e"], cityLights: ["#ffd166", "#fff1b8", "#a78bfa", "#5ec8f2"],
  screenLight: "#3b8bff", neon: [["KULT", "#3b8bff"], ["SPORTS", "#ffd166"]],
  rug: "#1e3f8f", rugInner: "#2a4fa8", rugEdge: "#7cc4ff",
  desk: "#e8f2ee", deskPanel: "#1b2a52", chair: "#26346b", counter: "#1f2c57",
  key: "#ffd9b0", fill: ["#a8c8ff", "#0a1430"], rim: "#7ef0ff",
  confetti: ["#4fd8ff", "#f2c14e", "#5ec8f2", "#ffffff", "#3b8bff", "#f78c6b"],
  models: "models/"
};

// "+ HIRE" tags over empty desks, plain and hovered.
const hireTex = (hot) => canvasTex(256, 96, (g, W, H) => {
  g.fillStyle = hot ? "#3b8bff" : "rgba(8, 16, 40, 0.88)"; g.strokeStyle = "#7cc4ff"; g.lineWidth = 5;
  g.shadowColor = "#3b8bff"; g.shadowBlur = hot ? 24 : 12;
  g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 40); g.fill(); g.stroke(); g.shadowBlur = 0;
  g.font = `700 44px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = hot ? "#050b1f" : "#bcd8ff";
  g.fillText("+ HIRE", W / 2, H / 2 + 2);
});

export class Office extends OfficeScene {
  constructor(canvas) {
    super(canvas, THEME, LAYOUT);
    this.desks = [];                 // [{ slot, x, y, analystId|null, view }]
    this.deskViews = [];
    this.hoverDesk = -1;
    this.hireTex = [hireTex(false), hireTex(true)];
    this.addPodium(5.5, 1.3);
    this.addPlant(0.7, 11.3); this.addPlant(13.3, 0.7); this.addPlant(0.7, 4.3, 0.8);
    this.addCooler(0.6, 0.6);
    this.addCoffee(13.0, 10.8);
    this.addTrophyCase(0.45, 7.95);
  }

  // The CEO rug as a little pitch: mowing stripes, touchlines, halfway line, centre circle, boxes.
  paintRug(g, W, H) {
    for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? "#1e3f8f" : "#22489e"; g.fillRect((i * W) / 10, 0, W / 10 + 1, H); }
    g.strokeStyle = "rgba(240, 255, 246, 0.95)"; g.lineWidth = 6; g.shadowColor = "#ffffff"; g.shadowBlur = 8;
    const m = 24;
    g.strokeRect(m, m, W - m * 2, H - m * 2);
    g.beginPath(); g.moveTo(W / 2, m); g.lineTo(W / 2, H - m); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, H * 0.17, 0, Math.PI * 2); g.stroke();
    g.strokeRect(m, H * 0.28, W * 0.14, H * 0.44); g.strokeRect(W - m - W * 0.14, H * 0.28, W * 0.14, H * 0.44);
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(W / 2, H / 2, 6, 0, Math.PI * 2); g.fill();
  }

  // ---------------------------------------------------------------- agency
  // ceo: { name, archetype }; staff: Analyst[]; desks: number of desks.
  setAgency({ ceo, staff = [], desks = 3 }) {
    const n = Math.max(0, Math.min(7, desks));
    if (n !== this.desks.length) this.buildDesks(n);
    for (const d of this.desks) d.analystId = null;
    const used = new Set(), keep = new Set(["ceo"]);
    staff.slice(0, this.desks.length).forEach((a, i) => {
      // A stable, distinct look per analyst.
      let k = hash(a.id) % LOOK_NAMES.length;
      while (used.has(LOOK_NAMES[k]) && used.size < LOOK_NAMES.length) k = (k + 1) % LOOK_NAMES.length;
      used.add(LOOK_NAMES[k]);
      const d = this.desks[i], seat = seatOf(d), prev = this.people.get(a.id);
      d.analystId = a.id; keep.add(a.id);
      if (prev && prev.desk === d && prev.look === LOOK_NAMES[k]) { Object.assign(prev, a); return; }
      if (prev) this.unembody(prev);
      const p = {
        ...a, look: LOOK_NAMES[k], isCeo: false, desk: d, seat, x: seat[0], y: seat[1], path: [], walking: false, facing: 1,
        state: prev?.state || "idle", stateAt: prev?.stateAt || 0, phase: (hash(a.id) % 100) / 100 * Math.PI * 2
      };
      this.people.set(a.id, p);
      this.embody(p);
    });
    for (const [id, p] of this.people) if (!keep.has(id)) { this.unembody(p); this.people.delete(id); }
    for (const d of this.desks) this.dressDesk(d);
    const arch = String(ceo?.archetype || "hybrid").toLowerCase(), prevCeo = this.people.get("ceo");
    if (prevCeo && this.ceoArchetype === arch) { prevCeo.name = ceo?.name || "CEO"; return; }
    this.ceoArchetype = arch;
    if (prevCeo) this.unembody(prevCeo);
    const c = {
      id: "ceo", name: ceo?.name || "CEO", isCeo: true, desk: null,
      x: prevCeo?.x ?? LAYOUT.ceoHome[0], y: prevCeo?.y ?? LAYOUT.ceoHome[1], path: prevCeo?.path || [], walking: false, facing: 1,
      state: prevCeo?.state || "idle", stateAt: prevCeo?.stateAt || 0, phase: 1.3
    };
    this.people.set("ceo", c);
    this.embody(c);
  }

  buildDesks(n) {
    for (const d of this.desks) { this.scene.remove(d.view.group, d.view.chair, d.props, d.hire, d.hitBox); }
    this.desks = SLOTS.slice(0, n).map(([x, y], slot) => {
      const d = { slot, x, y, analystId: null };
      d.view = this.addDesk(x, y, { ledColor: "#2a3f7a", seat: seatOf(d) });
      d.props = new THREE.Group(); this.scene.add(d.props);
      d.hire = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hireTex[0], transparent: true, depthTest: false }));
      d.hire.scale.set(0.95, 0.36, 1); d.hire.renderOrder = 10; this.scene.add(d.hire);
      d.hitBox = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2), M.hidden()); d.hitBox.position.set(x - 0.2, 0.8, y - 0.4); d.hitBox.userData.desk = d; this.scene.add(d.hitBox);
      return d;
    });
    this.deskViews = this.desks.map((d) => ({ screen: d.view.screen, person: () => d.analystId && this.people.get(d.analystId) }));
  }

  // The LED strip takes the analyst's specialty colour; a prop shows the specialty.
  dressDesk(d) {
    const p = d.analystId && this.people.get(d.analystId), color = p ? SPECIALTY_COLORS[p.specialty] || "#3b8bff" : "#2a3f7a";
    if (d.dressed === `${d.analystId}|${p?.specialty}`) return;
    d.dressed = `${d.analystId}|${p?.specialty}`;
    d.view.led.material = M.glow(color, p ? 2.6 : 1.2);
    d.view.glow.material.color.set(color);
    d.props.clear();
    d.hire.visible = !p;
    if (p) this.deskProp(d, p.specialty, color);
  }

  // A small prop on the desk for the analyst's specialty.
  deskProp(d, specialty, color) {
    const g = d.props; g.position.set(d.x + 0.45, 0.77, d.y + 0.05);
    const tablet = (w, h, draw, tilt = -0.9) => {
      const t = new THREE.Group(); t.rotation.x = tilt;
      t.add(box(w + 0.03, h + 0.03, 0.02, M.std("#0b1226", { roughness: 0.3 }), 0, 0, 0));
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(256, Math.round(256 * h / w), draw), color: new THREE.Color(1.3, 1.3, 1.3) }));
      s.position.z = 0.012; t.add(s); t.position.y = h / 2 * Math.sin(-tilt) + 0.02; g.add(t);
    };
    switch (specialty) {
      case "form": tablet(0.36, 0.26, (c, W, H) => { c.fillStyle = "#eef4ff"; c.fillRect(0, 0, W, H); c.fillStyle = "#3b8bff"; [0.3, 0.55, 0.45, 0.8, 0.65].forEach((v, i) => c.fillRect(20 + i * 46, H - 14 - v * (H - 40), 30, v * (H - 40))); }); break;
      case "lineups": { const clip = box(0.24, 0.015, 0.32, M.std("#f2e6c8"), 0, 0.01, 0); g.add(clip, box(0.08, 0.02, 0.03, M.metal("#9aa0a6"), 0, 0.02, -0.15)); for (let i = 0; i < 4; i++) g.add(box(0.16, 0.003, 0.012, M.std(i === 3 ? "#f78c6b" : "#5a6b62"), 0, 0.02, -0.08 + i * 0.05)); break; }
      case "weather": tablet(0.34, 0.24, (c, W, H) => { c.fillStyle = "#0a1838"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffd166"; c.beginPath(); c.arc(W * 0.35, H * 0.45, 40, 0, Math.PI * 2); c.fill(); c.fillStyle = "#9fd8ff"; c.beginPath(); c.roundRect(W * 0.38, H * 0.45, 110, 50, 25); c.fill(); }); break;
      case "odds": tablet(0.38, 0.22, (c, W, H) => { c.fillStyle = "#050b1f"; c.fillRect(0, 0, W, H); c.font = `700 30px ${FONT}`; [["1", "2.10", "#4fd8ff"], ["X", "3.40", "#ffd166"], ["2", "3.05", "#f78c6b"]].forEach(([k, v, col], i) => { c.fillStyle = "#9fb8e6"; c.fillText(k, 18, 40 + i * 44); c.fillStyle = col; c.fillText(v, 70, 40 + i * 44); }); }); break;
      case "set_pieces": tablet(0.36, 0.26, (c, W, H) => { c.fillStyle = "#1e3f8f"; c.fillRect(0, 0, W, H); c.strokeStyle = "#eef4ff"; c.lineWidth = 5; c.strokeRect(10, 10, W - 20, H - 20); c.beginPath(); c.moveTo(W / 2, 10); c.lineTo(W / 2, H - 10); c.stroke(); c.strokeStyle = "#f2c14e"; c.setLineDash([12, 8]); c.beginPath(); c.moveTo(30, H - 30); c.quadraticCurveTo(W / 2, 20, W - 50, H / 2); c.stroke(); }, -1.2); break;
      case "discipline": { const y = box(0.1, 0.004, 0.14, M.glow("#ffd166", 1.2), -0.06, 0.01, 0); y.rotation.y = 0.2; const r = box(0.1, 0.004, 0.14, M.glow("#e5484d", 1.2), 0.07, 0.014, 0.02); r.rotation.y = -0.15; g.add(y, r); break; }
      case "scorers": { const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 1), M.std("#ffffff", { flatShading: true })); ball.position.y = 0.09; g.add(ball); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.01, 6, 20), M.std("#0b1226")); ring.rotation.x = Math.PI / 2; ring.position.y = 0.005; g.add(ring); break; }
      default: break;
    }
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.12, 14), M.std(color)); mug.position.set(0.32, 0.06, -0.15); g.add(mug);
  }

  // A glass trophy cabinet against the left wall.
  addTrophyCase(x, y) {
    const g = new THREE.Group(); g.position.set(x, 0, y); this.scene.add(g);
    g.add(box(0.5, 1.8, 1.0, M.std("#16224a", { roughness: 0.4, metalness: 0.3 }), 0, 0.9, 0));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.5), new THREE.MeshStandardMaterial({ color: "#a8c8ff", transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.5 }));
    glass.rotation.y = Math.PI / 2; glass.position.set(0.26, 0.98, 0); g.add(glass);
    for (const h of [0.55, 1.05, 1.5]) g.add(box(0.44, 0.03, 0.94, M.std("#0b1226"), 0, h, 0));
    const gold = M.std("#f2c14e", { metalness: 0.85, roughness: 0.25, emissive: "#8a5a00", emissiveIntensity: 0.9 });
    for (const [h, z, s] of [[0.57, -0.25, 1], [0.57, 0.22, 0.8], [1.07, 0, 1.25], [1.52, -0.2, 0.9]]) {
      const cup = new THREE.Group(); cup.position.set(0, h, z); cup.scale.setScalar(s);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.04, 0.14, 14), gold); bowl.position.y = 0.17; cup.add(bowl);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8), gold); stem.position.y = 0.07; cup.add(stem);
      cup.add(box(0.1, 0.03, 0.1, M.std("#2a1a10"), 0, 0.015, 0)); g.add(cup);
    }
    g.add(box(0.03, 1.6, 0.03, M.glow("#ffd166", 2.2), 0.26, 0.95, -0.49), box(0.03, 1.6, 0.03, M.glow("#ffd166", 2.2), 0.26, 0.95, 0.49));
  }

  // ---------------------------------------------------------------- people
  person(id) { return this.people.get(id); }
  setState(id, state) { const p = this.people.get(id); if (p) { p.state = state; p.stateAt = this.t; } }
  setAll(state) { for (const p of this.people.values()) if (!p.isCeo) { p.state = state; p.stateAt = this.t; } }

  // The CEO walks to stand in front of an analyst's desk, then goes back.
  visit(id, back = true) {
    const ceo = this.people.get("ceo"), target = this.people.get(id);
    if (!ceo || !target || target.isCeo) return;
    ceo.lookAt = null;
    this.walkTo(ceo, [target.desk.x - 0.4, target.desk.y + 1.0], () => {
      ceo.lookAt = [target.seat[0], target.seat[1]];
      if (back) setTimeout(() => this.home(), 1400);
    });
  }
  home() { const ceo = this.people.get("ceo"); if (ceo) { ceo.lookAt = null; this.walkTo(ceo, LAYOUT.ceoHome); } }
  lookFor(id) { return LOOK_NAMES[hash(id) % LOOK_NAMES.length]; }

  // The CEO rolls the dice on uncovered markets.
  iconFor(p) { return p.state === "gut" ? `dice${Math.floor(this.t * 8) % 4}` : super.iconFor(p); }

  // An empty desk under the pointer (its slot index), or -1.
  hitDesk(x, y) {
    const hits = this.pick(x, y, this.desks.filter((d) => !d.analystId).map((d) => d.hitBox));
    return hits[0]?.object.userData.desk.slot ?? -1;
  }

  update(dt) {
    super.update(dt);
    for (const d of this.desks) {
      if (!d.hire.visible) continue;
      const [sx, sy] = seatOf(d);
      d.hire.position.set(sx, 1.45 + Math.sin(this.t * 2.6 + d.slot) * 0.05, sy);
      d.hire.material.map = this.hireTex[this.hoverDesk === d.slot ? 1 : 0];
    }
  }

  // ---------------------------------------------------------------- the big screen
  // Next match, analysis in progress, or the CEO's picks.
  paintScreen() {
    const c = this.screenCanvas, s = c.getContext("2d"), S = this.screen, CW = 156, CH = 66;
    s.setTransform(c.width / CW, 0, 0, c.height / CH, 0, 0);
    const bg = s.createLinearGradient(0, 0, 0, CH); bg.addColorStop(0, "#0a1a44"); bg.addColorStop(1, "#060b1f");
    s.fillStyle = bg; s.fillRect(0, 0, CW, CH);
    s.textBaseline = "top";
    const text = (str, x, y, color, size = 6.5, weight = 600) => { s.font = `${weight} ${size}px ${FONT}`; s.fillStyle = color; s.fillText(String(str).toUpperCase(), x, y); };
    const fit = (str, n) => (str.length > n ? `${str.slice(0, n - 1)}.` : str);
    if (S.mode === "work") {
      text("DESK ANALYSIS", 5, 4, "#ffd166", 8, 700);
      text(fit(S.title || "", 30), 5, 16, "#eef4ff", 7);
      (S.lines || []).slice(-3).forEach((l, i) => text(fit(l, 32), 5, 27 + i * 8, "#9fb8e6", 6));
      s.fillStyle = "#132a5c"; s.beginPath(); s.roundRect(5, 56, 146, 5, 2.5); s.fill();
      s.fillStyle = "#3b8bff"; s.beginPath(); s.roundRect(5, 56, Math.max(5, Math.round(146 * ((this.t * 0.35) % 1))), 5, 2.5); s.fill();
    } else if (S.mode === "picks") {
      text(S.locked ? "LOCKED IN" : "CEO'S PICKS", 5, 4, S.locked ? "#4fd8ff" : "#ffd166", 8, 700);
      text(fit(S.title || "", 30), 5, 16, "#eef4ff", 7);
      (S.lines || []).slice(0, 4).forEach((l, i) => text(fit(l, 32), 5, 27 + i * 8, "#eef4ff", 6));
    } else if (S.mode === "result") {
      text("FULL TIME", 5, 4, "#5ec8f2", 8, 700);
      text(fit(S.title || "", 30), 5, 16, "#eef4ff", 7);
      text(S.big || "", 5, 28, "#4fd8ff", 15, 700);
      (S.lines || []).slice(0, 1).forEach((l) => text(fit(l, 32), 5, 52, "#ffd166", 6));
    } else {
      text("KULT SPORTS", 5, 4, "#3b8bff", 11, 700);
      if (S.title) {
        text("NEXT MATCH", 5, 19, "#9fb8e6", 6);
        text(fit(S.title, 28), 5, 28, "#eef4ff", 8, 700);
        text(fit(S.sub || "", 34), 5, 40, "#ffd166", 6);
        text(Math.floor(this.t * 1.5) % 2 ? "READY FOR ANALYSIS_" : "READY FOR ANALYSIS", 5, 52, "#5ec8f2", 6);
      } else {
        text(Math.floor(this.t * 1.5) % 2 ? "NO MATCHES RIGHT NOW_" : "NO MATCHES RIGHT NOW", 5, 30, "#9fb8e6", 7);
      }
    }
    s.fillStyle = "rgba(0,0,0,0.14)";
    for (let y = 0; y < CH; y += 1.5) s.fillRect(0, y, CW, 0.4);
  }
}
