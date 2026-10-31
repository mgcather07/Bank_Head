import type { HuntController } from '../../app/useHuntController';
import type { HuntRecommendation } from '../../engine/types';
import { Empty, Notice, ScoreBadge, Button } from '../../ui/kit';
import { Target } from '../../ui/icons';
import { legalLightLeft, SESSION_LABEL } from '../format';
import { weaponLabel } from '../../engine/regulations';
import { mi } from '../format';
import { ConditionsCard } from './ConditionsCard';
import { DayControl } from './DayControl';
import { InspectPanel } from './InspectPanel';
import { ZoneCard } from './ZoneCard';
import { ZoneDetail } from './ZoneDetail';
import { filterCount } from './Sheets';

/** Always visible at the top of the sheet: the day, the session and one line that answers "how is it today?" */
export function ExploreHeader({ ctl, onFilters }: { ctl: HuntController; onFilters: () => void }) {
  const { ratings, selected, sun, prefs } = ctl;
  const m = ratings.morning, e = ratings.evening;
  const best = (m?.score ?? -1) >= (e?.score ?? -1) ? m : e;
  const left = legalLightLeft(sun);
  return (
    <div className="explore-head">
      <DayControl prefs={prefs} onDay={ctl.pickDay} onSession={ctl.pickSession} onFilters={onFilters} filterCount={filterCount(prefs, ctl.typeFilter)} />
      {selected ? (
        <div className="summary"><ScoreBadge score={selected.score} legal={selected.legalStatus} /><div className="grow"><b>{selected.candidate.label}</b> <span className="muted">{selected.areaId}</span><div className="t-xs muted">{SESSION_LABEL[selected.session]} · wind risk {selected.windAssessment.risk}</div></div></div>
      ) : (
        <div className="summary">
          <ScoreBadge score={best?.score ?? null} legal={best?.legalStatus} />
          <div className="grow"><b>{best ? `${best === m ? 'Morning' : 'Evening'} favored` : 'No legal zones'}</b><div className="t-xs muted">{left ?? `${ctl.workspace.name} · ${ctl.data?.candidates.length ?? 0} zones`}</div></div>
        </div>
      )}
    </div>
  );
}

export function ExploreBody({ ctl, onJournal, onFilters, onNotLoaded }: { ctl: HuntController; onJournal: (rec: HuntRecommendation) => void; onFilters: () => void; onNotLoaded?: () => void }) {
  const { prefs, selected, recs, data, workspace } = ctl;
  const saved = selected ? ctl.pins.some((p) => p.kind === 'saved_candidate' && p.candidateId === selected.areaId) : false;
  const n = filterCount(prefs, ctl.typeFilter);
  void onNotLoaded;
  return (
    <div className="explore-body stack">
      {ctl.loadError && <Notice tone="bad" title="Could not load map data">{ctl.loadError}</Notice>}
      {ctl.clubError && <Notice tone="bad" title="Could not load your land">{ctl.clubError}</Notice>}
      {ctl.spotError && <Notice tone="warn" title={ctl.spotError} onDismiss={ctl.clearSpotError} />}
      {ctl.notices.map((nt) => (
        <Notice key={nt.id} tone={nt.tone} title={nt.title} onDismiss={() => ctl.dismiss(nt.id)} action={nt.actions.map((a) => <Button key={a.label} size="sm" variant={a.primary ? 'primary' : 'default'} onClick={a.run}>{a.label}</Button>)}>{nt.body}</Notice>
      ))}

      {ctl.inspect && ctl.jur && ctl.jurLegal ? (
        <InspectPanel pt={ctl.inspect} j={ctl.jur} legalSummary={ctl.jurLegal.summary} onClose={() => ctl.setInspect(null)} checking={ctl.checking}
          onAddPin={(kind) => { ctl.addPin({ kind, coord: ctl.inspect!, note: '', workspace: workspace.id }); ctl.setInspect(null); }}
          onSetStart={() => { ctl.setPrefs({ ...prefs, start: ctl.inspect }); ctl.setInspect(null); }} onCheck={() => void ctl.checkSpot(ctl.inspect!)} />
      ) : selected ? (
        <ZoneDetail rec={selected} compare={ctl.selectedCompare} timeline={ctl.timeline} plan={ctl.plan} lidarStatus={ctl.lidarStatus} shareable={!selected.candidate.club && !workspace.private}
          saved={saved} onClose={ctl.clearSelection} onSave={() => ctl.addPin({ kind: 'saved_candidate', coord: selected.center, note: selected.candidate.label, candidateId: selected.areaId, workspace: workspace.id })}
          onNavigate={() => ctl.navigate(selected)} onJournal={() => onJournal(selected)} onPickSession={(s) => ctl.setSelectedKey((k) => (k ? { ...k, session: s } : k))} />
      ) : (
        <>
          <ConditionsCard date={prefs.date} sun={ctl.sun} weather={ctl.weather} weatherError={ctl.weatherError} alerts={ctl.alerts} alertsError={ctl.alertsError} ratings={ctl.ratings} onRefresh={() => void ctl.refresh(true)} refreshing={ctl.refreshing} selected={null} windHourIdx={ctl.windHourIdx} setWindHourIdx={ctl.setWindHourIdx} />
          <section>
            <div className="row" style={{ justifyContent: 'space-between', padding: '0 4px 8px' }}>
              <h2>Top hunting areas{prefs.withKid ? <span className="muted"> · kid-friendly</span> : null}</h2>
              {n > 0 && <button type="button" className="link-btn" onClick={onFilters}>{n} filter{n > 1 ? 's' : ''} · edit</button>}
            </div>
            {prefs.withKid && <p className="t-xs muted" style={{ padding: '0 4px 8px' }}>Walks of 15 minutes or less and no steep footing. Short, open, close-to-the-truck spots score highest.</p>}
            <div className="zone-list">
              {!data || !ctl.landReady ? [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 112 }} />)
                : recs.length === 0 ? <Empty icon={<Target size={26} />} title="No legal zones match">Try a different date, weapon or filter. {ctl.notices[0]?.body ?? ''}</Empty>
                  : recs.map((r, i) => <ZoneCard key={r.id} rec={r} rank={i + 1} onOpen={() => ctl.openRec(r)} />)}
            </div>
            <p className="t-xs muted" style={{ padding: '10px 4px' }}>{weaponLabel(prefs.weapon)} · walks up to {mi(prefs.maxWalkMeters)} · ranked among {data?.candidates.length ?? '…'} terrain-derived zones. Tap anywhere on the map to rate that exact spot.</p>
          </section>
        </>
      )}
      <p className="t-xs muted foot">Decision support only. Scores are relative rankings, not probabilities. Always verify regulations, boundaries and access on site. © Rehtac Software LLC</p>
    </div>
  );
}
