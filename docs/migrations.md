# Migrations

Migrations are plain SQL, one file per change, run by
[node-pg-migrate](https://github.com/salsita/node-pg-migrate) through
`src/scripts/migrate.ts`. The `pgmigrations` table records which of them a given
database has received. The setup follows talokatsastus-api.

Making a schema change:

```bash
npm run db:migrate:create -- add-something
# edit migrations/<timestamp>_add-something.sql — fill in BOTH sections
npm run db:migrate
npm run db:migrate:down   # verify the down section actually works
npm run db:migrate        # re-apply
npm run test:db           # migrates the test database, then runs the DB tests
```

Do that down-then-up round trip before committing. An untested down section
fails at the moment you most need it.

Every file needs both markers, and the down section must genuinely reverse the
up section:

```sql
-- Up Migration
CREATE TABLE things (
  id         bigserial   NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT things_pkey PRIMARY KEY (id)
);

CREATE TRIGGER trg_things_set_updated_at
  BEFORE UPDATE ON things
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE things;
```

An **empty** down section is worse than a missing one: the runner reports
success and deletes the ledger row while leaving the schema untouched, so the
next `db:migrate` re-applies the up section against objects that still exist.

## Conventions

- Constraints are named: `<table>_pkey`, `fk_<table>_<target>`,
  `uq_<table>_<columns>`, `ck_<table>_<rule>`, `ix_<table>_<columns>`. Error
  messages then say which rule was broken, and the DB tests assert on those names.
- Every table with `updated_at` attaches the `set_updated_at()` trigger.
- Allowed values (`status`, `source`, `kind`, …) are `CHECK` constraints, not
  enum types, so adding a value is one `ALTER TABLE` statement.
- `npm run db:reset` wipes the Docker volume, including both databases. Run
  `npm run db:migrate` afterwards.
