export const VERDICTS = ['PASS', 'FAIL', 'WARNING', 'UNKNOWN', 'NOT_APPLICABLE'];

export const VERDICT_LABELS = {
  PASS: 'Pass',
  FAIL: 'Fail',
  WARNING: 'Warning',
  UNKNOWN: 'Unknown',
  NOT_APPLICABLE: 'N/A',
};

export const VERDICT_TONES = {
  PASS: 'pass',
  FAIL: 'fail',
  WARNING: 'warn',
  UNKNOWN: 'unknown',
  NOT_APPLICABLE: 'na',
};

export const verdictLabel = (verdict) => VERDICT_LABELS[verdict] ?? verdict;
export const verdictTone = (verdict) => VERDICT_TONES[verdict] ?? 'unknown';

// The 23 cases grouped by what part of the player they check.
export const CASE_GROUPS = [
  { title: 'Tag & installation', ids: ['TC-1', 'TC-2', 'TC-3', 'TC-12', 'TC-13', 'TC-18', 'TC-19'] },
  { title: 'Logger & events', ids: ['TC-4', 'TC-5', 'TC-6', 'TC-7', 'TC-15', 'TC-17', 'TC-20', 'TC-21', 'TC-22'] },
  { title: 'Ads & viewability', ids: ['TC-8', 'TC-9', 'TC-10', 'TC-11', 'TC-14'] },
  { title: 'Devices & navigation', ids: ['TC-16', 'TC-23'] },
];

export const caseNumber = (id) => Number(String(id).replace('TC-', ''));
