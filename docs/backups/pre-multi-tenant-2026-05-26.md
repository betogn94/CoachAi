# Pre-migration snapshot — multi-tenant Phase A

**Captured:** 2026-05-26 before applying the `tenants` + `usuarios.tenant_id` migration.
**Source:** `SELECT * FROM usuarios` via Supabase MCP.

This is a defensive backup. The migration is fully reversible
(`ALTER TABLE usuarios DROP COLUMN tenant_id; DROP TABLE tenants;`), so
this snapshot is only here in the unlikely case the migration silently
corrupts data — we can then UPSERT these rows back.

## Users (4)

| id | email | nombre | created_at | session_count |
|----|-------|--------|------------|---------------|
| d0f65813-c8fe-4015-818b-f5e1b6e1bae5 | forozco2@gmail.com | Franco | 2026-05-19 | 22 |
| 4b3d3b68-881e-418e-b9c6-12fc8eb950d5 | farfanguillermo400@gmail.com | Guillermo | 2026-05-20 | 6 |
| 59079d94-0787-4ddc-b00a-05a57e3bf6b2 | jesusbabot2@gmail.com | Daniel | 2026-05-22 | 7 |
| aa5ff97b-1cb4-4ddb-99d5-50c7d185a0e3 | testb@test.com | TestB | 2026-05-23 | 212 |

## Restore command (if ever needed)

```sql
-- Step 1: drop the new structure
ALTER TABLE usuarios DROP COLUMN IF EXISTS tenant_id;
DROP TABLE IF EXISTS tenants CASCADE;

-- Step 2: usuarios rows were never destructively touched by the migration,
-- only tenant_id was added (then dropped above). Nothing else to restore.
-- The migration's UPDATE only filled tenant_id; it never modified any
-- existing column. So step 1 is the full revert.
```

## Migration applied after this snapshot

See `docs/multi-tenant-foundation.md` for the full plan. Phase A migration:

1. CREATE TABLE tenants (+ RLS + read policy)
2. INSERT tenant 'coachai-default'
3. ALTER TABLE usuarios ADD COLUMN tenant_id (nullable)
4. UPDATE usuarios SET tenant_id = coachai-default.id WHERE tenant_id IS NULL
5. Verify zero NULL → ALTER NOT NULL + DEFAULT
6. CREATE INDEX usuarios_tenant_id_idx
