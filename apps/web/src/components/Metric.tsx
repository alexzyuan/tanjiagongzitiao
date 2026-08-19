import type { ReactNode } from "react";

export function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning";
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
