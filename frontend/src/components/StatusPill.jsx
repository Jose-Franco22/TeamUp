// Maps a status string from the database to a visual treatment.
const TONE = {
  open: 'good',
  full: 'quiet',
  accepted: 'good',
  pending: 'warn',
  declined: 'quiet',
};

export default function StatusPill({ status }) {
  if (!status) return null;
  return <span className={`pill ${TONE[status] || 'quiet'}`}>{status}</span>;
}
