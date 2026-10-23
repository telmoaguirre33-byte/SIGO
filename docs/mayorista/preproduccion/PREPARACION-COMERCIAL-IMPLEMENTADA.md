# Avance técnico posterior a d313ce56 — no autoriza publicar

Este documento actualiza los bloqueos de código del informe PUBLICACION-Y-RECUPERACION.md. No altera la aceptación funcional previa ni declara aprobación comercial. No se aplicaron migraciones, perfiles ni configuración remota.

## Runtime separado

`backend/commercial-server.mjs` es una entrada explícita distinta del servidor QA. Reutiliza transporte HTTP, aplicación, autenticación, cotización, pedidos y sincronización existentes. El Dockerfile conserva el CMD de QA; no se modifica Railway. La entrada comercial no importa semillas, resets ni el vínculo entre empresa SIGO real y empresa sintética. Siempre exige fuente SIGO en la misma base de datos; no replica tablas comerciales a Railway.

`commercial-runtime.mjs` exige modo commercial y opt-in de producción, perfil aprobado con hash exacto, IDs Railway distintos de QA e iguales a los IDs reales del proceso, host/ref Supabase y usuario de conexión explícitos, TLS con CA/hostname verificados, llave Ed25519 cuyo fingerprint coincida con el perfil, issuer por destino, orígenes HTTPS exactos y clave Auth pública. Rechaza variables de bootstrap/QA/aceptación y conexiones alteradas. Pool máximo seis; admite conexión directa o pooler transaccional, no statement pooling. El perfil de ejemplo queda approved=false y con destinos nulos.

Readiness comprueba rol runtime sin SUPERUSER/BYPASSRLS ni membresía en roles privilegiados, DB real, binding de perfil/destino, 21 versiones/hashes de SQL compilado, RLS forzado y funciones/fuente canónica presentes. No depende de la evidencia sintética P0 ni declara aceptación productiva: responde ready_for_pilot_acceptance. Un destino no instalado o divergente bloquea arranque.

Variables futuras adicionales: `MAYORISTA_RUNTIME_MODE=commercial`, `MAYORISTA_PRODUCTION_ENABLED`, `MAYORISTA_RELEASE_PROFILE_PATH`, `MAYORISTA_RELEASE_PROFILE_SHA256`. Secretos de servidor: DATABASE_URL, MAYORISTA_AUTH_PRIVATE_KEY y CA; Auth y dominios deben corresponder al perfil. No hay valores reales nuevos configurados. La llave privada y las credenciales no pertenecen al perfil ni al frontend.

## Frontera de privilegios

El runtime usa un rol backend específico, distinto del rol migrador. Las operaciones comerciales normales conservan SET LOCAL ROLE authenticated, claims validados y RLS. Las excepciones del backend para validar identidad SIGO/canonical y administrar accesos quedan en funciones privadas SECURITY DEFINER con search_path vacío, privilegio EXECUTE exclusivo del rol backend, controles de empresa/módulo/membresía y sesión gerencial para directorio. No se conceden estos helpers a PUBLIC, anon ni authenticated.

El bootstrap de identidad sólo se llama después de validar el token SIGO contra Auth remoto; comprueba email/usuario canónicos, empresa activa, owner/admin y flag. Reutiliza la identidad, rechaza revocación o fuente con movimientos no conciliados y nunca restablece una contraseña existente. El directorio aplica claims de la sesión antes de consultar; la política adicional del backend sólo abre la empresa que una sesión gerencial vigente tiene autorizada. No agrega permisos funcionales a vendedores/choferes.

## Migraciones versionadas preparadas

`prepareCommercialMigrations(runtimeRole)` verifica hashes de las veinte fuentes canónicas, elimina sólo sus envoltorios BEGIN/ROLLBACK, conserva dependencias, omite la creación duplicada del esquema privado y endurece search_path=public a vacío. Rechaza scaffolding auth/roles. Agrega versión 21 para frontera backend, grants explícitos y política de directorio. No ejecuta SQL ni abre conexiones.

