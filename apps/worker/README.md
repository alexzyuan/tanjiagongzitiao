# Salary worker

The worker opens the same configured `SqliteSalaryStore` as the API, archives batches older than the employee visibility window once, and closes the database before exiting. Configure `SALARY_DATABASE_PATH` as an absolute path and provide the 64-hex-character `SALARY_ENCRYPTION_KEY`.

Run it from an external daily cron or systemd timer; the Node process does not contain an internal scheduler:

```bash
pnpm --filter @salary/worker build
SALARY_DATABASE_PATH=/srv/salary/data/salary-slip.sqlite \
SALARY_ENCRYPTION_KEY="$SALARY_ENCRYPTION_KEY" \
pnpm --filter @salary/worker start
```

Use SQLite's safe backup operation while the database is live, and keep the backup file and encryption key under separate access controls:

```bash
sqlite3 "$SALARY_DATABASE_PATH" ".backup '/srv/salary/backups/salary-slip-$(date +%F).sqlite'"
sqlite3 /srv/salary/backups/salary-slip-YYYY-MM-DD.sqlite "PRAGMA integrity_check;"
```

To verify a restore, copy the backup to an isolated path, start the worker/API against that copy with the separately managed key, run a read-only health/archive check, and destroy the isolated copy after validation. Never commit or package the live database or key.
