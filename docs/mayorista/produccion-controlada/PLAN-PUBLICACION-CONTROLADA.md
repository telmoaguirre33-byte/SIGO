# Plan preparado · NO EJECUTAR

Baseline final de main/producción observado: `aa104b572bc1af9d4b97054c702b444c693721a5`, deployment `dpl_5wiuaSNWuATzwz4i7KsD3fg1S9V7`. Se preservan los nueve blobs entrantes de main en el candidato; no se ejecutó merge. Revalidar antes de usar este punto de retorno.

Destino web deseado: `https://www.sigo-gestion.com`. Empresa inicial: lapizcito5, identidad verificada por metadata, mantenida fuera del código de frontend. No cambia la plataforma Minorista ni sus fuentes de verdad.

## Antes de autorizar cambios

1. Congelar el SHA candidato con CI aprobado; volver a leer main, alias productivo, referencias, catálogo/hashes y estado de módulos. Si main avanzó, reconciliar sólo la rama de integración y repetir las pruebas afectadas. No hacer merge ciego de #72 o #78.
2. Acreditar el backup/restore según [recovery](recovery/README.md), sin copiar datos reales a QA. Acordar ventana y evitar escrituras concurrentes durante la captura/huella de recuperación.
3. Resolver el destino comercial autorizado y su costo. Debe estar separado de MAYORISTA-QA y del bridge ARCA, usar la misma base COMERCIAL que SIGO y un rol runtime propio NO SUPERUSER/NO BYPASSRLS, sin membresías privilegiadas. No crear recursos por este documento.
4. Preparar el perfil desde `activation/perfil-comercial.NO-ACTIVAR.json`, con `approved=false` hasta su revisión final. Completar IDs de destino, host/puerto/modo, rol de migración separado, rol runtime, origen HTTPS y fingerprint de la clave pública. Incorporar sólo empresas expresamente autorizadas a `allowedCompanyIds`. Preservar los otros flags existentes; investigar su autorización, no apagarlos masivamente.
5. Capturar configuración anterior privada y snapshot de activación atribuible. Verificar exactamente `www.sigo-gestion.com`, Supabase COMERCIAL y dominio comercial operativo; no admitir QA, Preview, localhost, wildcard o un DSN no verificado.

## Configuración exacta preparada

Vercel `comercial`, equipo `telmoaguirre33-byte`: preservar las variables productivas actuales y reconstruir con ellas. `VITE_SUPABASE_URL` debe seguir siendo `https://pafnbxfgpedbvpimjmun.supabase.co`; usar su publishable/anon público y conservar ARCA, funciones y secretos actuales. No promover un bundle compilado con variables QA. No hay variable Mayorista nueva obligatoria en el frontend: el destino se obtiene por empresa mediante la RPC canónica. Las overrides QA siguen restringidas a la rama Preview; la configuración productiva no debe contener `VITE_MAYORISTA_QA_*`, claves sintéticas ni servicios QA.

Backend: usar `src/modules/mayorista/backend/commercial-server.mjs`, `MAYORISTA_RUNTIME_MODE=commercial`, `MAYORISTA_PRODUCTION_ENABLED=true` sólo en la futura activación autorizada, perfil revisado + SHA256 exacto, `MAYORISTA_SIGO_AUTH_URL` de COMERCIAL y publishable/anon público. Configurar privadamente DSN del rol runtime, CA oficial y clave Ed25519 cuyo fingerprint coincida con el perfil. TLS exige CA, `rejectUnauthorized=true` y hostname correcto. `RAILWAY_GIT_COMMIT_SHA`/equivalente observado debe coincidir con el SHA autorizado. No habilitar seeds, reset, QA predeploy, interacción QA o instalación de esquema al arrancar.

El dominio API comercial aún no está asignado: no se inventa una URL ni un recurso. Una vez autorizado, publicar assets comerciales filtrados desde `release/commercial-assets.mjs` en un directorio separado; conservar su manifiesto. Excluir PRUEBA P0, banners/selectores QA, usuarios/datos sintéticos, fixtures y herramientas de aceptación del paquete servido. Los tests/fixtures del repositorio no deben formar parte de assets públicos.

