# Legacy Supabase scripts

These one-off backup, import, and seed scripts are archived for reference only.
They are not part of the current AWS PostgreSQL/PostgREST runtime and must not be scheduled or executed.

The active production backup is `deploy/migrate/backup.sh` (PostgreSQL `pg_dump` to the private S3 bucket).
