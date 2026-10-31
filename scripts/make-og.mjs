// Renders the link-preview card (1200x630) for Open Graph / Twitter from an SVG.
import sharp from 'sharp';
import fs from 'node:fs';

const contour = (cy, amp, phase) => {
  let d = `M -20 ${cy}`;
  for (let x = 0; x <= 1220; x += 40) d += ` L ${x} ${(cy + amp * Math.sin(x / 140 + phase) + amp * 0.5 * Math.sin(x / 55 + phase * 2)).toFixed(1)}`;
  return d;
};
const icon = fs.readFileSync('public/icon.svg', 'utf8').replace('<svg ', '<svg x="72" y="72" width="96" height="96" ');
const contours = Array.from({ length: 14 }, (_, i) => `<path d="${contour(60 + i * 46, 18 + (i % 3) * 6, i * 0.7)}" fill="none" stroke="#5b6778" stroke-opacity="${i % 5 === 0 ? 0.35 : 0.18}" stroke-width="${i % 5 === 0 ? 2 : 1.2}"/>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#171c24"/><stop offset="1" stop-color="#08090c"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b0d11" stop-opacity="0.95"/><stop offset="0.6" stop-color="#0b0d11" stop-opacity="0.6"/><stop offset="1" stop-color="#0b0d11" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  ${contours}
  <path d="M 700 630 L 760 420 L 800 470 L 840 400 L 900 480 L 960 360 L 1040 470 L 1100 420 L 1200 560 L 1200 630 Z" fill="#1d232d"/>
  <path d="M 780 630 L 860 500 L 920 560 L 980 470 L 1060 560 L 1120 510 L 1200 600 L 1200 630 Z" fill="#151a22"/>
  <rect width="760" height="630" fill="url(#fade)"/>
  ${icon}
  <text x="192" y="114" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="6" fill="#ff6a1f">REHTAC LABS</text>
  <text x="192" y="152" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="20" fill="#788292">standpoint.web.app</text>
  <text x="72" y="330" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="96" font-weight="800" fill="#edf0f5">Stand Point</text>
  <text x="72" y="430" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="27" fill="#a8b0bd">Terrain, wind, regulation and weather intelligence</text>
  <text x="72" y="468" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="27" fill="#a8b0bd">for whitetail deer: public land and your hunting club</text>
  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="20" font-weight="600">
    <rect x="72" y="510" width="196" height="46" rx="23" fill="#1e232c" stroke="#333b47"/><text x="170" y="540" text-anchor="middle" fill="#edf0f5">Morning vs. evening</text>
    <rect x="282" y="510" width="150" height="46" rx="23" fill="#1e232c" stroke="#333b47"/><text x="357" y="540" text-anchor="middle" fill="#edf0f5">Wind &amp; scent</text>
    <rect x="446" y="510" width="164" height="46" rx="23" fill="#1e232c" stroke="#333b47"/><text x="528" y="540" text-anchor="middle" fill="#edf0f5">2026-27 regs</text>
    <rect x="624" y="510" width="172" height="46" rx="23" fill="#1e232c" stroke="#333b47"/><text x="710" y="540" text-anchor="middle" fill="#edf0f5">7-day outlook</text>
  </g>
</svg>`;
fs.writeFileSync('public/og.svg', svg);
await sharp(Buffer.from(svg)).png().toFile('public/og.png');
console.log('wrote public/og.png');
