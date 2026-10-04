// Recolours the shared office art (from Kult Create) for Kult Sports:
// the violet room becomes deep pitch green, and the CEO rug is painted as a
// small football pitch. Run once after copying the art:
//
//   node scripts/recolor.mjs
//
// Idempotent: it reads the original Kult Create files from art-source/ the
// first time it runs and always writes art/*.png from those.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPng, writePng } from "./png.mjs";

const ART = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "art");
const SOURCE = join(ART, "..", "..", "art-source"); // the untouched Kult Create originals
mkdirSync(SOURCE, { recursive: true });

const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const hslToRgb = (h, s, l) => {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
};

// Violet / indigo (hue 215-300) -> emerald / teal, slightly less saturated.
function recolor(img) {
  for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    const [h, s, l] = rgbToHsl(img.data[i], img.data[i + 1], img.data[i + 2]);
    if (h < 215 || h > 300 || s < 0.12) continue;
    const [r, g, b] = hslToRgb(h - 95, s * 0.85, l);
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
  }
  return img;
}

for (const file of ["office.png", "furniture-podium.png", "furniture-coffee.png", "furniture-chair.png"]) {
  const src = join(SOURCE, file);
  if (!existsSync(src)) copyFileSync(join(ART, file), src);
  writePng(join(ART, file), recolor(readPng(src)));
  console.log("recoloured", file);
}

// New revision so browsers fetch the recoloured files.
const manifestPath = join(ART, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const h = createHash("sha1").update("kult-sports");
for (const f of ["office.png", "furniture-podium.png", "furniture-coffee.png", "furniture-chair.png"]) h.update(readFileSync(join(ART, f)));
manifest.rev = h.digest("hex").slice(0, 10);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log("manifest rev", manifest.rev);
