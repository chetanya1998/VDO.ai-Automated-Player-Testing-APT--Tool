export const CHECK_TYPE = { JS: 'vdo.ai.js', CSS: 'style.css' };

export const CHECK_TYPE_OPTIONS = [
  { value: CHECK_TYPE.JS, label: 'Custom placement (vdo.ai.js)' },
  { value: CHECK_TYPE.CSS, label: 'CSS (style.css)' },
];

export const checkTypeLabel = (type) => (type === CHECK_TYPE.CSS ? 'CSS' : 'JS');
