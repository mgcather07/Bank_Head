import type { SourceRegistry } from '../../data';
import { GOVERNING_LINKS } from '../../engine/regulations';
import { RUT_SOURCES } from '../../engine/rut';

export function SourcesScreen({ registry }: { registry: SourceRegistry | null }) {
  return (
    <div className="stack">
      <section className="card">
        <h2>Governing regulations</h2>
        <ul className="t-sm" style={{ marginTop: 8 }}>{GOVERNING_LINKS.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.title}</a></li>)}</ul>
        <p className="t-xs muted" style={{ marginTop: 8 }}>Bankhead Hunt Intelligence is not affiliated with ADCNR or the USDA Forest Service and does not provide check-in or harvest reporting.</p>
      </section>
      <section className="card">
        <h2>Data inventory</h2>
        {registry && <p className="t-xs muted" style={{ margin: '6px 0 10px' }}>Terrain analysis {registry.terrain.algorithmVersion}, generated {new Date(registry.terrain.generated).toLocaleString()} · grid about {registry.terrain.grid.approxCellM.join('×')} m · {String(registry.terrain.counts.candidates)} candidates.</p>}
        <div className="stack">
          {registry?.sources.map((s) => (
            <div key={s.id} className="source">
              <div><b>{s.title}</b> <span className="badge">{s.quality}</span></div>
              <div className="t-xs">{s.agency} · <a href={s.url} target="_blank" rel="noreferrer">source</a>{s.featureCount != null && ` · ${s.featureCount} features`}{s.checksum && ` · sha256 ${s.checksum}`}</div>
              <div className="t-xs muted">{s.resolution}{s.retrieved && ` · retrieved ${s.retrieved.slice(0, 10)}`}{s.updated && ` · updated ${String(s.updated).slice(0, 10)}`}{s.usage && ` · ${s.usage}`}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Rut timing sources</h2>
        <ul className="t-sm" style={{ marginTop: 8 }}>{RUT_SOURCES.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> · {s.status}</li>)}</ul>
      </section>
      <section className="card">
        <h2>Known gaps</h2>
        <ul className="t-sm" style={{ marginTop: 8 }}>
          <li>The Forest Service Motor Vehicle Use Map has no Bankhead coverage in the public service, so vehicle access and gate status are unverified.</li>
          <li>No official Zone A/B polygon exists in the ADCNR GIS service. The split follows AL 33 from the official permit map, with a 400 m uncertainty band.</li>
          <li>Parking and kiosk locations on the permit map are not published as GIS. Access points are recreation sites, the check station and roadside points on Forest roads.</li>
          <li>No deer observation, density or harvest data is used. Habitat indicators are potential only.</li>
          <li>Private land uses public elevation, vegetation and OpenStreetMap roads. Farm and lease roads are often missing from OpenStreetMap.</li>
          <li>Scoring weights are uncalibrated hypotheses.</li>
        </ul>
      </section>
    </div>
  );
}