`installCommercialMigrations` se invoca sólo explícitamente por operador, nunca por el servidor/build. Exige perfil aprobado, texto/hash coincidentes, aprobación de acción concreta, pool con host/puerto/DB/usuario migrador/TLS correspondientes y destino distinto de QA. Comprueba DB/rol reales, usa lock y timeouts, crea binding y ledger privados y aplica todo en una transacción. Instalación repetida con 21 hashes idénticos es no-op. Divergencia, estado parcial o esquema Mayorista previo sin ledger abortan; no se adopta ni pisa un esquema existente automáticamente. Sin DROP/down migration ni seed. Un esquema previo exige reconciliación específica revisada.

Esto completa un instalador versionado en código para una instalación nueva del módulo, no demuestra compatibilidad con el esquema productivo actual. El ensayo integral de las 21 versiones se ejecutó en PostgreSQL 17 de CI sobre un esquema compatible aislado, reutilizando las fuentes canónicas de ventas/clientes/cobros/devoluciones. Se comprobó instalación, repetición no-op, hashes, rechazo de ledger divergente/parcial y rollback real tras un fallo en la versión 21, conservando registros Minorista preexistentes. Falta comparar y ensayar contra una copia autorizada del esquema del destino real, advisors, grants/ownership y recuperación del proveedor. No existe autorización ni destino comercial activo. Los tests unitarios de aprobación/perfil/TLS usan dobles; el ensayo comercial-migrations-postgres ejecuta el mismo núcleo transaccional del instalador sobre PostgreSQL real. Este ensayo no valida TLS ni credenciales externas y no relaja los controles del punto de entrada productivo. Las pruebas de adaptadores sí ejecutan SQL y roles limitados en PostgreSQL CI.

## Vendedor sin UUID manual

Fuera del origen QA, el login pide email y contraseña. POST /auth/companies valida scrypt antes de devolver sólo empresas activas del vendedor autenticado; no entrega tokens ni crea sesiones. Una empresa se selecciona internamente; varias se muestran por nombre. No hay búsqueda pública por email/empresa, ni inferencia desde el navegador. Al ingresar se revalidan credenciales, membresía, permisos y fuente. Una empresa revocada se rechaza aunque hubiera sido listada antes.

Durante la selección de varias empresas, las credenciales se conservan sólo en memoria y por un plazo acotado (dos minutos más el intervalo de limpieza), se descartan al cancelar, finalizar o destruir la pantalla y no se escriben en IndexedDB, URLs ni logs. La preparación cifrada y reapertura offline siguen usando los mecanismos existentes. No se cambia versión/stores de IndexedDB ni se envía automáticamente ningún pedido.

El selector de cuentas sintéticas sigue sólo en QA. Los dos pedidos físicos no se leen ni utilizan en estos ensayos.

## Validación y pendientes

- Unitarias: perfil/origen/TLS/hash, rechazo de QA/seed/secret keys/roles privilegiados; SQL versionado, reintento no-op, drift y rollback de fallo mediante dobles.
- PostgreSQL CI: las 21 migraciones, ledger, repetición y rollback real; adaptadores con rol NOSUPERUSER NOBYPASSRLS, descubrimiento con contraseña, aislamiento, catálogo, SSO (Auth externo simulado), directorio y revocación; helper privado inaccesible a anon.
- API/UI existentes: regresión completa, primer login sin empresa escrita, cifrado/reapertura/offline/UUID e idempotencia.
- Pendientes externos: target/perfil/credenciales comerciales autorizados; ensayo de instalación completa sobre esquema real y advisors; smoke publicado/p95; backups/restore; alcance comercial/fiscal y políticas de prueba/suscripción; checklist físico postergado.

No hay GO para vender ni publicar aún. El runtime y primer acceso dejan de ser sólo una descripción pendiente; su habilitación real y la validación del destino siguen bloqueadas hasta las aprobaciones/evidencias anteriores. No se activa cobro, ARCA productiva, main, merge ni infraestructura.


## Cierre automatizable del ensayo de migraciones — 2026-10-18

