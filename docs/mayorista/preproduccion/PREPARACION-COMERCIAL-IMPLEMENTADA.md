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

Esto completa un instalador versionado en código para una instalación nueva del módulo, no demuestra compatibilidad con el esquema productivo actual. Sigue faltando ensayo integral en copia autorizada representativa, advisors, grants/ownership revisados y prueba de recuperación del proveedor. No existe autorización ni destino comercial activo. Los tests unitarios de instalador usan dobles de conexión y no deben llamarse prueba de migración real. Las pruebas de adaptadores sí ejecutan SQL y roles limitados en PostgreSQL CI.

## Vendedor sin UUID manual

Fuera del origen QA, el login pide email y contraseña. POST /auth/companies valida scrypt antes de devolver sólo empresas activas del vendedor autenticado; no entrega tokens ni crea sesiones. Una empresa se selecciona internamente; varias se muestran por nombre. No hay búsqueda pública por email/empresa, ni inferencia desde el navegador. Al ingresar se revalidan credenciales, membresía, permisos y fuente. Una empresa revocada se rechaza aunque hubiera sido listada antes.

Durante la selección de varias empresas, las credenciales se conservan sólo en memoria y por un plazo acotado (dos minutos más el intervalo de limpieza), se descartan al cancelar, finalizar o destruir la pantalla y no se escriben en IndexedDB, URLs ni logs. La preparación cifrada y reapertura offline siguen usando los mecanismos existentes. No se cambia versión/stores de IndexedDB ni se envía automáticamente ningún pedido.

El selector de cuentas sintéticas sigue sólo en QA. Los dos pedidos físicos no se leen ni utilizan en estos ensayos.

## Validación y pendientes

- Unitarias: perfil/origen/TLS/hash, rechazo de QA/seed/secret keys/roles privilegiados; SQL versionado, reintento no-op, drift y rollback de fallo mediante dobles.
- PostgreSQL CI: adaptadores con rol NOSUPERUSER NOBYPASSRLS, descubrimiento con contraseña, aislamiento, catálogo, SSO (Auth externo simulado), directorio y revocación; helper privado inaccesible a anon.
- API/UI existentes: regresión completa, primer login sin empresa escrita, cifrado/reapertura/offline/UUID e idempotencia.
- Pendientes externos: target/perfil/credenciales comerciales autorizados; ensayo de instalación completa sobre esquema real y advisors; smoke publicado/p95; backups/restore; alcance comercial/fiscal y políticas de prueba/suscripción; checklist físico postergado.

No hay GO para vender ni publicar aún. El runtime y primer acceso dejan de ser sólo una descripción pendiente; su habilitación real y la validación del destino siguen bloqueadas hasta las aprobaciones/evidencias anteriores. No se activa cobro, ARCA productiva, main, merge ni infraestructura.
