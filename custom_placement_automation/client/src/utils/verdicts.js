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

// What each result means, in plain words (shown as tooltips and in the legend).
export const VERDICT_HELP = {
  PASS: 'Pass: the player did what it should.',
  FAIL: 'Fail: something is broken and needs fixing.',
  WARNING: 'Warning: it works, but something needs attention.',
  UNKNOWN: 'Unknown: the tool could not decide, usually because the rules are not signed off yet or the page gave too little data.',
  NOT_APPLICABLE: 'N/A: this check does not apply to this page or device.',
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
