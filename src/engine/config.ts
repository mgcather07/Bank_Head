// Mirrors scripts/config.mjs — the study area every data file covers.
export const STUDY_BBOX: [number, number, number, number] = [-87.66, 33.96, -87.08, 34.5];
export const inStudyArea = (p: [number, number] | null) => !!p && p[0] > STUDY_BBOX[0] && p[0] < STUDY_BBOX[2] && p[1] > STUDY_BBOX[1] && p[1] < STUDY_BBOX[3];