## Orden de ejecución futuro, con autorizaciones específicas

1. Revalidar preflight y backup. Preparar el rol runtime mínimo y migrador separados y snapshot de ACL/owners. No usar postgres/service_role como conexión runtime.
2. Ensamblar las 21 versiones con el **rol comercial exacto**; v21 depende de su nombre. Revisar el manifiesto/hashes generado. Usar exclusivamente el instalador comercial con perfil/hash, binding y transacción única. No usar `schema-package` QA, seed, `db push --include-all` ni editar el ledger para forzar adopción. El workflow general Supabase es independiente y no sustituye este paquete; los archivos de `supabase/migrations` son iguales a main en esta integración.
3. Si falla antes de COMMIT: rollback transaccional. Si se pierde confirmación durante COMMIT: comprobar sesión terminada, binding/ledger/hashes antes de reintentar. No repetir a ciegas.
4. Desplegar el backend comercial autorizado, sin bootstrap sintético, con allowlist. Verificar health y readiness, rol/RLS/binding/21 hashes y fuente canónica. No escribir pedidos comerciales como smoke sin autorización separada.
5. Preparar/revisar merge de #78, **sin ejecutarlo hasta autorización**. Publicar/reconstruir SIGO con configuración productiva, no promover un Preview QA. Verificar metadata exacta SHA/dominio y smoke Minorista. El merge y el deployment productivo son acciones independientes que requieren autorización; coordinar las automatizaciones de Vercel para que el orden previsto sea efectivo.
6. Con identidad real atribuible de Matriz, snapshot sin drift y autorización de activación: lapizcito5 pasa a tipo canónico **Mixto** si no lo era, conserva Minorista y su flag existente; sólo su destino apunta al runtime comercial aprobado. No cambiar destino predeterminado ni otras empresas. Las plantillas preparadas terminan en ROLLBACK; una ejecución real exige copia revisada con COMMIT y autorización explícita.
7. Acceder a `www.sigo-gestion.com`: misma sesión SIGO, empresa correcta, menú según tipo/módulo/permisos. Validar cinco roles autorizados, denegación de empresas ajenas y SSO/CORS. La administración normal entra desde SIGO, sin requerir enlaces Preview.

## Smoke y desactivación

Verificar acceso a Caja, Ventas, Compras, Productos, Stock, Precios, Clientes, Cuenta corriente, Informes, Usuarios y Configuración con permisos existentes; ARCA Minorista no se modifica. Compra IA conserva su incidencia independiente. En Mayorista, navegación, contexto, lectura de maestros y estado de sincronización. Confirmar que perfiles no autorizados se deniegan y que no aparece información QA.

Operaciones de venta/stock/cobro reales no se usan como prueba inocua: requieren el caso de aceptación acordado, UUID estable, valores revisados y conciliación. No sincronizar los dos pedidos Android reservados de QA.

Rollback operativo: desactivar disponibilidad del destino por empresa para cortar la entrada, retirar el runtime de servicio o bloquear su allowlist según el alcance aprobado, y volver el alias Vercel al deployment productivo previo confirmado al autorizar la publicación (último observado: `dpl_5wiuaSNWuATzwz4i7KsD3fg1S9V7`, no el baseline d9a5a9dd anterior a PR #85/#86). Conservar esquema/ledger/auditoría y movimientos. Revisar tokens ya emitidos y las revocaciones aplicables; esconder menú no equivale a revocar sesiones. El guard de servidor protege también la verificación de tokens. Recuperar configuración sólo contra snapshots sin drift; no sobrescribir cambios simultáneos de otras empresas.

La restauración de una base vieja sobre ventas posteriores no es rollback de código. Para pérdida/corrupción, restore aislado probado, conciliación y procedimiento del proveedor antes de autorizar reemplazo; nunca DROP, resembrado o down migrations destructivas. Un esquema instalado queda conservado aunque se revierta la aplicación.
