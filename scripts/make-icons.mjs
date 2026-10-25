// Rasterizes the app icon (simple polygon fill) to PNG for iOS / PWA manifests.
import { PNG } from 'pngjs';
import fs from 'node:fs';
const polys = [[[8, 50], [26, 18], [36, 34], [42, 26], [56, 50]], [[26, 18], [31, 27], [27, 25], [23, 29]]];
const colors = [[217, 164, 65], [243, 226, 181]];
const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
for (const size of [192, 512]) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = ((x + 0.5) / size) * 64, v = ((y + 0.5) / size) * 64;
    let col = [14, 20, 16];
    polys.forEach((p, k) => { if (inside(p, u, v)) col = colors[k]; });
    png.data.set([...col, 255], (y * size + x) * 4);
  }
  fs.writeFileSync(`public/icon-${size}.png`, PNG.sync.write(png));
}
