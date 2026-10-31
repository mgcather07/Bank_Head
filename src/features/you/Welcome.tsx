import { ModalSheet } from '../../ui/Sheet';
import { Button, Notice } from '../../ui/kit';
import { Cloud, Lock, Mountain } from '../../ui/icons';
import type { Account } from '../../lib/account';
import { GoogleG } from '../explore/Sheets';

export function Welcome({ open, onClose, account }: { open: boolean; onClose: () => void; account: Account }) {
  return (
    <ModalSheet open={open} onClose={onClose} title="Welcome">
      <div className="stack" style={{ paddingBottom: 8 }}>
        <div><h1>Hunt smarter.</h1><p className="t-md dim" style={{ marginTop: 6 }}>Terrain, wind, weather and the actual season rules, ranked for the land you hunt.</p></div>
        <div className="welcome-points">
          <div><span className="ico"><Mountain size={18} /></span><div><b>Public and private land</b><p className="t-sm muted">Black Warrior WMA, the National Forest and your own club, each with the right rules.</p></div></div>
          <div><span className="ico"><Cloud size={18} /></span><div><b>Your hunts, everywhere</b><p className="t-sm muted">Journal and pins sync to your account and work offline.</p></div></div>
          <div><span className="ico"><Lock size={18} /></span><div><b>Private stays private</b><p className="t-sm muted">Your land is visible only to your login.</p></div></div>
        </div>
        <Button variant="google" size="lg" block icon={<GoogleG />} onClick={() => void account.signIn()} disabled={account.busy}>{account.busy ? 'Opening Google…' : 'Continue with Google'}</Button>
        {account.error && <Notice tone="bad" title="Sign-in problem" onDismiss={account.clearError}>{account.error}</Notice>}
        <Button variant="quiet" block onClick={onClose}>Not now</Button>
      </div>
    </ModalSheet>
  );
}
