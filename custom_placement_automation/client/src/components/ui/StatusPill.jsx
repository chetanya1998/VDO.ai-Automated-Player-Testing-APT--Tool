export default function StatusPill({ tone = 'ok', children }) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}
