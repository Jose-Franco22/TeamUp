export function Loading({ label = 'Loading' }) {
  return <p className="state" role="status">{label}…</p>;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state error" role="alert">
      <p>{error?.message || 'Something went wrong.'}</p>
      {onRetry && (
        <button className="btn ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="state empty-state">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}
