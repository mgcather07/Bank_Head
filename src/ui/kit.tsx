// Small, consistent building blocks. Everything interactive is at least 44 px and keyboard reachable.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { CloudUser } from '../lib/sync/store';
import { AlertTriangle, CheckCircle2, Info, X } from './icons';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'quiet' | 'danger' | 'google'; size?: 'sm' | 'md' | 'lg'; block?: boolean; icon?: ReactNode };
export function Button({ variant = 'default', size = 'md', block, icon, className = '', children, type = 'button', ...rest }: BtnProps) {
  const cls = ['btn', variant === 'primary' && 'btn-primary', variant === 'quiet' && 'btn-quiet', variant === 'danger' && 'btn-danger btn-quiet', variant === 'google' && 'btn-google', size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', block && 'btn-block', className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest}>{icon}{children}</button>;
}

export function IconButton({ label, variant = 'default', size = 'md', on, badge, className = '', children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: 'default' | 'glass' | 'quiet'; size?: 'sm' | 'md'; on?: boolean; badge?: number | string | null }) {
  const cls = ['icon-btn', variant === 'glass' && 'glass', variant === 'quiet' && 'quiet', size === 'sm' && 'sm', on && 'on', className].filter(Boolean).join(' ');
  return <button type={type} aria-label={label} title={label} className={cls} {...rest}>{children}{badge ? <span className="dot">{badge}</span> : null}</button>;
}

export function Chip({ on, children, className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return <button type={type} className={`chip ${on ? 'on' : ''} ${className}`} aria-pressed={on} {...rest}>{children}</button>;
}

export function Segmented<T extends string>({ value, options, onChange, label, size, block }: { value: T; options: Array<[T, ReactNode]>; onChange: (v: T) => void; label: string; size?: 'sm'; block?: boolean }) {
  return (
    <div className={`seg ${size ?? ''} ${block ? 'block' : ''}`} role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <div className="field"><span className="label">{label}</span>{children}{hint ? <span className="t-xs muted">{hint}</span> : null}</div>;
}

export function band(score: number | null): 'high' | 'medium' | 'low' | 'none' {
  if (score == null) return 'none';
  return score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low';
}
export function ScoreBadge({ score, legal, small }: { score: number | null; legal?: 'verified_allowed' | 'verified_prohibited' | 'requires_verification'; small?: boolean }) {
  if (legal === 'requires_verification') return <span className="score verify">Verify regs</span>;
  if (score == null) return <span className={`score ${small ? 'sm' : ''}`}>—</span>;
  const b = band(score);
  return <span className={`score ${b} ${small ? 'sm' : ''}`}>{score}{!small && <small>{b}</small>}</span>;
}

export function Avatar({ user, size }: { user: Pick<CloudUser, 'name' | 'email' | 'photoURL'> | null; size?: 'sm' | 'lg' }) {
  const initial = (user?.name ?? user?.email ?? '?').trim().charAt(0).toUpperCase();
  if (user?.photoURL) return <img className={`avatar ${size ?? ''}`} src={user.photoURL} alt="" referrerPolicy="no-referrer" />;
  return <span className={`avatar ${size ?? ''}`} aria-hidden="true">{initial}</span>;
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}

export function Notice({ tone = 'info', title, children, action, onDismiss }: { tone?: 'info' | 'warn' | 'good' | 'bad'; title?: ReactNode; children?: ReactNode; action?: ReactNode; onDismiss?: () => void }) {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`notice ${tone}`} role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'}>
      <Icon className="ico" size={18} aria-hidden="true" />
      <div className="grow">
        {title && <div className="title">{title}</div>}
        {children && <div className="body">{children}</div>}
        {action && <div className="row wrap" style={{ marginTop: 8 }}>{action}</div>}
      </div>
      {onDismiss && <button type="button" className="icon-btn sm quiet" aria-label="Dismiss" onClick={onDismiss} style={{ margin: '-6px -8px 0 0' }}><X size={16} /></button>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div className="ico">{icon}</div><h3>{title}</h3>{children && <p className="t-sm">{children}</p>}{action}</div>;
}

export function ListRow({ icon, title, sub, right, onClick, tone, disabled }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void; tone?: 'brand'; disabled?: boolean }) {
  const inner = (
    <>
      {icon && <span className={`ico ${tone ?? ''}`}>{icon}</span>}
      <span className="grow"><div className="title">{title}</div>{sub && <div className="sub">{sub}</div>}</span>
      {right}
    </>
  );
  return onClick ? <button type="button" className="list-row" onClick={onClick} disabled={disabled}>{inner}</button> : <div className="list-row">{inner}</div>;
}
