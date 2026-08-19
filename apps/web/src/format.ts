export function formatSalaryValue(
  value: string | number | null | undefined,
  grouping = false,
): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value !== "number") return String(value);
  const rounded =
    (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100) *
    Math.sign(value || 1);
  return grouping
    ? rounded.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : rounded.toFixed(2);
}
