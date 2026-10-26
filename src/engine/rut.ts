// RutModel — regional breeding-phase estimate for the Bankhead / Black Warrior area.
// ADCNR (WFF rut map, fetal-data based) identifies NW Alabama (Lawrence, Winston, Cullman, Franklin) as rutting
// significantly earlier than most of the state. ADCNR's county-level peak dates were not machine-readable at build time,
// so phase dates below are from a secondary source and carry LOW confidence until reconciled with the ADCNR rut map.
export const RUT_SOURCES = [
  { id: 'adcnr-rut-map', title: 'ADCNR WFF Alabama Deer Rut Map (methodology article)', url: 'https://www.outdooralabama.com/node/3171', status: 'regional pattern only' },
  { id: 'adcnr-rut-variation', title: 'ADCNR: Whitetail rutting activity in Alabama varies widely', url: 'https://www.outdooralabama.com/node/2002', status: 'NW Alabama ruts early' },
  { id: 'al-living-bw', title: 'Alabama Living — Black Warrior WMA (rut mid-Nov, peak ~Thanksgiving, into early Dec)', url: 'https://alabamaliving.coop/?p=10532', status: 'secondary source' },
];

export type RutPhase = 'early_season' | 'pre_rut' | 'rut' | 'post_rut' | 'late_season' | 'out_of_season';

interface PhaseDef { phase: RutPhase; from: string; to: string; label: string; note: string }

// Month-day ranges (season spans the new year).
const PHASES: PhaseDef[] = [
  { phase: 'early_season', from: '10-01', to: '10-24', label: 'Early season', note: 'Food-driven patterns; bucks largely in fall ranges.' },
  { phase: 'pre_rut', from: '10-25', to: '11-14', label: 'Pre-rut', note: 'Rubs/scrapes increase; buck daylight movement begins rising.' },
  { phase: 'rut', from: '11-15', to: '12-08', label: 'Rut (estimated breeding)', note: 'Buck movement elevated and less predictable; midday can be productive.' },
  { phase: 'post_rut', from: '12-09', to: '12-31', label: 'Post-rut', note: 'Recovery feeding; evening food-related movement favored.' },
  { phase: 'late_season', from: '01-01', to: '01-31', label: 'Late season', note: 'Pressured deer; food and thermal cover dominate.' },
];

// Deer Zone C (east edge of the National Forest) ruts later — ADCNR: north Alabama mid/late December into January.
const PHASES_C: PhaseDef[] = [
  { phase: 'early_season', from: '10-15', to: '11-30', label: 'Early season', note: 'Food-driven patterns; Zone C ruts later than Zone D.' },
  { phase: 'pre_rut', from: '12-01', to: '12-19', label: 'Pre-rut', note: 'Rubs/scrapes increasing.' },
  { phase: 'rut', from: '12-20', to: '12-31', label: 'Rut (estimated breeding)', note: 'Buck movement elevated; midday can be productive.' },
  { phase: 'rut', from: '01-01', to: '01-20', label: 'Rut (estimated breeding)', note: 'Buck movement elevated; midday can be productive.' },
  { phase: 'post_rut', from: '01-21', to: '02-10', label: 'Post-rut', note: 'Recovery feeding; evening food-related movement favored.' },
];

export function rutPhase(date: string, deerZone: 'C' | 'D' | null = 'D'): PhaseDef & { confidence: 'low' } {
  const md = date.slice(5);
  const p = (deerZone === 'C' ? PHASES_C : PHASES).find((x) => md >= x.from && md <= x.to);
  return { ...(p ?? { phase: 'out_of_season', from: '', to: '', label: 'Outside deer season', note: '' }), confidence: 'low' };
}
