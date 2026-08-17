import * as XLSX from "xlsx";
import type { SalaryItemInput } from "@salary/domain";
import type { DirectoryUser } from "@salary/dingtalk";

export interface ImportError { row: number; field: string; code: string; message: string; }

export type RawRow = Record<string, unknown>;

export type EmployeeMatchStrategy = "userId" | "employeeNo" | "name";
export type PreviewRowStatus = "matched" | "unmatched" | "ambiguous";

export interface ImportPreviewRow {
  row: number;
  status: PreviewRowStatus;
  source: RawRow;
  value?: string;
  user?: DirectoryUser;
  candidates: DirectoryUser[];
}

export interface ImportPreview {
  strategy: EmployeeMatchStrategy;
  rows: ImportPreviewRow[];
  matched: number;
  unmatched: number;
  ambiguous: number;
}

const metadataAliases = ["userId", "钉钉用户ID", "钉钉UserID", "员工userId", "员工UserID", "employeeUserId", "employeeNo", "工号", "name", "姓名", "department", "部门", "position", "职位"];

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
  for (const [key, value] of Object.entries(row)) {
    if (hasAlias(key, metadataAliases)) continue;
    if (value === undefined || value === null || value === "") { fields[key] = null; continue; }
    if (typeof value === "number") { fields[key] = value; continue; }
    const numeric = Number(String(value).replaceAll(",", ""));
    fields[key] = Number.isFinite(numeric) && String(value).trim() !== "" ? numeric : String(value);
  }
  return fields;
}

/** Replaces spreadsheet identity columns with the identity from DingTalk. */
export function resolveDirectoryUser(source: RawRow, user: DirectoryUser): RawRow {
  const salaryFields = Object.fromEntries(Object.entries(source).filter(([key]) => !hasAlias(key, metadataAliases)));
  return {
    userId: user.userId,
    name: user.name,
    ...(user.employeeNo ? { employeeNo: user.employeeNo } : {}),
    ...(user.position ? { position: user.position } : {}),
    ...salaryFields
  };
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

export function previewRows(rows: RawRow[], directory: DirectoryUser[], strategy: EmployeeMatchStrategy): ImportPreview {
  const aliases = strategy === "userId"
    ? ["userId", "钉钉用户ID", "钉钉UserID", "员工userId", "员工UserID", "employeeUserId"]
    : strategy === "employeeNo"
      ? ["employeeNo", "工号"]
      : ["name", "姓名"];
  const previewRows = rows.map((source, index): ImportPreviewRow => {
    const value = text(source, aliases);
    const candidates = value
      ? directory.filter(user => strategy === "userId" ? user.userId === value : strategy === "employeeNo" ? user.employeeNo === value : user.name === value)
      : [];
    const base = { row: index + 2, source, ...(value ? { value } : {}), candidates };
    const [user] = candidates;
    if (user && candidates.length === 1) return { ...base, status: "matched", user };
    return { ...base, status: candidates.length ? "ambiguous" : "unmatched" };
  });
  return {
    strategy,
    rows: previewRows,
    matched: previewRows.filter(row => row.status === "matched").length,
    unmatched: previewRows.filter(row => row.status === "unmatched").length,
    ambiguous: previewRows.filter(row => row.status === "ambiguous").length
  };
}

export function parseWorkbook(buffer: Buffer): RawRow[] {
  if (buffer.length === 0) throw new Error("salary_workbook_empty");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("salary_workbook_sheet_missing");
  const sheet = workbook.Sheets[firstSheet];
  if (!sheet) throw new Error("salary_workbook_sheet_missing");
  const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headerRowIndex = values.findIndex(row => row.some(cell => typeof cell === "string" && hasAlias(cell, ["姓名", "name", "工号", "employeeNo", "userId", "钉钉用户ID", "钉钉UserID", "员工UserID", "员工userId"])));
  if (headerRowIndex < 0) throw new Error("salary_workbook_header_missing");

  const firstHeaderRow = values[headerRowIndex] ?? [];
  const nextRow = values[headerRowIndex + 1] ?? [];
  const hasMergedHeader = (sheet["!merges"] ?? []).some(merge => merge.s.r === headerRowIndex && (merge.e.r > merge.s.r || merge.e.c > merge.s.c));
  const hasSecondHeaderRow = hasMergedHeader && nextRow.some(cell => typeof cell === "string" && cell.trim());
  const headers = firstHeaderRow.map((cell, index) => {
    const lowerHeader = hasSecondHeaderRow ? stringCell(nextRow[index]) : undefined;
    return lowerHeader ?? stringCell(cell);
  });
  const seenHeaders = new Set<string>();
  for (const header of headers) {
    if (!header) continue;
    if (seenHeaders.has(header)) throw new Error(`salary_workbook_duplicate_header:${header}`);
    seenHeaders.add(header);
  }
  const firstDataRow = headerRowIndex + (hasSecondHeaderRow ? 2 : 1);
  return values.slice(firstDataRow)
    .filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ""))
    .map(row => Object.fromEntries(headers.flatMap((header, index) => header ? [[header, row[index] ?? null]] : [])));
}

function stringCell(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
