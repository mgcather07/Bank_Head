import type { Geometry, Polygon, MultiPolygon } from 'geojson';

export type Session = 'morning' | 'midday' | 'evening';
export type Weapon = 'bow' | 'crossbow' | 'rifle' | 'muzzleloader';
export type Target = 'any' | 'mature_buck' | 'doe';
export type StandType = 'climber' | 'saddle' | 'hang_on' | 'ground';
export type Effort = 'easy' | 'balanced' | 'deep';
export type LegalStatus = 'verified_allowed' | 'verified_prohibited' | 'requires_verification';
export type Confidence = 'high' | 'moderate' | 'low' | 'insufficient';
export type EvidenceStatus = 'observed' | 'derived' | 'habitat_potential' | 'user_confirmed' | 'forecast' | 'regulation' | 'missing';

export interface HuntPreferences {
  date: string; // YYYY-MM-DD, America/Chicago
  session: Session | 'all' | 'compare';
  weapon: Weapon;
  target: Target;
  maxWalkMeters: number;
  stand: StandType;
  effort: Effort;
  youthHunter: boolean;
  start: [number, number] | null; // lon,lat of starting point (GPS / pin)
}

export interface RouteOption {
  accessPointId: string;
  name: string;
  kind: string;
  coord: [number, number];
  verification: string;
  straightLineMeters: number;
  walkMeters: number;
  onNetworkMeters: number;
  offTrailMeters: number;
  routeKind: 'network+offtrail' | 'straight';
  path: [number, number][];
  profile: [number, number][]; // [distM, elevM]
  gainInMeters: number;
  gainOutMeters: number;
  maxSlopeDeg: number;
  approachBearing: number;
}

export interface CandidateProps {
  id: string;
  type: 'saddle' | 'bench' | 'spur' | 'bottom' | 'spot';
  label: string;
  terrainScore: number;
  center: [number, number];
  elevationM: number;
  slopeDeg: number;
  aspectDeg: number;
  aspectName: string;
  aspectStrength: number;
  tpiLocal: number;
  tpiLandscape: number;
  localReliefM: number;
  meanSlopeDeg: number;
  steepFraction: number;
  distStreamM: number;
  distTrailM: number;
  distRoadM: number;
  nearbyFeatures: string[];
  habitat: {
    hardwood: number;
    conifer: number;
    mixed: number;
    earlySuccessional: number;
    riparian: number;
    developedAg: number;
    oak: number;
    edgeDensity: number;
  };
  disturbance: { fireRecent: number; fireMid: number; fireOld: number; mechRecent: number; mechOld: number; other: number };
  beddingCoverBearing: number | null;
  beddingCoverConsistency: number | null;
  foodWaterBearing: number | null;
  foodWaterConsistency: number | null;
  zone: 'A' | 'B' | null;
  provisionalZone: 'A' | 'B' | null;
  distToZoneDivider: number | null;
  wilderness: boolean;
  areaHa: number;
  routes: RouteOption[];
  /** Set for user-checked spots; generated candidates are always inside the WMA on FS land. */
  jurisdiction?: 'black_warrior_wma' | 'nf_outside_wma' | 'private_or_unknown';
  landform?: string;
}

export interface Candidate {
  geometry: Polygon | MultiPolygon;
  properties: CandidateProps;
}

export interface HourlyWeather {
  time: number; // epoch ms
  tempF: number | null;
  feelsF: number | null;
  humidity: number | null;
  precipIn: number | null;
  precipProb: number | null;
  cloud: number | null;
  pressureHpa: number | null;
  windMph: number | null;
  windFrom: number | null;
  gustMph: number | null;
  code: number | null;
}

export interface DailyWeather {
  date: string;
  sunrise: number | null;
  sunset: number | null;
  tMaxF: number | null;
  tMinF: number | null;
  precipIn: number | null;
  windMaxMph: number | null;
  windDominant: number | null;
}

export interface WeatherBundle {
  source: 'open-meteo';
  model: string;
  lat: number;
  lon: number;
  fetchedAt: number;
  fromCache: boolean;
  hourly: HourlyWeather[];
  daily: DailyWeather[];
  current: HourlyWeather | null;
}

export interface WeatherAlert {
  event: string;
  severity: string;
  headline: string;
  expires: string | null;
}

export interface WindAssessment {
  windFromDegrees: number | null;
  speedMph: number | null;
  scentDownwindDegrees: number | null;
  variabilityDeg: number | null;
  risk: 'low' | 'moderate' | 'high' | 'unknown';
  score: number; // 0..1
  notes: string[];
  thermal: { uncertainty: 'low' | 'moderate' | 'high'; flow: string };
}

export interface ScoreComponent {
  key: 'terrain' | 'wind' | 'access' | 'time' | 'weather' | 'evidence';
  label: string;
  weight: number;
  value: number; // 0..1
  positives: string[];
  negatives: string[];
}

export interface LegalEvaluation {
  status: LegalStatus;
  summary: string;
  huntName: string | null;
  bag: string | null;
  antlerRestriction: string | null;
  requirements: string[];
  exceptions: string[];
  ruleSource: { id: string; title: string; url: string; version: string };
}

export interface HuntRecommendation {
  id: string;
  areaId: string;
  geometry: Geometry;
  center: [number, number];
  landJurisdiction: string;
  zoneId?: string;
  huntDate: string;
  session: Session;
  method: Weapon;
  legal: LegalEvaluation;
  legalStatus: LegalStatus;
  score: number | null;
  confidence: Confidence;
  confidenceReasons: string[];
  components: ScoreComponent[];
  terrainFeatures: string[];
  habitatIndicators: string[];
  weatherFactors: string[];
  windAssessment: WindAssessment;
  recommendedWindow?: { start: string; end: string };
  route?: { verifiedAccessPointId: string; name: string; distanceMeters: number; elevationGainMeters?: number; verification: string; coord: [number, number]; routeKind: RouteOption['routeKind']; onNetworkMeters: number; offTrailMeters: number; path: [number, number][]; profile: [number, number][] };
  reasons: string[];
  warnings: string[];
  improvements: string[];
  evidence: Array<{ sourceId: string; timestamp: string; status: EvidenceStatus }>;
  modelVersion: string;
  candidate: CandidateProps;
}

export interface UserPin {
  id: string;
  kind: 'stand' | 'sighting' | 'rub' | 'scrape' | 'trail' | 'bedding' | 'feeding' | 'camera' | 'parking' | 'harvest' | 'saved_candidate';
  coord: [number, number];
  note: string;
  created: string;
  candidateId?: string;
}
