import type { ReactNode } from "react";

export function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "span-2" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
