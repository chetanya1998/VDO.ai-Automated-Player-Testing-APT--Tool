import { useId } from 'react';

export default function Tooltip({ label = 'Help', children }) {
  const id = useId();
  return (
    <span className="tooltip">
      <button type="button" className="tooltip-trigger" aria-label={label} aria-describedby={id}>
        ?
      </button>
      <span role="tooltip" id={id} className="tooltip-content">
        {children}
      </span>
    </span>
  );
}
