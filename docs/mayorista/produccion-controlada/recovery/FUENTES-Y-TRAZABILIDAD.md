# Fuentes y trazabilidad de la preparación

Consulta: 2026-10-20 UTC. Se aplicó la skill [Supabase](skill://plugin_asdk_app_69d3e5ee6a708191baa733f7b8931995/supabase/SKILL.md) para verificar documentación vigente y la skill de entorno administrado para leer su política de red. Esas instrucciones no aportan evidencia de backup del proyecto.

## Documentación oficial consultada

| Fuente | Uso concreto |
| --- | --- |
| [Database Backups](https://supabase.com/docs/guides/platform/backups) | Tipos de backup, selección de punto, límites de Storage/passwords y distinción configuración/recuperación |
| [Management API — List all backups](https://supabase.com/docs/reference/api/v1-list-all-backups) | GET de metadata real, scopes/permisos y campos de respuesta; no se llamó contra COMERCIAL |
| [CLI — db dump](https://supabase.com/docs/reference/cli/supabase-db-dump) | Filtros de esquemas administrados, flags explícitos de datos/roles y riesgo de privilegios por defecto |
| [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) | Conexión sesión/directa; piezas separadas de roles/esquema/datos y revisión del restore |
| [Restore platform to self-hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform) | Compatibilidad/versiones y límites de Auth/llaves/configuración/Storage |
| [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project) | Crea proyecto facturable; copia de base y reconfiguración adicional |
| [PITR usage](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery) | Add-on facturable; no se habilitó |
| [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [pg_dumpall](https://www.postgresql.org/docs/current/app-pg-dumpall.html), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html), [service file](https://www.postgresql.org/docs/current/libpq-pgservice.html) | Snapshot, SQL/archive, roles sin passwords, selección/revisión del restore y conexión sin credenciales en argumentos |

Las páginas PostgreSQL `current` consultadas corresponden al major 18 en la fecha de lectura; la preparación no presupone que COMERCIAL use ese major. Los comandos se deben contrastar con la ayuda/versiones instaladas por el custodio. No había `pg_dump` disponible en el ejecutor y no se instaló ninguna herramienta.

## Changelog vigente y efectos sobre recuperación

El intento inicial de `curl https://supabase.com/changelog.md` falló porque el proxy local no aceptó conexión; el navegador de investigación tampoco procesó ese MIME markdown. Se leyó el [índice HTML del changelog](https://supabase.com/changelog) y se abrieron las entradas relevantes:

- [Restricciones Auth/Storage/Realtime de 2025](https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025): no tratar el dump de internals como DDL libremente aplicable a un proyecto administrado.
- [Realtime restringido en 2026](https://supabase.com/changelog/realtime-schema-locked-down-against-modification): no recrear/eliminar sus objetos para reparar un restore.
- [Versiones de extensiones](https://supabase.com/changelog/extension-version-pinning-ignored): el pinning SQL no garantiza la versión de destino; comparar `extversion` efectiva y compatibilidad. La entrada indica que no altera por sí misma los backups/restores.
- [Corrección de backups diarios omitidos](https://supabase.com/changelog/bulk-prepare-retry-on-transient-failure): motivo adicional para exigir listado/estado real del backup, sin inferir un backup exitoso del cron configurado. No se afirma que COMERCIAL haya sufrido ese problema.

## Lectura local

Directorio fuente: `/workspace/PR78-BACKEND-LINK`; no es un checkout Git verificable en esta sesión. No se escribieron esos archivos.

- `docs/mayorista/preproduccion/PROCEDIMIENTO-BACKUP-RESTORE.md`: conserva separación backup local/proveedor y recuperación no destructiva; cita candidato histórico `2519719c…`.
- `PROCEDIMIENTO-PUBLICACION-FUTURA.md` y `PUBLICACION-Y-RECUPERACION.md`: contienen exclusión de QA, secuencia de publicación y límites de fixtures; incluyen estados de épocas diferentes, no se trasladaron automáticamente al PR actual.
- `EVIDENCIA-CIERRE-2519719c.json`: declara ensayo PostgreSQL 17 CI y varios SHA de preparación/runtime; no es una constancia de restore del proveedor.
- `src/modules/mayorista/backend/commercial-migrations.mjs:22`: wrapper explícito de instalación; `:31` núcleo transaccional; `:44` binding; `:46` ledger; `:49` COMMIT/catch.
- `src/modules/mayorista/tests/commercial-migrations-postgres.mjs:8`: conexión CI localhost; `:13` llamada directa al núcleo; `:38` fallo inducido y rollback; `:50` ledger/no-op; `:60` drift/parcial.
- `src/modules/mayorista/backend/commercial-runtime.mjs:33`: readiness de lectura y `productionAcceptance:false`.
- `.github/workflows/mayorista-isolated.yml`: PostgreSQL 17 efímero y ejecución del ensayo; la lectura del workflow no acredita su resultado para el candidato.

## Catálogo de herramientas Supabase inspeccionado

Había herramientas de proyecto/organización, tablas/extensiones/migraciones, advisors, consulta SQL/logs, ramas, funciones, `restore_project` y acciones de administración. No había `list_backups`, consulta de ventana PITR, restore por backup/timestamp ni exportación lógica. No se ejecutó ninguna herramienta de administración ni consulta de datos del proyecto en este subtrabajo. `search_docs` se utilizó únicamente para documentación oficial pública.

La ausencia de una herramienta no implica inexistencia del servicio o del backup. El GET de Management API existe en la documentación, pero sus credenciales/permisos y respuesta para COMERCIAL no fueron observados. `restore_project(project_id)` no lleva backup/timestamp y no se utilizó para sondear disponibilidad.
