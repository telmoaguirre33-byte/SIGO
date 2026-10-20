-- PREPARADO, NO EJECUTADO. Sólo si el catálogo ya confirmó AMBAS tablas.
-- Historial técnico y binding, sin filas comerciales ni secretos.
-- Si no hay tablas, NO crearlas para que este archivo pase.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT version,source_hash,installed_at FROM mayorista_private.release_migrations ORDER BY version;
SELECT id,profile_hash,project_id,environment_id FROM mayorista_private.release_binding ORDER BY id;
ROLLBACK;
