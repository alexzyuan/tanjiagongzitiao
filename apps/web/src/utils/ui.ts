import { formatSalaryValue } from "../format";
import type { DirectoryUser, SalarySlipFieldGroup } from "../api";

export function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
export function parseMonthFromFilename(filename: string, fallback: string) {
  const normalizedName = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  const separated = normalizedName.match(
    /(?:^|[^\d])(\d{4})[-_年](\d{1,2})(?:月)?(?:[^\d]|$)/,
  );
  const compact = normalizedName.match(/(?:^|[^\d])(\d{4})(\d{2})(?:[^\d]|$)/);
  const match = separated ?? compact;
  if (!match) return fallback;
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return fallback;
  return `${match[1]}-${String(month).padStart(2, "0")}`;
}
export function formatSalarySlipTitle(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("invalid_payroll_month");
  return `${month.slice(0, 4)}年${month.slice(5)}月工资条`;
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
export function formatMoney(value: number) {
  return formatSalaryValue(value, true);
}
export function defaultFieldGroups(fields: string[]): SalarySlipFieldGroup[] {
  const group = (id: string, name: string, matcher: RegExp) => ({
    id,
    name,
    fieldKeys: fields.filter((field) => matcher.test(field)),
  });
  const groups = [
    group("attendance", "出勤情况", /(出勤|请假|迟到|早退)/),
    group("income", "应发工资", /(工资|补贴|绩效|业绩|提成|应发)/),
    group("deduction", "代扣款项", /(扣款|个税|所得税|社保|养老|失业|医保)/),
  ];
  const grouped = new Set(groups.flatMap((item) => item.fieldKeys));
  const other = fields.filter((field) => !grouped.has(field));
  return other.length
    ? [...groups, { id: "other", name: "其他", fieldKeys: other }]
    : groups;
}

export function directoryLabel(user: DirectoryUser) {
  return [
    user.name,
    user.employeeNo ? `工号 ${user.employeeNo}` : undefined,
    user.userId,
  ].filter(Boolean).join(" · ");
}
