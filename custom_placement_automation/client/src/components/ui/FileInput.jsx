import { useRef } from 'react';

export default function FileInput({ label, hint, accept, file, onChange, disabled }) {
  const inputRef = useRef(null);

  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="file-input">
        <button type="button" className="btn" onClick={() => inputRef.current?.click()} disabled={disabled}>
          Choose file
        </button>
        <span className={file ? '' : 'muted'}>{file ? `${file.name} (${(file.size / 1024).toFixed(1)} KB)` : 'No file chosen'}</span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}
