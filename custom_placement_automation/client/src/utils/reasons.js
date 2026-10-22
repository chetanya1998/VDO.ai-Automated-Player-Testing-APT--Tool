export const REASON_LABELS = {
  page_blocked: 'Page blocked',
  div_not_found: 'Wrapper div not found',
  no_event_emitted: 'No vdo:placement event',
  placement_failed: 'Placement reported failure',
  script_not_loaded: 'vdo.ai.js not requested',
  wrapper_hidden: 'Wrapper hidden',
  timeout: 'Page load timed out',
  page_closed: 'Page closed during check',
};

export const reasonLabel = (reason) => REASON_LABELS[reason] ?? reason;
