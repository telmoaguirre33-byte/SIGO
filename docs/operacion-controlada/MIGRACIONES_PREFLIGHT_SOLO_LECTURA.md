# Pipeline de migraciones: preflight de solo lectura

## Cambio deliberado del pipeline

`.github/workflows/supabase-production.yml` ya **no despliega** al recibir un push a `main` ni al invocarse manualmente. Ambos eventos ejecutan únicamente un preflight de metadatos y lint de solo lectura. Se retiraron `db push --include-all`, la reparación automática de versiones y el PATCH de configuración Auth. La sincronización de dominio tiene su workflow separado, no modificado por este cambio.

No hay un input, un modo alternativo o un dispatch que permita ejecutar SQL libre, aplicar migraciones, marcar versiones aplicadas/revertidas o cambiar Auth. El cambio inicial de PR97 convirtió el pipeline en preflight; la reconciliación de V4 no modifica sus workflows. No configura protecciones de rama, entornos, credenciales ni permisos remotos; tampoco controla el despliegue de frontend de Vercel.

El CI de producto de los PR sigue ejecutando build, tests de Caja manual/recuperación, navegador y verificadores existentes de main. Incorpora pruebas sintéticas del gate, sin secretos ni conexión comercial. Un fallo del preflight productivo es un bloqueo de activación separado de esos tests de producto. No se oculta con `continue-on-error`.

## Motivo y resultado esperado

La captura anterior a la activación, leída el 22/10/2026, contiene 107 registros. Al compararlos con los 99 archivos locales del candidato peso-only quedan: 15 pendientes locales, de los que 1 es la candidata V4 nueva y 14 son históricas, además de 23 versiones remotas sin archivo. Que algunos nombres coincidan con timestamps diferentes **no demuestra equivalencia del SQL**.

El 23/10/2026 la aplicación selectiva de V4 registró la versión `20261023144934`, nombre `manual_medidas_atomicas_guarded`. Se reconcilia exclusivamente ese nuevo registro mediante el nombre del archivo local; no se modifica el historial remoto. El escenario posterior es 99 archivos / 108 registros, con V4 ya no pendiente y las mismas 14 pendientes históricas y 23 versiones remotas sin archivo. El fixture anterior 99/107 se conserva intacto y las pruebas agregan el registro real por separado.

El gate inventaría todos los archivos y compara todas las versiones y nombres. Rechaza archivos inesperados, duplicados, datos incompletos y cambios de hash/nombre en V4. También rechaza restaurar su ID local original o duplicar su SQL bajo otro timestamp. No basta que V4 aparezca aplicada para ignorar las otras discrepancias.

- Salida 1: entrada inválida, consulta incompleta/no read-only o hash revisado distinto.
- Salida 2: `BLOCKED_HISTORY_DRIFT`, por cualquier pendiente ajena a V4, remoto sin archivo o nombre distinto para una misma versión.
- Salida 3: `BLOCKED_PENDING_EXPLICIT_APPLICATION`, aunque únicamente falte la candidata V4 revisada.
- Salida 0: solo `HISTORY_ALIGNED_ONLY`. **No autoriza producción**, no acredita equivalencia del esquema/SQL histórico, backup recuperable, autorización fiscal ni estado de RLS.

Tanto con la captura anterior 99/107 como con el escenario posterior 99/108, el resultado correcto continúa siendo bloqueo. Esta corrección no pretende convertirlo en verde alterando el historial ni presume que una consulta productiva fallida haya validado metadatos o lint.

## Solo V4: identidad registrada y SQL canónico preservado

