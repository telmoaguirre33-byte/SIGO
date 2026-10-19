# Vínculo QA de integración PR #78

Destino exclusivo: MAYORISTA-QA / qa / mayorista-api-qa. Supabase canónico: SIGO-QA-INTEGRACION (xcapcnczxljxwxzigtvs). No constituye autorización de producción.

## Cambio acotado

- Se conserva el servidor P0 y sus variables originales.
- La ruta fija /integracion-qa monta otra aplicación con pool, firma y Auth propios. El Origin sólo verifica CORS; no elige empresa ni base.
- Las tres empresas utilizan las tablas canónicas de SIGO del Supabase nuevo. El PostgreSQL P0 no se migra, copia ni vuelve a sembrar.
- La entrada de vendedor/portal deriva su base del destino aprobado; no mezcla la raíz P0 con el prefijo. Caché e IndexedDB del prefijo usan nombres propios y nunca abren ni limpian el almacén P0, incluso en el mismo navegador.
- El cliente admite exclusivamente raíz HTTPS o /integracion-qa. El panel deriva ese prefijo de los destinos publicados, sin UUID manual ni otro importador/transporte comercial.
- El nuevo runtime exige proyecto, entorno y servicio QA exactos, el proyecto Supabase aprobado y un perfil aprobado con SHA-256. El modo comercial existente sigue rechazando los IDs del QA P0.
- El rol nuevo no tiene SUPERUSER, BYPASSRLS ni CREATE ROLE; pool máximo 2. Conserva RLS y validación de membresía.
- Las variables nuevas llevan MAYORISTA_INTEGRATION_. No sustituyen DATABASE_URL, Auth, firma ni bootstrap del QA anterior.
- Inicio propuesto: node /app/src/modules/mayorista/backend/integration-qa-server.mjs.
- Predeploy propuesto: el mismo archivo con --check; verifica conexión/ledger/RLS en lectura. No instala migraciones, crea empresas ni ejecuta aceptación comercial.
- No se modifica Minorista, main, producción, Compras, otros proyectos ni los dos pedidos del dispositivo.

## Conexión acreditada antes de preparar el patch

Conexión real al pooler IPv4 de Supabase, puerto 6543, usando pg 8.16.3, el rol dedicado y verificación estricta de certificado/hostname. Se verifican ledger 1–21 y ausencia de filas visibles sin contexto. Se conserva evidencia privada sin contraseñas.

La verificación TLS acredita cliente→pooler. pg_stat_ssl del backend administrado por Supabase informó ssl=false para pooler→PostgreSQL; no se presenta ese tramo interno como TLS acreditado. Se utiliza el pooler compartido documentado por el proveedor, sin add-on IPv4 pago.

## Aplicación y recuperación

El patch se prepara STAGED y requiere aprobación manual. Debe tocar únicamente fuente/commit, inicio/predeploy y variables nuevas de mayorista-api-qa; no crear recursos ni cambiar límites, réplicas o la base P0.

Antes de aplicar: revisar CI del SHA fijado, correspondencia del perfil y hashes, destino Supabase, TLS y snapshot del estado anterior. La vinculación del ledger del Supabase nuevo se concilia expresamente como configuración de esta instalación QA; no se reaplican sus migraciones.

Después de aplicar: /health y /readiness siguen correspondiendo a P0; /integracion-qa/readiness debe acreditar el Supabase nuevo y schemaVersion 21. Confirmar que tokens de una aplicación no autentiquen en la otra, SSO propietario/administración y acceso vendedor/depósito/chofer con sus roles. Verificar CORS desde el Preview aprobado y rechazo de un origen ajeno.

Rollback: restaurar fuente fijada 2519719cc0ffc328553c0b32e8f3bd10a4d214a3, inicio server.mjs y predeploy previo upgrade-launch-qa.mjs. Las variables originales se conservan. Desactivar solamente los destinos de integración del Supabase nuevo; conservar movimientos, usuarios, hashes y las dos bases. No restaurar snapshots destructivos ni tocar IndexedDB.

## Límite de la evidencia

Las pruebas unitarias de transporte utilizan dobles y lo indican expresamente. CI prueba HTTP, TypeScript/build, PostgreSQL y Chromium aislados. La conexión PostgreSQL aquí acreditada es real. La aceptación del nuevo backend publicado y de las tres empresas desde las interfaces depende del deployment autorizado; no se declara GO PILOTO antes de completarla.
