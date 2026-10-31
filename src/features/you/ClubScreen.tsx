// One shared club: who is in it, invitations waiting, and inviting someone new. What each person can do here
// matches the database rules: the owner manages everyone, admins manage plain members, members can leave.
import { useState } from 'react';
import type { CloudUser } from '../../lib/sync/store';
import { canInvite, canManage, invitableRoles, inviteMessage, inviteProblem, ROLE_LABEL, type Club, type ClubMember, type ClubRole } from '../../lib/clubs';
import { clubError } from '../../lib/sync/clubCloud';
import type { ClubsApi } from '../../lib/club-data';
import { Avatar, Button, Field, ListRow, Notice, Segmented } from '../../ui/kit';
import { ModalSheet } from '../../ui/Sheet';
import { ArrowLeft, Copy, Crown, Lock, Mail, MapIcon, Send, ShieldCheck, Trash2, UserMinus, UserPlus, Users, X } from '../../ui/icons';

type Role = Exclude<ClubRole, 'owner'>;
const roleIcon = (r: ClubRole) => (r === 'owner' ? <Crown size={14} /> : r === 'admin' ? <ShieldCheck size={14} /> : null);

export function ClubScreen({ club, me, api, onBack, onOpenMap, onToast }: { club: Club; me: CloudUser; api: ClubsApi; onBack: () => void; onOpenMap: () => void; onToast: (t: string) => void }) {
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<ClubMember | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (f: () => Promise<void>, done?: string) => {
    setBusy(true); setError(null);
    try { await f(); if (done) onToast(done); return true; } catch (e) { setError(clubError(e)); return false; } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <Button variant="quiet" icon={<ArrowLeft size={18} />} onClick={onBack}>You</Button>
      <div>
        <h1>{club.land.name}</h1>
        <p className="t-sm muted" style={{ marginTop: 4 }}>{Math.round(club.land.acres)} acres · Deer Zone {club.land.deerZone}{club.land.county ? ` · ${club.land.county} County` : ''} · You are {ROLE_LABEL[club.role].toLowerCase()}</p>
      </div>
      <div className="row wrap">
        <Button variant="primary" icon={<MapIcon size={18} />} onClick={onOpenMap}>Open on map</Button>
        {canInvite(club.role) && <Button icon={<UserPlus size={18} />} onClick={() => setInviting(true)}>Invite</Button>}
      </div>
      {error && <Notice tone="bad" title="That didn’t work" onDismiss={() => setError(null)}>{error}</Notice>}

      <div className="section-label">Members · {club.members.length}</div>
      <div className="list">
        {club.members.map((m) => {
          const manageable = canManage(club.role, m, me.uid);
          return (
            <ListRow key={m.uid} icon={<Avatar user={{ name: m.name ?? null, email: m.email ?? null, photoURL: m.photoURL ?? null }} />}
              title={<>{m.name ?? m.email ?? 'Member'}{m.uid === me.uid ? <span className="muted" style={{ fontWeight: 500 }}> (you)</span> : null}</>}
              sub={m.email}
              right={<span className={`role-tag ${m.role}`}>{roleIcon(m.role)}{ROLE_LABEL[m.role]}</span>}
              onClick={manageable ? () => setManaging(m) : undefined} />
          );
        })}
      </div>

      {canInvite(club.role) && club.invites.length > 0 && (
        <>
          <div className="section-label">Waiting to join · {club.invites.length}</div>
          <div className="list">
            {club.invites.map((i) => (
              <ListRow key={i.key} icon={<Mail size={18} />} title={i.email} sub={`${ROLE_LABEL[i.role]} · invited by ${i.invitedByName ?? 'a member'} · ${new Date(i.created).toLocaleDateString()}`}
                right={(club.role === 'owner' || i.role === 'member') ? <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => api.revoke(club.id, i.key), `Invitation to ${i.email} withdrawn.`)}>Withdraw</Button> : undefined} />
            ))}
          </div>
        </>
      )}

      <div className="section-label">Privacy</div>
      <div className="list">
        <ListRow icon={<Lock size={18} />} title="Only members can see this club" sub="The boundary, zones and member list are readable only by the people listed above. Journals and pins stay private to each member." />
      </div>

      {club.role !== 'owner' && <Button block variant="danger" icon={<UserMinus size={18} />} onClick={() => setConfirmLeave(true)}>Leave club</Button>}

      <InviteSheet open={inviting} club={club} me={me} onClose={() => setInviting(false)} api={api} onToast={onToast} />

      <ModalSheet open={!!managing} title={managing?.name ?? managing?.email ?? 'Member'} onClose={() => setManaging(null)}>
        {managing && (
          <div className="stack">
            <p className="t-sm muted">{managing.email} · {ROLE_LABEL[managing.role]} since {new Date(managing.joined).toLocaleDateString()}</p>
            {club.role === 'owner' && (
              <Field label="Role" hint="Admins can invite and remove members. Only the owner can make admins.">
                <Segmented label="Role" block value={managing.role as Role} options={[['member', 'Member'], ['admin', 'Admin']]}
                  onChange={(r) => void run(() => api.setRole(club.id, managing.uid, r), `${managing.name ?? 'Member'} is now ${ROLE_LABEL[r].toLowerCase()}.`).then((ok) => ok && setManaging({ ...managing, role: r }))} />
              </Field>
            )}
            <Button block variant="danger" icon={<Trash2 size={18} />} disabled={busy}
              onClick={() => void run(() => api.remove(club.id, managing.uid), `${managing.name ?? managing.email} was removed from the club.`).then((ok) => ok && setManaging(null))}>Remove from club</Button>
            <p className="t-xs muted">They lose access to the boundary and zones right away. Their own journal and pins stay in their account.</p>
          </div>
        )}
      </ModalSheet>

      <ModalSheet open={confirmLeave} title="Leave this club?" onClose={() => setConfirmLeave(false)}
        footer={<><Button onClick={() => setConfirmLeave(false)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void run(() => api.leave(club.id), `You left ${club.land.name}.`).then((ok) => { if (ok) { setConfirmLeave(false); onBack(); } })}>Leave</Button></>}>
        <p className="t-sm">You’ll stop seeing {club.land.name} on any device. To come back, an owner or admin has to invite you again. Your journal and pins stay in your account.</p>
      </ModalSheet>
    </div>
  );
}

