export default function Input({ label, hint, id, className = '', ...props }) {
  return (
    <label className={`field ${className}`.trim()} htmlFor={id}>
      {label && <span className="field-label">{label}</span>}
      <input id={id} className="input" {...props} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
