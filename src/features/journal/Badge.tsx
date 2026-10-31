import type { ReactNode } from 'react';
export function Badge({ tone, children }: { tone?: 'good' | 'warn' | 'bad' | 'info' | 'brand'; children: ReactNode }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}