Código validado: `200b0c70d7bad7b7101c366a6965512b16aaac34` (sobre `8ba94204`).
[CI integral aprobado](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/39087434499): TypeScript/build, siete controles RLS, 97 controles API/PostgreSQL, nuevo ensayo de migraciones, 58 controles de interfaz, Chromium/IndexedDB/offline y Docker. Build SIGO y Matriz aprobados. Compra IA mantiene su fallo previo; no se cambió Compras ni se presenta el conjunto de workflows como verde.

Se separó el núcleo transaccional de la comprobación de conexión: la entrada comercial conserva aprobación, hash y TLS estricto antes de conectarse. El ensayo CI invoca ese mismo núcleo sobre la conexión fija localhost y esquemas aleatorios propios; no toma credenciales de entorno ni conecta a Railway/Supabase. La adaptación de namespace también cubre to_regnamespace, para no confundir esquemas globales del job con el módulo bajo ensayo.

El fallo intencional se produce en la última versión; PostgreSQL revierte tablas, grants, binding y ledger. La ejecución siguiente instala las 21 versiones completas y otra ejecución devuelve reused=true, sin siembra. Se comprueban hashes y RLS forzada, conservación de empresas/productos/clientes y cero pedidos/activaciones creados por el instalador. La limpieza sólo elimina los esquemas CI aleatorios y el rol CI propios. Ningún test utiliza la empresa persistente ni los dos pedidos Android.

### Matriz de preparación

| Función | Código y prueba automatizada | Prueba física pendiente | Dependencia externa / observación |
|---|---|---|---|
| Runtime comercial por empresa | Preparado; perfil estricto y adaptadores PG sin BYPASSRLS | No para configurar | Autorizar destino/perfil, dominio, CA y credenciales; smoke real TLS/Auth |
| SIGO → Mayorista y cinco roles | API, aislamiento y sesión aprobados en CI | Validación final de operación | Auth remoto simulado en CI; falta smoke en destino aprobado |
| 21 migraciones versionadas | Instalación, reintento, ledger, drift y rollback PG aprobados | No | Ensayo contra copia del esquema real y revisión ownership/advisors |
| Acceso vendedor sin UUID | Descubrimiento autenticado y UI aprobados | Android/reapertura física | Habilitar la versión publicada QA para aceptación final |
| Cifrado/offline/revocación | Chromium/IndexedDB, sesión y regresiones aprobados | Modo avión, reinicio y dos equipos | Revocación offline depende de política temporal, no puede ser instantánea sin red |
| Pedidos y circuito comercial | API/PostgreSQL e interfaces aprobadas en CI | Dos pedidos reservados y recorrido real | No se sincronizaron ni alteraron pedidos físicos |
| P1/P2: asistente/importaciones/asignación/objetivos/informes | Regresión API/UI aprobada; 1500 clientes/5000 productos | Aceptación comercial final | Sin cobros reales ni ARCA productiva |
| Minorista y Matriz | Build e integración de activación aprobados | Smoke final al publicar | Compra IA conserva fallo anterior; no es regresión integral verde de todo SIGO |
| Respaldo/recuperación | Rollback transaccional de instalación probado | No | Restauración real del proveedor pendiente; no equivale a rollback DDL |

Rendimiento de esta corrida, exclusivamente CI: catálogo n=22, p50=372,59 ms, p95=387,78 ms; clientes paginados n=7, p50=5,32 ms, p95=19,52 ms. No son mediciones Railway ni del destino comercial; no acreditan SLA ni escala productiva. El ensayo no aporta una muestra nueva válida de creación de pedidos para p95.

### QA y aprobación

Railway conserva `d85bb6aa` y su predeploy `upgrade-launch-qa.mjs`. El próximo patch debe agrupar sólo la fijación al HEAD final revisado y, si hace falta, el origen exacto del nuevo Preview. No activar commercial-server ni el instalador comercial en QA; no modificar esquema, semillas, roles, infraestructura ni credenciales mediante ese patch. Aplicarlo requiere aprobación manual expresa. No ejecutar el runner CI de migraciones en la base persistente.

GO para revisión/aceptación técnica automatizada en CI; NO-GO para piloto comercial o publicación. Restan el destino autorizado y sus pruebas reales de instalación/TLS/Auth/restauración, la aceptación publicada y el checklist físico postergado. No se hace merge ni se habilita producción.
