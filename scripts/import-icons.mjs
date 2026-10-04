// Imports the Kult Sports icon sheet (a 3x3 ChatGPT sheet, see README) into
// public/art/icon-*.png and adds them to manifest.json as `sportsIcons`.
//
//   node scripts/import-icons.mjs "C:/path/to/sports-ui.png"
//
// Each icon is the biggest shape in its cell (plus small loose bits inside
// its bounds), scaled to 48 px and given crisp alpha.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPng, writePng, blank } from "./png.mjs";

const ART = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "art");
const ORDER = ["office", "matches", "talent", "history", "leaders", "agency", "emblem", "whistle", "stopwatch"];
const SIZE = 48;
const src = process.argv[2];
if (!src) { console.error("usage: node scripts/import-icons.mjs <sports-ui.png>"); process.exit(1); }

const img = readPng(src);
const { width: W, height: H } = img;
const at = (x, y) => (y * W + x) * 4;
// Transparent sheets keep glow colours at alpha ~0: drop the haze.
for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 60) img.data[i] = 0;

// 8-connected shapes.
const label = new Int32Array(W * H).fill(-1), comps = [];
for (let s = 0; s < W * H; s++) {
  if (label[s] !== -1 || img.data[s * 4 + 3] === 0) continue;
  const id = comps.length, stack = [s], pix = [];
  label[s] = id;
  let minx = W, maxx = 0, miny = H, maxy = 0;
  while (stack.length) {
    const k = stack.pop(), x = k % W, y = (k - x) / W;
    pix.push(k);
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, nk = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || label[nk] !== -1 || img.data[nk * 4 + 3] === 0) continue;
      label[nk] = id; stack.push(nk);
    }
  }
  comps.push({ pix, minx, maxx, miny, maxy, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 });
}

function resize(im, w, h) {
  const out = blank(w, h), sx = im.width / w, sy = im.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = Math.floor(y * sy); yy < Math.min(im.height, Math.ceil((y + 1) * sy)); yy++) {
      for (let xx = Math.floor(x * sx); xx < Math.min(im.width, Math.ceil((x + 1) * sx)); xx++) {
        const o = (yy * im.width + xx) * 4, al = im.data[o + 3] / 255;
        r += im.data[o] * al; g += im.data[o + 1] * al; b += im.data[o + 2] * al; a += al; n++;
      }
    }
    const o = (y * w + x) * 4;
    if (a > 0) { out.data[o] = r / a; out.data[o + 1] = g / a; out.data[o + 2] = b / a; }
    out.data[o + 3] = a / n >= 0.47 ? 255 : 0; // crisp pixel edges
  }
  return out;
}

const manifestPath = join(ART, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.sportsIcons = {};
const cw = W / 3, ch = H / 3;
ORDER.forEach((name, i) => {
  const col = i % 3, row = Math.floor(i / 3);
  const main = comps.filter((c) => c.cx >= col * cw && c.cx < (col + 1) * cw && c.cy >= row * ch && c.cy < (row + 1) * ch).sort((a, b) => b.pix.length - a.pix.length)[0];
  if (!main) { console.warn(`no icon found for ${name}`); return; }
  const parts = comps.filter((c) => c === main || (c.pix.length < main.pix.length * 0.2 && c.cx >= col * cw && c.cx < (col + 1) * cw && c.cy >= row * ch && c.cy < (row + 1) * ch && c.pix.length > 30));
  const x0 = Math.min(...parts.map((p) => p.minx)), y0 = Math.min(...parts.map((p) => p.miny));
  const w0 = Math.max(...parts.map((p) => p.maxx)) - x0 + 1, h0 = Math.max(...parts.map((p) => p.maxy)) - y0 + 1;
  const obj = blank(w0, h0);
  for (const p of parts) for (const k of p.pix) { const x = k % W, y = (k - x) / W; img.data.copy(obj.data, ((y - y0) * w0 + (x - x0)) * 4, k * 4, k * 4 + 4); }
  const s = SIZE / Math.max(w0, h0), w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const file = `icon-${name}.png`;
  writePng(join(ART, file), resize(obj, w, h));
  manifest.sportsIcons[name] = { file, w, h };
  console.log(`${file} ${w}x${h}`);
});

const hsh = createHash("sha1").update(manifest.rev || "");
for (const v of Object.values(manifest.sportsIcons)) hsh.update(readFileSync(join(ART, v.file)));
manifest.rev = hsh.digest("hex").slice(0, 10);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log("manifest rev", manifest.rev);
