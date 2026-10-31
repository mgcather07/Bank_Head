// Mirrors scripts/config.mjs — the study area every data file covers.
export const STUDY_BBOX: [number, number, number, number] = [-87.66, 33.96, -87.08, 34.5];
export const inStudyArea = (p: [number, number] | null) => !!p && p[0] > STUDY_BBOX[0] && p[0] < STUDY_BBOX[2] && p[1] > STUDY_BBOX[1] && p[1] < STUDY_BBOX[3];

/** Public terrain/habitat/road data covers this box for the private club (see scripts/build-club.mjs). It says nothing about where in the box the club is. */
export const CLUB_BBOX: [number, number, number, number] = [-86.78, 33.73, -86.67, 33.81];
export const inClubBox = (p: [number, number] | null) => !!p && p[0] > CLUB_BBOX[0] && p[0] < CLUB_BBOX[2] && p[1] > CLUB_BBOX[1] && p[1] < CLUB_BBOX[3];
