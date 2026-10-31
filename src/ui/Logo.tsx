// The Stand Point mark (same drawing as public/icon.svg, from scripts/make-icons.mjs) and wordmark.
import { useId } from 'react';

export function LogoMark({ size = 32, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="logo-mark">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1b212b" /><stop offset="1" stopColor="#0a0d12" /></linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#b9c3d1" /></linearGradient>
        <radialGradient id={`${id}b`} cx="0.38" cy="0.35" r="0.75"><stop offset="0" stopColor="#ffb07a" /><stop offset="0.55" stopColor="#ff6a1f" /><stop offset="1" stopColor="#e2470a" /></radialGradient>
        <clipPath id={`${id}l`}><circle cx="256" cy="256" r="139" /></clipPath>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${id}bg)`} />
      <g clipPath={`url(#${id}l)`}>
        <path d="M60 352 L170 270 L214 300 L256 252 L330 320 L376 286 L460 352 L460 460 L60 460 Z" fill="#323c4a" />
        <path d="M60 392 L150 330 L236 372 L312 318 L460 392 L460 460 L60 460 Z" fill="#232b36" />
        <path d="M60 352 L170 270 L214 300 L256 252 L330 320 L376 286 L460 352" fill="none" stroke={`url(#${id}r)`} strokeWidth="10" strokeLinejoin="round" />
      </g>
      <circle cx="256" cy="256" r="148" fill="none" stroke="#e9edf3" strokeWidth="18" />
      <path d="M256 70 V124 M256 388 V442 M70 256 H124 M388 256 H442" stroke="#e9edf3" strokeWidth="18" strokeLinecap="round" />
      <circle cx="256" cy="226" r="30" fill="#ff6a1f" opacity="0.22" />
      <circle cx="256" cy="226" r="18" fill={`url(#${id}b)`} />
    </svg>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return <span className="logo"><LogoMark size={size} /><span className="logo-word">Stand<b>Point</b></span></span>;
}
