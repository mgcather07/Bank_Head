// Study area shared by every data script: the whole William B. Bankhead National Forest
// (USFS land-unit extent −87.627…−87.110, 33.985…34.463) with a small margin. 0.58° × 0.54° = 2088 × 1944
// one-arc-second cells (both even, so the half-resolution grid divides cleanly).
export const BBOX = [-87.66, 33.96, -87.08, 34.5];
// Private-club study box (about 10 km × 9 km). Terrain, habitat and roads are public data, so this box only says
// "some land near Warrior, AL is covered". The club's own boundary is never part of the repo or the site; it lives
// on the user's device. 396 × 288 one-arc-second cells (both even so the half-resolution grid divides cleanly).
export const CLUB_BBOX = [-86.78, 33.73, -86.67, 33.81];
