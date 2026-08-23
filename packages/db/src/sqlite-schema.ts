import type Database from "better-sqlite3";

export function applySqliteSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS salary_batches (id TEXT PRIMARY KEY, payroll_month TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, total INTEGER NOT NULL, sent INTEGER NOT NULL, viewed INTEGER NOT NULL, confirmed INTEGER NOT NULL, assigned_admin_ids TEXT NOT NULL, created_by_id TEXT NOT NULL, display_settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, scheduled_at TEXT, archived_at TEXT);
    CREATE TABLE IF NOT EXISTS salary_items (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES salary_batches(id), employee_user_id TEXT NOT NULL, employee_name TEXT NOT NULL, employee_no TEXT, department TEXT, position TEXT, fields_ciphertext BLOB NOT NULL, fields_iv BLOB NOT NULL, fields_auth_tag BLOB NOT NULL, viewed_at TEXT, confirmed_at TEXT, UNIQUE(batch_id, employee_user_id));
    CREATE TABLE IF NOT EXISTS salary_sub_admins (user_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS salary_settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS salary_slip_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, settings TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS salary_audits (id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, outcome TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS salary_deliveries (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES salary_batches(id), employee_user_id TEXT NOT NULL, status TEXT NOT NULL, task_id TEXT, error TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS salary_evidence (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES salary_batches(id), employee_user_id TEXT NOT NULL, event_type TEXT NOT NULL, fingerprint TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS salary_batches_month_idx ON salary_batches(payroll_month);
    CREATE INDEX IF NOT EXISTS salary_items_employee_idx ON salary_items(employee_user_id);
  `);
  const columns = db
    .prepare("PRAGMA table_info(salary_batches)")
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "display_settings")) {
    db.exec(
      "ALTER TABLE salary_batches ADD COLUMN display_settings TEXT NOT NULL DEFAULT '{}'",
    );
  }
  normalizeWithdrawnInteractions(db);
}

function normalizeWithdrawnInteractions(db: Database.Database): void {
  const stale = db
    .prepare(
      `SELECT i.id, i.batch_id
         FROM salary_items i
         JOIN salary_batches b ON b.id = i.batch_id
        WHERE (b.state = 'withdrawn' OR
               (SELECT d.status
                  FROM salary_deliveries d
                 WHERE d.batch_id = i.batch_id
                   AND d.employee_user_id = i.employee_user_id
                 ORDER BY d.created_at DESC, d.rowid DESC
                 LIMIT 1) = 'withdrawn')
          AND (i.viewed_at IS NOT NULL OR i.confirmed_at IS NOT NULL)`,
    )
    .all() as Array<{ id: string; batch_id: string }>;
  if (stale.length === 0) return;
  const batchIds = [...new Set(stale.map((row) => row.batch_id))];
  db.transaction(() => {
    const clear = db.prepare(
      "UPDATE salary_items SET viewed_at = NULL, confirmed_at = NULL WHERE id = ?",
    );
    for (const row of stale) clear.run(row.id);
    const recalculate = db.prepare(
      "UPDATE salary_batches SET viewed = (SELECT COUNT(*) FROM salary_items WHERE batch_id = ? AND viewed_at IS NOT NULL), confirmed = (SELECT COUNT(*) FROM salary_items WHERE batch_id = ? AND confirmed_at IS NOT NULL) WHERE id = ?",
    );
    for (const batchId of batchIds)
      recalculate.run(batchId, batchId, batchId);
  })();
}
