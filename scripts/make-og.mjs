// Renders the link-preview card (1200x630) for Open Graph / Twitter from an SVG.
import sharp from 'sharp';
import fs from 'node:fs';

const contour = (cy, amp, phase) => {
  let d = `M -20 ${cy}`;
  for (let x = 0; x <= 1220; x += 40) d += ` L ${x} ${(cy + amp * Math.sin(x / 140 + phase) + amp * 0.5 * Math.sin(x / 55 + phase * 2)).toFixed(1)}`;
  return d;
};
const contours = Array.from({ length: 14 }, (_, i) => `<path d="${contour(60 + i * 46, 18 + (i % 3) * 6, i * 0.7)}" fill="none" stroke="#c9a46a" stroke-opacity="${i % 5 === 0 ? 0.35 : 0.18}" stroke-width="${i % 5 === 0 ? 2 : 1.2}"/>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#15201a"/><stop offset="1" stop-color="#0b100d"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0e1410" stop-opacity="0.95"/><stop offset="0.6" stop-color="#0e1410" stop-opacity="0.6"/><stop offset="1" stop-color="#0e1410" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  ${contours}
  <path d="M 700 630 L 760 420 L 800 470 L 840 400 L 900 480 L 960 360 L 1040 470 L 1100 420 L 1200 560 L 1200 630 Z" fill="#1f2e24"/>
  <path d="M 780 630 L 860 500 L 920 560 L 980 470 L 1060 560 L 1120 510 L 1200 600 L 1200 630 Z" fill="#17231b"/>
  <rect width="760" height="630" fill="url(#fade)"/>
  <g transform="translate(72 72)">
    <rect width="88" height="88" rx="18" fill="#0e1410" stroke="#2f3f34" stroke-width="2"/>
    <path d="M11 69 L36 25 L50 47 L58 36 L77 69 Z" fill="#d9a441"/>
    <path d="M36 25 L43 37 L37.5 34.5 L32 40 Z" fill="#f3e2b5"/>
  </g>
  <text x="180" y="112" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="6" fill="#d9a441">REHTAC LABS</text>
  <text x="180" y="150" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="20" fill="#9fae9f">bankhead.web.app</text>
  <text x="72" y="290" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="72" font-weight="800" fill="#ecefe7">Bankhead Hunt</text>
  <text x="72" y="370" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="72" font-weight="800" fill="#ecefe7">Intelligence</text>
  <text x="72" y="430" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="27" fill="#c9d3c4">Terrain, wind, regulation and weather intelligence</text>
  <text x="72" y="468" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="27" fill="#c9d3c4">for whitetail deer on Black Warrior WMA, Alabama</text>
  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="20" font-weight="600">
    <rect x="72" y="510" width="196" height="46" rx="23" fill="#26332a" stroke="#3f5245"/><text x="170" y="540" text-anchor="middle" fill="#ecefe7">Morning vs. evening</text>
    <rect x="282" y="510" width="150" height="46" rx="23" fill="#26332a" stroke="#3f5245"/><text x="357" y="540" text-anchor="middle" fill="#ecefe7">Wind &amp; scent</text>
    <rect x="446" y="510" width="164" height="46" rx="23" fill="#26332a" stroke="#3f5245"/><text x="528" y="540" text-anchor="middle" fill="#ecefe7">2026-27 regs</text>
    <rect x="624" y="510" width="172" height="46" rx="23" fill="#26332a" stroke="#3f5245"/><text x="710" y="540" text-anchor="middle" fill="#ecefe7">7-day outlook</text>
  </g>
</svg>`;
fs.writeFileSync('public/og.svg', svg);
await sharp(Buffer.from(svg)).png().toFile('public/og.png');
console.log('wrote public/og.png');
