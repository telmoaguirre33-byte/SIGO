# Pipeline de migraciones: preflight de solo lectura

## Cambio deliberado del pipeline

`.github/workflows/supabase-production.yml` ya **no despliega** al recibir un push a `main` ni al invocarse manualmente. Ambos eventos ejecutan únicamente un preflight de metadatos y lint de solo lectura. Se retiraron `db push --include-all`, la reparación automática de versiones y el PATCH de configuración Auth. La sincronización de dominio tiene su workflow separado, no modificado por este cambio.

No hay un input, un modo alternativo o un dispatch que permita ejecutar SQL libre, aplicar migraciones, marcar versiones aplicadas/revertidas o cambiar Auth. La publicación de esta corrección cambia el pipeline y debe revisarse como tal. No configura protecciones de rama, entornos, credenciales ni permisos remotos; tampoco controla el despliegue de frontend de Vercel.

El CI de producto de los PR sigue ejecutando build, tests de Caja/fiscal, navegador, impresión y verificadores. Incorpora pruebas sintéticas del gate, sin secretos ni conexión comercial. Un fallo del preflight productivo es un bloqueo de activación separado de esos tests de producto. No se oculta con `continue-on-error`.

## Motivo y resultado esperado

La comparación de metadatos del 22/10/2026 encontró 101 archivos locales y 107 registros remotos: 17 pendientes locales, de los que 3 son candidatas nuevas y 14 son históricas, además de 23 versiones remotas sin archivo. Que algunos nombres coincidan con timestamps diferentes **no demuestra equivalencia del SQL**.

El gate inventaría todos los archivos y compara todas las versiones y nombres. Rechaza archivos inesperados, duplicados, datos incompletos y cambios de hash/nombre en las tres candidatas revisadas. No basta que las tres nuevas aparezcan aplicadas para ignorar las otras discrepancias.

- Salida 1: entrada inválida, consulta incompleta/no read-only o hash revisado distinto.
- Salida 2: `BLOCKED_HISTORY_DRIFT`, por cualquier pendiente ajena a las tres, remoto sin archivo o nombre distinto para una misma versión.
- Salida 3: `BLOCKED_PENDING_EXPLICIT_APPLICATION`, aunque únicamente falten las tres candidatas revisadas.
- Salida 0: solo `HISTORY_ALIGNED_ONLY`. **No autoriza producción**, no acredita equivalencia del esquema/SQL histórico, backup recuperable, autorización fiscal ni estado de RLS.

Con el estado 101/107 conocido, el resultado correcto continúa siendo bloqueo. Esta corrección no pretende convertirlo en verde alterando el historial.

## Solo estas tres candidatas, pendientes de aplicación expresa

1. `supabase/migrations/20261022024847_manual_medidas_atomicas.sql`
   SHA-256: `d525682cf0ac327221a389f4668748b40d6fd81e0a31b70c79e5b05a59312c21`
2. `supabase/migrations/20261022030000_arca_impresion_snapshot.sql`
   SHA-256: `618c790bb7295af54a7d75a3e87819112d879a80b81d85feabcb9982ec41eb19`
3. `supabase/migrations/20261022030500_arca_impresion_config.sql`
   SHA-256: `ed3ed8a67948949a922f35722a0224b55ee4d0dd7dd04554c7e20344dbed7972`

La lista está fijada también en `scripts/check-production-migrations.mjs`. Es una lista de revisión, no una autorización ni un aplicador. Cambiar cualquiera de estos bytes exige nueva revisión. Los scripts manuales de RLS/hardening fiscal quedan fuera de esta lista y conservan sus autorizaciones separadas.

## Procedimiento antes de una aplicación explícita

1. Registrar autorización concreta del responsable para proyecto, commit, archivos y hashes, ventana de cambio, reversión y verificaciones posteriores. Verificar backup/recuperación: no se ha acreditado su disponibilidad mediante este preflight.
2. Revisar el desacuerdo completo entre archivos e historial. No renombrar versiones, no ejecutar `migration repair` ni marcar las 14 históricas basándose solo en nombres o fechas. Cualquier reconciliación requiere propuesta, evidencia de equivalencia y autorización propias.
3. Mantener el bloqueo mientras haya discrepancias sin resolver. Si se propone aplicar las tres por un mecanismo selectivo independiente, revisar y probar previamente ese mecanismo y su registro de versiones, sin reejecutar otras migraciones ni reescribir historia anterior. **Este cambio no incorpora ese mecanismo ni lo autoriza.** No usar como atajo `db push --include-all`, `migration up`, carpetas con placeholders o SQL genérico.
4. Tras una aplicación expresamente aprobada, verificar versiones/nombres, funciones y permisos esperados con lecturas. Ejecutar nuevamente el preflight. Si persiste cualquier diferencia, conservar el bloqueo: no reparar automáticamente para conseguir éxito.
5. Merge, despliegue del frontend, scripts de seguridad, flags y emisión fiscal real siguen siendo decisiones separadas. No activar la interfaz nueva contra una base sin las funciones requeridas.

## Conexión y lint

Se conservan la precedencia URL configurada → pooler configurado → conexión directa y el fallback acotado a poolers de Supabase. Las credenciales se enmascaran; no se necesita token de Management. La consulta fija usa `BEGIN READ ONLY`, `ROLLBACK`, `ON_ERROR_STOP`, tiempo limitado y únicamente `supabase_migrations.schema_migrations`. No consulta filas comerciales. `PGOPTIONS` añade un default read-only, pero no es un reemplazo de permisos de base de datos contra SQL arbitrario.

El lint se ejecuta incluso si falla la comparación de historial, sin cambiar ese resultado. Usa la extensión `plpgsql_check` **solo si ya existe**, en una transacción read-only, con la cobertura PL/pgSQL/no-trigger y exclusiones de esquemas administrados del linter oficial. No instala extensiones. Si falta, falla con `LINT_EXTENSION_MISSING`; si hay errores o el chequeo no puede terminar, falla sin certificar lint. Los diagnósticos detallados no se imprimen en los logs públicos.

Esto evita que el comando CLI `db lint` intente `CREATE EXTENSION`, aunque ese comando normalmente revierta su transacción. Ver fuentes oficiales: [semántica de db push y --include-all](https://supabase.com/docs/reference/cli/supabase-db-push), [efectos del lint v2.121.0](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/db/lint/SIDE_EFFECTS.md) y [consulta de lint](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/db/lint/lint.lint-sql.ts).

## Pruebas reproducibles sin producción

Desde la raíz del repositorio:

```sh
node --test scripts/test-production-migration-gate.mjs
node scripts/verify-production-readiness.mjs
```

La suite cubre el desacuerdo 101/107 mediante metadatos sin datos comerciales, escenarios alineados/pendientes, hashes alterados, nombres/timestamps incompatibles, duplicados, JSON inválido, mutaciones negativas del workflow y el shell de conexión con `psql` simulado y sin red. No ejecuta SQL de migraciones ni aplicaciones productivas.
