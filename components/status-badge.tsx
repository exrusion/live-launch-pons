export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll("_", " ");
  return <span className={`status-badge status-${status.toLowerCase()}`}>{normalized}</span>;
}
