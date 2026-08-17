import * as XLSX from "xlsx";
import type { SalaryItemInput } from "@salary/domain";

export interface ImportError { row: number; field: string; code: string; message: string; }

type RawRow = Record<string, unknown>;

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-:：]/g, "");
}

function hasAlias(key: string, aliases: string[]): boolean {
  const normalized = normalizedKey(key);
  return aliases.some(alias => normalizedKey(alias) === normalized);
}

function text(row: RawRow, keys: string[]): string | undefined {
  for (const [header, value] of Object.entries(row)) {
    if (!hasAlias(header, keys)) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function normalizedFields(row: RawRow): Record<string, string | number | null> {
  const fields: Record<string, string | number | null> = {};
  const metadataAliases = ["userId", "钉钉用户ID", "钉钉UserID", "员工userId", "员工UserID", "employeeUserId", "employeeNo", "工号", "name", "姓名", "department", "部门", "position", "职位"];
  for (const [key, value] of Object.entries(row)) {
    if (hasAlias(key, metadataAliases)) continue;
    if (value === undefined || value === null || value === "") { fields[key] = null; continue; }
    if (typeof value === "number") { fields[key] = value; continue; }
    const numeric = Number(String(value).replaceAll(",", ""));
    fields[key] = Number.isFinite(numeric) && String(value).trim() !== "" ? numeric : String(value);
  }
  return fields;
}

export function validateRows(rows: RawRow[]): { items: SalaryItemInput[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const items: SalaryItemInput[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const employeeUserId = text(row, ["userId", "钉钉用户ID", "钉钉UserID", "员工userId", "员工UserID", "employeeUserId"]);
    const employeeName = text(row, ["name", "姓名"]);
    const employeeNo = text(row, ["employeeNo", "工号"]);
    if (!employeeUserId) errors.push({ row: rowNumber, field: "userId", code: "employee_not_found", message: "必须提供钉钉用户 ID" });
    if (!employeeName) errors.push({ row: rowNumber, field: "name", code: "missing_value", message: "必须提供员工姓名" });
    if (employeeUserId && seen.has(employeeUserId)) errors.push({ row: rowNumber, field: "userId", code: "duplicate_employee", message: "同一批次不能重复出现员工" });
    if (employeeUserId) seen.add(employeeUserId);
    if (employeeUserId && employeeName && !errors.some(error => error.row === rowNumber)) {
      const item: SalaryItemInput = { employeeUserId, employeeName, fields: normalizedFields(row) };
      const department = text(row, ["department", "部门"]);
      const position = text(row, ["position", "职位"]);
      if (employeeNo) item.employeeNo = employeeNo;
      if (department) item.department = department;
      if (position) item.position = position;
      items.push(item);
    }
  });
  return { items, errors };
}

export function parseWorkbook(buffer: Buffer): RawRow[] {
  if (buffer.length === 0) throw new Error("salary_workbook_empty");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("salary_workbook_sheet_missing");
  const sheet = workbook.Sheets[firstSheet];
  if (!sheet) throw new Error("salary_workbook_sheet_missing");
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null });
}
