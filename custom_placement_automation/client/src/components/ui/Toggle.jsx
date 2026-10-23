export default function Toggle({ id, checked, onChange, disabled, label, description, badge }) {
  return (
    <label className={`toggle-row${checked ? ' on' : ''}${disabled ? ' disabled' : ''}`} htmlFor={id}>
      <span className="toggle-text">
        <span className="toggle-label">
          {label}
          {badge && <span className="toggle-badge">{badge}</span>}
        </span>
        {description && <span className="toggle-description">{description}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="toggle-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="toggle-switch" aria-hidden="true" />
    </label>
  );
}
