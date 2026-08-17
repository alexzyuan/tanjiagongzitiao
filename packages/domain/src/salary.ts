export type SalaryBatchState =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "partially_failed"
  | "withdrawn"
  | "archived";

const transitions: Record<SalaryBatchState, readonly SalaryBatchState[]> = {
  draft: ["scheduled", "sending", "withdrawn"],
  scheduled: ["sending", "withdrawn"],
  sending: ["sent", "partially_failed"],
  sent: ["withdrawn", "archived"],
  partially_failed: ["sending", "withdrawn"],
  withdrawn: ["archived"],
  archived: []
};

export function canTransition(from: SalaryBatchState, to: SalaryBatchState): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: SalaryBatchState, to: SalaryBatchState): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid_salary_batch_transition:${from}->${to}`);
  }
}

export type SalaryFieldValue = string | number | null;

export interface SalaryItemInput {
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  fields: Record<string, SalaryFieldValue>;
}

export interface SalaryBatchSummary {
  id: string;
  payrollMonth: string;
  title: string;
  state: SalaryBatchState;
  total: number;
  sent: number;
  viewed: number;
  confirmed: number;
  assignedAdminIds: string[];
  createdById: string;
}