function InviteSheet({ open, club, me, onClose, api, onToast }: { open: boolean; club: Club; me: CloudUser; onClose: () => void; api: ClubsApi; onToast: (t: string) => void }) {
  const roles = invitableRoles(club.role);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setEmail(''); setRole('member'); setSent(null); setError(null); onClose(); };

  const submit = async () => {
    const problem = inviteProblem(club, email);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try { await api.invite(club, email, role); setSent(email.trim().toLowerCase()); } catch (e) { setError(clubError(e)); } finally { setBusy(false); }
  };
  const msg = sent ? inviteMessage(club, sent, me.name ?? me.email ?? 'A member') : null;
  const share = async () => {
    if (!msg) return;
    if (navigator.share) { try { await navigator.share(msg); return; } catch { /* cancelled */ return; } }
    window.location.href = `mailto:${encodeURIComponent(sent!)}?subject=${encodeURIComponent(msg.title)}&body=${encodeURIComponent(`${msg.text}\n\n${msg.url}`)}`;
  };
  const copy = async () => { if (msg) { try { await navigator.clipboard.writeText(`${msg.text}\n${msg.url}`); onToast('Invitation copied.'); } catch { onToast('Couldn’t copy on this device.'); } } };

  return (
    <ModalSheet open={open} title={sent ? 'Invitation ready' : `Invite to ${club.land.name}`} onClose={close}
      footer={sent ? <><Button onClick={close}>Done</Button><Button variant="primary" icon={<Send size={18} />} onClick={() => void share()}>Send it</Button></>
        : <><Button onClick={close}>Cancel</Button><Button variant="primary" icon={<UserPlus size={18} />} disabled={busy || !email.trim()} onClick={() => void submit()}>{busy ? 'Inviting…' : 'Invite'}</Button></>}>
      {sent ? (
        <div className="stack">
          <Notice tone="good" title={`${sent} can join now`}>The invitation is saved. When they sign in to the app with that Google address, it’s waiting for them on the You tab.</Notice>
          <p className="t-sm muted">Let them know: send it by text or email from your phone, or copy it.</p>
          <Button block icon={<Copy size={18} />} onClick={() => void copy()}>Copy invitation</Button>
        </div>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="Their Google email" hint="They must sign in with exactly this address. Only that account can accept.">
            <input className="input" type="email" aria-label="Their Google email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="name@gmail.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
          </Field>
          {roles.length > 1 && <Field label="Role" hint={role === 'admin' ? 'Admins can invite and remove members.' : 'Members see the club, its zones and walk-in routes.'}><Segmented label="Role" block value={role} options={[['member', 'Member'], ['admin', 'Admin']]} onChange={setRole} /></Field>}
          {error && <Notice tone="bad">{error}</Notice>}
          <button type="submit" hidden />
        </form>
      )}
    </ModalSheet>
  );
}

/** Invitations waiting for the signed-in person, shown at the top of the You tab. */
export function InboxCard({ api, onJoined, onToast }: { api: ClubsApi; onJoined: (clubId: string) => void; onToast: (t: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!api.inbox.length) return null;
  return (
    <section className="card invite-card">
      <div className="card-title"><h2><Users size={20} /> Club invitation{api.inbox.length > 1 ? 's' : ''}</h2></div>
      <div className="stack">
        {api.inbox.map((inv) => (
          <div key={inv.clubId} className="stack">
            <p><strong>{inv.invitedByName}</strong> invited you to join <strong>{inv.clubName}</strong> as {ROLE_LABEL[inv.role].toLowerCase()}.</p>
            <div className="row">
              <Button variant="primary" disabled={!!busy} onClick={async () => {
                setBusy(inv.clubId); setError(null);
                try { await api.accept(inv); onToast(`Welcome to ${inv.clubName}.`); onJoined(inv.clubId); } catch (e) { setError(clubError(e)); } finally { setBusy(null); }
              }}>{busy === inv.clubId ? 'Joining…' : 'Join club'}</Button>
              <Button variant="quiet" icon={<X size={16} />} disabled={!!busy} onClick={async () => {
                setBusy(inv.clubId); setError(null);
                try { await api.decline(inv); } catch (e) { setError(clubError(e)); } finally { setBusy(null); }
              }}>Decline</Button>
            </div>
          </div>
        ))}
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </section>
  );
}
