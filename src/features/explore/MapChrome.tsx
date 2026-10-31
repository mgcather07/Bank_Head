import type { Workspace } from '../../lib/workspaces';
import type { CloudUser } from '../../lib/sync/store';
import { Avatar, IconButton } from '../../ui/kit';
import { ChevronDown, Compass, Layers, LocateFixed, LogIn, Lock, TreePine } from '../../ui/icons';

/** The only things floating on the map: where you are hunting, who you are, and three tools. */
export function MapChrome({ variant, workspace, onWorkspace, user, signedIn, onAccount, onLayers, onLocate, onCompass, hint }: {
  variant: 'mobile' | 'desktop'; workspace: Workspace; onWorkspace: () => void; user: CloudUser | null; signedIn: boolean; onAccount: () => void; onLayers: () => void; onLocate: () => void; onCompass: () => void; hint?: string | null;
}) {
  return (
    <div className={`map-chrome ${variant}`}>
      {variant === 'mobile' && (
        <div className="chrome-top">
          <button type="button" className="ws-pill" onClick={onWorkspace} aria-label={`Hunting area: ${workspace.name}. Change`}>
            {workspace.private ? <Lock size={16} aria-hidden="true" /> : <TreePine size={16} aria-hidden="true" />}<span className="ws-name">{workspace.name}</span><ChevronDown size={16} aria-hidden="true" />
          </button>
          <button type="button" className="avatar-btn" onClick={onAccount} aria-label={signedIn ? 'Account' : 'Sign in'}>{signedIn ? <Avatar user={user} /> : <span className="signin-chip"><LogIn size={16} aria-hidden="true" />Sign in</span>}</button>
        </div>
      )}
      <div className="chrome-tools">
        <IconButton label="Map layers and tools" variant="glass" onClick={onLayers}><Layers size={20} /></IconButton>
        <IconButton label="Locate me" variant="glass" onClick={onLocate}><LocateFixed size={20} /></IconButton>
        <IconButton label="Compass" variant="glass" onClick={onCompass}><Compass size={20} /></IconButton>
      </div>
      {hint && <div className="map-hint" role="status">{hint}</div>}
    </div>
  );
}
