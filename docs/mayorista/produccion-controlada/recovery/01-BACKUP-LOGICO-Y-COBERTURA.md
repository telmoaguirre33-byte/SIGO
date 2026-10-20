# Backup lógico adicional y custodia

Procedimiento preparado, **no ejecutado**. El backup lógico es una protección adicional de PostgreSQL. Su recuperabilidad en Supabase administrado depende de revisar objetos, versiones, permisos y restaurarlo; no sustituye la evidencia del proveedor ni recupera por sí solo todo el servicio.

## Canal y entorno del operador

1. Usar estación administrada por el custodio, fuera de CI, del chat y de QA, con volumen cifrado y directorio privado nuevo. No escribir dumps, logs o listados sensibles en este repositorio, Drive compartido, artifacts de Actions, Excel, tickets o archivos públicos. Mantener una copia cifrada fuera del origen y con acceso independiente del servicio recuperado.
2. Emplear conexión existente ya autorizada de backup, separada del runtime. Verificar proyecto `pafnbxfgpedbvpimjmun`, base `postgres`, host/puerto exactos y TLS `verify-full` con CA válida. Para herramientas de backup usar conexión directa o pooler de sesión compatible; no reutilizar por costumbre el pooler transaccional del runtime. La guía de migración indica sesión o conexión directa. [Supabase CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
3. Resolver credenciales mediante archivo de servicio libpq privado y passfile `0600`, o el mecanismo de secretos ya habilitado. La entrada `sigo_backup_source` identifica inequívocamente el origen. Separar `sigo_recovery_target` en otro archivo para evitar conexión accidental. No imprimir archivos ni variables de conexión. No pasar URLs con contraseña en argumentos, activar `set -x`, guardar secretos en historial ni resetear credenciales productivas para facilitar la exportación. [Connection service file](https://www.postgresql.org/docs/current/libpq-pgservice.html).
4. Confirmar versión real del servidor, `pg_dump`, `pg_restore` y `pg_dumpall`; elegir cliente compatible, preferentemente mismo major y patch de seguridad vigente. Un cliente anterior al major del servidor no es una alternativa válida. No descargar herramientas sin fijar versión y procedencia. Este entorno no dispone de esos binarios; no se instalaron ni se validó un CLI concreto.
5. Acordar ventana y carga. Un dump lee datos y toma locks de lectura; puede competir con DDL o sostener una transacción larga. No paralelizarlo ni elevar privilegios del runtime. Si el rol de backup no puede exportar un objeto requerido o RLS impide lectura completa, abortar y registrar cobertura incompleta. No resolverlo con `--enable-row-security`, exclusiones silenciosas o BYPASSRLS del runtime.

## Inventario antes de exportar

El custodio registra en manifiesto privado: origen y fecha UTC; versiones; esquemas/tablas/particiones y secuencias esperadas; extensiones y versiones; propietarios; funciones/triggers; grants, membresías y privilegios por defecto; policies y RLS; large objects o datos externos si existen; publicaciones/suscripciones; ledger y binding Mayorista si ya existen. Identificar también todo esquema canónico SIGO compartido: respaldar sólo `mayorista` perdería ventas, stock, caja y cuenta corriente.

`pg_dump` mantiene un snapshot MVCC consistente de los datos de **una base** y no exporta los roles globales. Las secuencias no siguen MVCC y pueden avanzar durante la exportación. Tampoco sincroniza roles, configuración externa y archivos Storage. Registrar inicio/fin y congelar o conciliar cambios de DDL/configuración/archivos durante la ventana; dos dumps sucesivos no tienen el mismo corte. [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

La plantilla siguiente usa el snapshot interno de `pg_dump`; no lo exporta para consultas posteriores. Una huella de referencia del mismo corte exige una ventana quiescente autorizada que abarque huella y exportación, o un procedimiento de snapshot compartido `pg_export_snapshot` / `pg_dump --snapshot` validado por el custodio. En ambos casos, conciliar por separado secuencias y piezas externas; no afirmar que un conteo posterior participa del snapshot del dump.

## Plantilla de exportación lógica segura

Sólo para el operador cuando ya exista una ventana de backup autorizada. Cada paso debe terminar con código cero antes de continuar; conservar stderr privado y resolver cualquier warning. La ruta y los archivos de conexión siguientes son marcadores privados que se deben completar; no son recursos creados por este paquete.

```bash
set -euo pipefail
umask 077
: "${SIGO_BACKUP_DIR:?Directorio NUEVO y privado en volumen cifrado}"
: "${SIGO_BACKUP_SERVICE_FILE:?Archivo de servicio privado revisado}"
: "${SIGO_BACKUP_PASS_FILE:?Passfile privado existente}"
test ! -e "$SIGO_BACKUP_DIR"
mkdir -m 700 -- "$SIGO_BACKUP_DIR"

PGSERVICEFILE="$SIGO_BACKUP_SERVICE_FILE" \
PGPASSFILE="$SIGO_BACKUP_PASS_FILE" \
pg_dump --dbname='service=sigo_backup_source' --no-password \
  --format=custom --lock-wait-timeout=5s \
  --file="$SIGO_BACKUP_DIR/database.dump" \
  2>"$SIGO_BACKUP_DIR/pg_dump.stderr.private.log"

PGSERVICEFILE="$SIGO_BACKUP_SERVICE_FILE" \
PGPASSFILE="$SIGO_BACKUP_PASS_FILE" \
pg_dumpall --dbname='service=sigo_backup_source' --no-password \
  --roles-only --no-role-passwords \
  --file="$SIGO_BACKUP_DIR/roles-without-passwords.sql" \
  2>"$SIGO_BACKUP_DIR/pg_dumpall.stderr.private.log"

test -s "$SIGO_BACKUP_DIR/database.dump"
test -s "$SIGO_BACKUP_DIR/roles-without-passwords.sql"
pg_restore --list --file="$SIGO_BACKUP_DIR/database.toc.private.txt" \
  "$SIGO_BACKUP_DIR/database.dump"
pg_restore --file="$SIGO_BACKUP_DIR/database.sql" \
  "$SIGO_BACKUP_DIR/database.dump" \
  2>"$SIGO_BACKUP_DIR/pg_restore-offline.stderr.private.log"
test -s "$SIGO_BACKUP_DIR/database.sql"
sha256sum -- "$SIGO_BACKUP_DIR/database.dump" \
  "$SIGO_BACKUP_DIR/database.sql" \
  "$SIGO_BACKUP_DIR/roles-without-passwords.sql" \
  > "$SIGO_BACKUP_DIR/checksums.private.sha256"
```

El SQL se genera **sin conexión** desde el mismo archive; así comparte sus datos y no exige otra lectura de datos productivos. Se conservan owners, ACL, RLS y valores de secuencias exportados; no usar flags que los omitan para conseguir un PASS. La exportación de roles es separada y debe conciliarse contra el inventario. `--no-role-passwords` omite passwords/hashes de roles PostgreSQL **en ese archivo**; `database.dump` y `database.sql` pueden contener hashes de usuarios y otros datos sensibles de Auth. Las contraseñas faltantes necesitan un procedimiento privado de recuperación/rotación antes de reabrir. Nunca aplicar sin revisión el SQL de roles administrados de Supabase. [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html), [pg_dumpall](https://www.postgresql.org/docs/current/app-pg-dumpall.html).

Un archive crudo puede contener objetos administrados que no se pueden recrear directamente en otro Supabase. Debe preservarse como original y producirse un plan de restore específico, revisado y con hash propio; no modificar el original, ignorar errores de permisos ni usarlo como instalador productivo. El CLI Supabase filtra esquemas administrados; su dump por defecto no incluye datos ni roles propios. La cobertura de Auth/Storage en exportaciones separadas depende del comando y versión concretos: revisar contenido generado e inventario en vez de inferirla por el nombre `data.sql`. [Referencia `db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump).

## Paquete privado que se debe custodiar

| Pieza | Cobertura que debe declararse |
| --- | --- |
| `database.dump`, `database.sql`, catálogo, logs y hashes | Esquemas y datos incluidos efectivamente; errores, exclusiones y dependencias externas |
| Roles sin passwords e inventario de owners/grants | Roles propios, membresías y ACL; procedimiento separado de credenciales |
| Auth | Tablas/identidades/sesiones realmente incluidas y método de recuperación de configuración, proveedores OAuth, SMTP, URLs y llaves |
| Storage | Objetos binarios/versiones en canal privado, bucket/path, tamaño, checksum de contenido y permisos/configuración; ETag multipart no equivale necesariamente a SHA-256 |
| Runtime y frontend | Imagen/digest/SHA compatibles, assets, perfil no secreto y hash, dominios/CORS y versiones; secretos del runtime en bóveda separada |
| Fiscalidad/integraciones | Referencias privadas de llaves/certificados ARCA, callbacks, cobros y tareas; nunca sus valores dentro del paquete público |

El backup de base conserva metadata de Storage, no los bytes de sus objetos, y los backups diarios no guardan passwords de roles propios. Las llaves/configuración externas deben tener custodia aparte. [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups).

Guardar manifiesto y cifrado con el mecanismo institucional ya aprobado; verificar descifrado por el custodio independiente, checksum y control de acceso. Transferir por canal privado cifrado, sin URLs públicas o secretos en el nombre. Publicar sólo identificador opaco, fecha, cobertura, estado y referencias privadas de evidencia. La existencia de archivos, su tamaño o la lectura del catálogo prueban exportación/legibilidad; la restauración y conciliación son un control adicional obligatorio.
