// Reference TPI statistics (mean/σ of the 150 m and 750 m neighbourhood relief) measured on the Bankhead DEM.
// Smaller areas (the private club box) are standardized against these so "1.6 σ above its surroundings" means the
// same number of metres everywhere instead of being relative to whatever box happens to be analysed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fromArrayBuffer } from 'geotiff';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CACHE = path.join(ROOT, 'research', 'raw', 'tpi-ref.json');

function boxMean(src, W, H, r) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += src[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      out[y * W + x] = (I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}
const stats = (a) => { let s = 0, s2 = 0; for (const v of a) { s += v; s2 += v * v; } const m = s / a.length; return { mean: m, sd: Math.sqrt(s2 / a.length - m * m) }; };

export async function tpiReference() {
  try { return JSON.parse(await fs.readFile(CACHE, 'utf8')); } catch { /* compute below */ }
  const buf = await fs.readFile(path.join(ROOT, 'research', 'raw', 'dem_1arcsec.tif'));
  const img = await (await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).getImage();
  const W = img.getWidth(), H = img.getHeight();
  const [r] = await img.readRasters();
  const z = Float32Array.from(r);
  let s = 0, n = 0;
  for (const v of z) if (v > -1000) { s += v; n++; }
  const fill = s / n;
  for (let i = 0; i < z.length; i++) if (!(z[i] > -1000)) z[i] = fill;
  const mS = boxMean(z, W, H, 5), mL = boxMean(z, W, H, 25);
  const tS = new Float32Array(z.length), tL = new Float32Array(z.length);
  for (let i = 0; i < z.length; i++) { tS[i] = z[i] - mS[i]; tL[i] = z[i] - mL[i]; }
  const out = { small: stats(tS), large: stats(tL), source: 'research/raw/dem_1arcsec.tif (Bankhead study area)' };
  await fs.writeFile(CACHE, JSON.stringify(out, null, 1));
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(await tpiReference());
