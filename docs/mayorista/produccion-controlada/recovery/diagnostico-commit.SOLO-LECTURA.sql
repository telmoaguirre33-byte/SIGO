-- Preparado, NO ejecutado. Usar sólo con psql y servicio de diagnóstico explícito
-- al destino original del intento. No contiene conexión, DDL ni filas comerciales.
-- Confirmar antes que terminó la transacción de instalación anterior:
-- ausencia visible durante una transacción todavía abierta no acredita rollback.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL TIME ZONE 'UTC';
SELECT current_database() AS database_name,
       current_user AS diagnostic_role,
       current_setting('server_version') AS server_version,
       clock_timestamp() AS observed_at_utc;
SELECT to_regnamespace('mayorista') IS NOT NULL AS operational_exists,
       to_regnamespace('mayorista_private') IS NOT NULL AS private_exists,
       to_regclass('mayorista_private.release_migrations') IS NOT NULL AS ledger_exists,
       to_regclass('mayorista_private.release_binding') IS NOT NULL AS binding_exists
\gset recovery_
\echo operational_exists=:recovery_operational_exists private_exists=:recovery_private_exists ledger_exists=:recovery_ledger_exists binding_exists=:recovery_binding_exists
\if :recovery_binding_exists
SELECT profile_hash, project_id, environment_id
FROM mayorista_private.release_binding
WHERE id = true;
\endif
\if :recovery_ledger_exists
SELECT version, source_hash
FROM mayorista_private.release_migrations
ORDER BY version;
\endif
ROLLBACK;
