export default function TextArea({ label, hint, id, className = '', ...props }) {
  return (
    <label className={`field ${className}`.trim()} htmlFor={id}>
      {label && <span className="field-label">{label}</span>}
      <textarea id={id} className="input textarea" {...props} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