- Archivo vigente: `supabase/migrations/20261023144934_manual_medidas_atomicas_guarded.sql`.
- Archivo fuente de PR97, retirado únicamente por renombrado: `supabase/migrations/20261022024847_manual_medidas_atomicas.sql`.
- SHA-256 canónico, idéntico antes y después: `d525682cf0ac327221a389f4668748b40d6fd81e0a31b70c79e5b05a59312c21`.
- SHA-256 de la única sentencia protegida efectivamente aplicada: `c572b9e11d4326192ac0e1878a3e7b66f61fb24513727df857a4e5190a0065f6`.
- Registro API verificado por lectura posterior el 23/10/2026 a las 14:49 UTC: `20261023144934` / `manual_medidas_atomicas_guarded`.

El wrapper aplicado encapsuló el cuerpo canónico entre guardas y bloqueos específicos del estado productivo anterior. **No tiene los mismos bytes que el archivo canónico** y no se usa como migración de instalación nueva: esas precondiciones no son portables. Se conserva el SQL completo y ejecutable, no un placeholder ni un archivo vacío. Sus comentarios de candidato son históricos y se preservan para mantener el hash; no describen el estado actual ni conceden autorización.

La identidad real y ambas huellas están fijadas en `V4_RECONCILIATION`, en `scripts/check-production-migrations.mjs`. La lista de revisión no es autorización ni aplicador. No hay alias por nombre ni excepción general de timestamps: solo se renombra este archivo para que herramientas que comparan versiones no vuelvan a proponer V4. Cambiar sus bytes exige nueva revisión. El script manual de RLS de productos queda fuera de esta lista y conserva su autorización separada. No se incluye ningún hardening ni migración fiscal nueva.

## Procedimiento para cualquier aplicación posterior o en otro entorno

1. Registrar autorización concreta del responsable para proyecto, commit, archivos y hashes, ventana de cambio, reversión y verificaciones posteriores. Verificar backup/recuperación: no se ha acreditado su disponibilidad mediante este preflight.
2. Revisar el desacuerdo completo entre archivos e historial. No renombrar versiones históricas, no ejecutar `migration repair` ni marcar las 14 históricas basándose solo en nombres o fechas. El renombrado local de V4 documentado arriba se limita a su registro nuevo, comprobado y explícito; no es precedente para las históricas. Cualquier reconciliación requiere propuesta, evidencia de equivalencia y autorización propias.
3. Mantener el bloqueo mientras haya discrepancias sin resolver. V4 ya está aplicada en COMERCIAL: no volver a ejecutarla. En otro entorno, cualquier aplicación selectiva exige revisar y probar previamente su mecanismo y registro de versiones, sin reejecutar otras migraciones ni reescribir historia anterior. **Este cambio de versionado no incorpora un mecanismo de aplicación ni lo autoriza.** No usar como atajo `db push --include-all`, `migration up`, carpetas con placeholders o SQL genérico.
4. Tras una aplicación expresamente aprobada, verificar versiones/nombres, funciones y permisos esperados con lecturas. Ejecutar nuevamente el preflight. Si persiste cualquier diferencia, conservar el bloqueo: no reparar automáticamente para conseguir éxito.
5. Merge, despliegue del frontend, scripts de seguridad, flags y emisión fiscal real siguen siendo decisiones separadas. Este candidato preserva el comportamiento fiscal existente de main. No activar la interfaz nueva contra una base sin las funciones requeridas.

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

La suite cubre el desacuerdo anterior 99/107 y el posterior 99/108, conserva exactamente las 14 pendientes históricas y 23 remotas y rechaza la reintroducción o copia de V4. Usa metadatos sin datos comerciales, escenarios alineados/pendientes, hashes alterados, nombres/timestamps incompatibles, duplicados, JSON inválido, mutaciones negativas del workflow y el shell de conexión con `psql` simulado y sin red. No ejecuta SQL de migraciones ni aplicaciones productivas.

Validación PostgreSQL 17.6 sintética de la misma consulta y lint: la consulta de historial y los bloqueos reales de escritura pasaron; la ausencia de `plpgsql_check` produjo el error esperado sin instalarla. **El camino exitoso del lint no se probó**, porque esa extensión no estaba instalada. Esto no sustituye la validación de lint del entorno objetivo.
