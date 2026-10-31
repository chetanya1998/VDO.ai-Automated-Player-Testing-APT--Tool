export const CHECK_TYPE = { JS: 'vdo.ai.js', CSS: 'style.css', STICKY: 'sticky', IMPLEMENTATION: 'implementation' };

export const CHECK_TYPE_OPTIONS = [
  { value: CHECK_TYPE.JS, label: 'Custom placement (vdo.ai.js)' },
  { value: CHECK_TYPE.CSS, label: 'CSS (style.css)' },
];

const LABELS = { [CHECK_TYPE.CSS]: 'CSS', [CHECK_TYPE.STICKY]: 'Sticky', [CHECK_TYPE.IMPLEMENTATION]: 'Implementation' };
const NAMES = { [CHECK_TYPE.CSS]: 'CSS check', [CHECK_TYPE.STICKY]: 'Sticky violation check', [CHECK_TYPE.IMPLEMENTATION]: 'Implementation validator' };

export const checkTypeLabel = (type) => LABELS[type] ?? 'JS';
export const checkTypeName = (type) => NAMES[type] ?? 'Custom placement';

// The implementation validator takes one or more tags, separated by commas, spaces or new lines.
export const parseTags = (value) => [...new Set(String(value ?? '').split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean))];

// v-… video, b-… banner, o-… offerwall; a tag without a prefix is treated as video.
export const unitOf = (tag) => (/^b-/i.test(tag) ? 'banner' : /^o-/i.test(tag) ? 'offerwall' : 'video');
export const UNIT_LABELS = { video: 'Video', banner: 'Banner', offerwall: 'Offerwall' };
export const UNIT_CASE_COUNT = { video: 11, banner: 11, offerwall: 10 };
