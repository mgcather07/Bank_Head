// Renders the Stand Point mark: a scope reticle framing a ridgeline, with a blaze-orange point on the summit (the
// stand that overlooks the ground). Writes the favicon (SVG), the app icons and the maskable icon.
//
//   node scripts/make-icons.mjs
import sharp from 'sharp';
import fs from 'node:fs';

// The mark on a 512 grid, without background: a reticle framing a ridgeline, with the point on the summit.
// Kept inside the central 80% so it survives maskable cropping.
export const MARK = `
  <g clip-path="url(#lens)">
    <path d="M60 352 L170 270 L214 300 L256 252 L330 320 L376 286 L460 352 L460 460 L60 460 Z" fill="#323c4a"/>
    <path d="M60 392 L150 330 L236 372 L312 318 L460 392 L460 460 L60 460 Z" fill="#232b36"/>
    <path d="M60 352 L170 270 L214 300 L256 252 L330 320 L376 286 L460 352" fill="none" stroke="url(#ridge)" stroke-width="10" stroke-linejoin="round"/>
  </g>
  <circle cx="256" cy="256" r="148" fill="none" stroke="#e9edf3" stroke-width="18"/>
  <path d="M256 70 V124 M256 388 V442 M70 256 H124 M388 256 H442" stroke="#e9edf3" stroke-width="18" stroke-linecap="round"/>
  <circle cx="256" cy="226" r="30" fill="#ff6a1f" opacity="0.22"/>
  <circle cx="256" cy="226" r="18" fill="url(#blaze)"/>`;

export const DEFS = `
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b212b"/><stop offset="1" stop-color="#0a0d12"/></linearGradient>
  <linearGradient id="ridge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c3d1"/></linearGradient>
  <clipPath id="lens"><circle cx="256" cy="256" r="139"/></clipPath>
  <radialGradient id="blaze" cx="0.38" cy="0.35" r="0.75"><stop offset="0" stop-color="#ffb07a"/><stop offset="0.55" stop-color="#ff6a1f"/><stop offset="1" stop-color="#e2470a"/></radialGradient>`;

const icon = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${DEFS}</defs>
  <rect width="512" height="512" ${rounded ? 'rx="116"' : ''} fill="url(#bg)"/>
  <rect x="1" y="1" width="510" height="510" ${rounded ? 'rx="115"' : ''} fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>
  ${MARK}
</svg>`;

fs.writeFileSync('public/icon.svg', icon(true));
await sharp(Buffer.from(icon(true))).resize(192, 192).png().toFile('public/icon-192.png');
await sharp(Buffer.from(icon(true))).resize(512, 512).png().toFile('public/icon-512.png');
await sharp(Buffer.from(icon(false))).resize(512, 512).png().toFile('public/icon-maskable-512.png');
await sharp(Buffer.from(icon(false))).resize(180, 180).png().toFile('public/apple-touch-icon.png');
console.log('wrote public/icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png');
