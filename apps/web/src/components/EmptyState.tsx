export function EmptyState({ label, compact }: { label: string; compact?: boolean }) {
  return <div className={`empty ${compact ? "compact" : ""}`}>{label}</div>;
}
