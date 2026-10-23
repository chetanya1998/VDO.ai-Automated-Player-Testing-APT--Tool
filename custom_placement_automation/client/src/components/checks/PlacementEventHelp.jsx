import { useState } from 'react';
import { Tooltip } from '../ui';

const EXAMPLE = `var placed = false;

if (target) {
  newNode.appendChild(childNode);
  target.insertAdjacentElement('afterend', newNode);
  placed = true;
}

window.dispatchEvent(new CustomEvent('vdo:placement', {
  detail: { success: placed }
}));`;

export default function PlacementEventHelp() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(EXAMPLE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Tooltip label="How to report the placement result">
      <strong>Report the result with vdo:placement</strong>
      <span className="tooltip-text">
        Add this at the end of your custom placement logic (e.g. in parentToAppend). Set the flag to true only when the
        player was actually placed; the check reads detail.success.
      </span>
      <pre>{EXAMPLE}</pre>
      <button type="button" className="btn btn-small" onClick={copy}>
        {copied ? 'Copied' : 'Copy example'}
      </button>
    </Tooltip>
  );
}
