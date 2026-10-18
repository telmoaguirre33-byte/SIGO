# Operación de Mayorista QA independiente

Fecha: 2026-10-13. Preparación técnica; no autoriza activar servicios ni publicar producción.

## Estado y presupuesto

Proyecto existente `MAYORISTA-QA`: `b9a7da94-1d87-46fe-b4da-c7e241ebe185`.
Entorno `qa`: `2addc3e9-f088-42df-a72c-c233fd4308cb`.
PostgreSQL: `9120b029-d20c-4073-a9cc-003953f60817`.

La inspección encontró una sola instancia pendiente de creación, un volumen, ninguna implementación activa y ningún proxy TCP. La configuración contiene metadatos opcionales de conversión HA; no se activaron HA, réplicas ni servicios auxiliares. El intento de limitar la instancia aún pendiente devolvió `Service Instance not found`: no afirmar que quedaron aplicados límites de CPU/RAM.

No aceptar el despliegue pendiente hasta verificar plan, costo fijo, consumo y límite de gasto, aclarando si US$15/mes incluyen la suscripción. El límite duro de Railway afecta al workspace completo, que contiene otro proyecto: no reducirlo de forma que pueda interrumpir servicios ajenos. Los flags del código no constituyen un límite de facturación. Si la suma prevista de base, volumen y servidor excede el presupuesto, detener la activación.

## Paquete preparado y probado

`src/modules/mayorista/backend/Dockerfile` compila solamente Mayorista y sus SQL, con Node 24, usuario sin privilegios y dependencias propias. CI compila la imagen, importa el runtime sin red y confirma que está desactivado por defecto. No se subió la imagen a un registro ni se desplegó en Railway.

El backend sirve API, `/portal.html` y `/secure.html` desde el mismo origen independiente. Nunca montar este Service Worker en el origen de SIGO. No modificar configuración ni dependencias del sistema existente. La integración desde Administrar permanece opcional y desactivada; el componente preparado no se montó en módulos existentes.

Después de la verificación de costos, preparar un único PostgreSQL sin HA y un servidor de aplicación dentro del presupuesto aprobado. No crear proxies TCP públicos, bases adicionales ni Railway Agent. La aplicación debe acceder a la base por la red privada del mismo proyecto/entorno.

## Configuración privada necesaria

Configurar en el servidor QA, mediante el gestor de secretos:

| Variable | Condición |
| --- | --- |
| `MAYORISTA_QA_ENABLED` | `true` solo para la activación explícita QA |
| `MAYORISTA_BUDGET_VERIFIED` | `true` únicamente después de comprobar costos reales |
| `MAYORISTA_MONTHLY_BUDGET_USD` | `15` |
| `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID` | Identidades QA indicadas arriba; las suministra Railway |
| `MAYORISTA_DATABASE_SERVICE_ID` | Identidad PostgreSQL indicada arriba |
| `DATABASE_URL` | Credenciales QA; host `postgres.railway.internal`, puerto 5432, base `railway` o `mayorista_qa` |
| `MAYORISTA_DB_CA_PEM` | Certificado público de la CA del servidor PostgreSQL, recibido por canal confiable |
| `MAYORISTA_PUBLIC_ORIGIN` | Origen HTTPS independiente, sin path ni barra final |
| `MAYORISTA_AUTH_PRIVATE_KEY` | Clave privada Ed25519 propia, exclusiva QA |
| `PORT` | Puerto HTTP interno suministrado por Railway; defecto 8080 |

No usar `rejectUnauthorized:false`, `sslmode=require`, hosts públicos o certificados descargados de una conexión no autenticada. Obtener únicamente el certificado público `root.crt` por el canal de administración autorizado; nunca copiar `root.key`. Comprobar que el certificado activo contiene el hostname privado en SAN. Los ensayos TLS de CI prueban rechazo de CA/hostname incorrectos con certificados efímeros; no acreditan aún el certificado Railway activo.

## Instalación inicial explícita

El inicio normal no aplica DDL. Ejecutar `node prepare-qa.mjs` dentro del paquete únicamente sobre una base QA vacía, con las variables anteriores y:

- `MAYORISTA_BOOTSTRAP_EMAIL`, `MAYORISTA_BOOTSTRAP_NAME`, `MAYORISTA_BOOTSTRAP_COMPANY_NAME`.
- `MAYORISTA_BOOTSTRAP_PASSWORD` por gestor de secretos, sin incluirlo en comandos, historial, GitHub ni chat.
- `MAYORISTA_BOOTSTRAP_ENABLE_COMPANY=true` solo si se desea habilitar explícitamente esa empresa de prueba. Por defecto queda desactivada.

La instalación es transaccional, rechaza bases con tablas existentes, instala RLS y registra la identidad del proyecto/entorno. Genera empresa y gerencia; devuelve sus UUID públicos. Registrar el UUID de empresa para ingresar. Retirar inmediatamente las variables de bootstrap tras la instalación. El usuario de gerencia crea los demás roles desde el portal, vinculando vendedores a su ficha comercial y armadores/choferes a sus cargas.

`node server.mjs` exige el marcador QA y mantiene autenticación, comprobación de empresa/rol y RLS. La empresa deshabilitada no puede iniciar sesión. El inventario, cartera y rendiciones utilizados pertenecen exclusivamente a Mayorista; no generan operaciones en los módulos actuales.

## Puerta de aceptación

Comprobar HTTPS, cookies/almacenamiento, CA real, permisos A/B, caducidad y revocación, pedidos concurrentes, visitas, listas/promociones, cargas, devoluciones físicas y rendiciones contra la base persistente. Ejecutar el protocolo Android con dos teléfonos, lector e impresora. Preparar respaldos protegidos y ejecutar restauración completa en un entorno independiente aprobado, contemplando sus costos antes de crearlo. Definir monitoreo, soporte y recuperación de claves locales antes de comercializar.

URLs previstas, todavía inexistentes: `<origen-qa>/secure.html` para vendedores y `<origen-qa>/portal.html` para administración, armadores y choferes. No comunicar estos placeholders como enlaces de demostración operativos.
