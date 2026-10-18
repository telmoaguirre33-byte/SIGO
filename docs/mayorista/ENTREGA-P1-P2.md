# Entrega P1/P2 — Mayorista / Distribuidora

Alcance exclusivo de PR #72. Sin merge, producción, Minorista funcional, Compras ni módulos externos. No se contrataron herramientas ni infraestructura. Los dos pedidos del Android no se leen ni se envían desde este desarrollo. Railway QA aceptado: HEAD `8082acb7fad2e4a73fac7c23434d014e6bb42694`, deployment `c4f6b8ac-f6ef-4d20-b523-589d60c3f4ee`, SUCCESS. No se repite el despliegue. Los cambios posteriores de interfaz se validan en CI/Preview; no actualizan automáticamente los archivos publicados por Railway.

## Problemas corregidos

| Causa | Cambio |
|---|---|
| Validar un pedido descargaba el catálogo completo | Consulta de asignación por empresa/cliente/vendedor y cotización existente sólo de sus renglones. La cotización conserva sesión, producto activo, listas, ofertas y presentación. |
| Catálogo recorría el JSON de planificación por cada cliente/ruta | Lectores existentes optimizados con joins de metadata; el lector gerencial evita cotizar el catálogo completo. Guard y proyección se conservan. La regresión compara catálogo y panel antes/después. |
| Portal refrescaba todas las colecciones y renderizaba miles de registros | Refresco según sección, búsquedas con resultados acotados, padrón de 30 filas, catálogo de hasta 50 coincidencias y selectores grandes buscables de hasta 30 opciones. Historial por cursor estable con precisión PostgreSQL. |
| No había preparación reanudable ni importación Mayorista persistente | Asistente por empresa; importaciones con vista previa, validación en servidor, filas/errores/resultados persistentes, lotes, pausa y reanudación. |
| Asignar en lote guardaba una planificación completa por cliente | Una revisión de planificación por lote, reutilizando el modelo y publicación existentes; journal de idempotencia y control concurrente de versión. |
| Informes limitados a CSV de vendedores sin filtros comerciales | Once informes filtrados, proyección paginada y Excel XLSX real. Se reutilizan lector y escritor de SIGO encapsulados en Mayorista. Exportación comprueba revisión entre páginas. |
| Readiness dependía de volver a certificar P0 para cada SHA | Gate de evidencia P0 aprobada + esquema P1 instalado; devuelve HEAD real y aceptación física pendiente. No reejecuta aceptación ni siembra. |
| No se distinguía preparación de suscripción y operación comercial | Estado comercial versionado y auditado, separado de tipo/módulo. Sólo preparación: sin cobros ni suspensión automática. |

## Conservación e idempotencia

Puesta en marcha, importaciones y suscripción son tablas aditivas en el esquema Mayorista QA existente, con RLS forzado. No hay cambios a claves, stores, versión ni datos de IndexedDB. La nueva lectura de historial sólo actualiza su caché cifrada cuando el vendedor lo solicita; no modifica registros de pedidos.

Cada fila de importación tiene estado persistente. La confirmación y su resultado se guardan en la misma transacción; reintentar un comando devuelve su resultado. Repetir un archivo recupera la importación. El mapeo empresa/tipo/código evita duplicar altas entre archivos. Las fichas existentes se conservan; no se reescriben saldos/crédito/precios base. El stock de apertura rechaza productos con stock o movimientos. El ajuste de stock comercial sigue su circuito habitual. Las políticas de precio reutilizan la operación compartida autorizada.

La asignación masiva admite hasta 100 clientes por operación con una revisión de planificación. Paginación/búsqueda permite administrar los 1.500 sin un desplegable masivo.

## Medición

`RENDIMIENTO-BASE-P1-P2.json` conserva las respuestas del proveedor para las 24 horas previas a estos cambios. Son varios intervalos y pueden incluir varios deployments; el máximo p95 de un intervalo no es el p95 agregado de toda la ventana.

- GET catálogo: peor intervalo p50 2.871 ms / p95 5.223 ms; otro intervalo p95 1.057 ms.
- POST pedidos: p50 375 ms / p95 4.576 ms; 58 solicitudes, 55 2xx, 3 4xx, 0 5xx.
- Servicio completo: 0 respuestas 5xx de 1.741 solicitudes; 52 respuestas 4xx.
- Memoria media 0,0716 GB; máxima 0,3594 GB. CPU_USAGE máximo 0,02467, en las unidades del proveedor. Son observaciones de tráfico existente, no una nueva prueba de carga.

El backend incorpora `Server-Timing` y logs locales `MAYORISTA_REQUEST_TIMING`: duración total, SQL del repositorio autenticado, cantidad de consultas, serialización JSON y bytes de JSON sin compresión. No registra cuerpos, SQL textual, usuarios, contraseñas ni tokens. Autenticación/pool/transporte no se atribuyen falsamente al tiempo SQL. La transferencia y frontend se miden aparte en Chromium CI. No se habilita un proveedor de observabilidad.

Los artefactos CI `launch-ci-metrics.json`, `launch-frontend-transfer.json` y `product-search-performance.json` distinguen PostgreSQL/Chromium CI de Railway y Android físico. **La mejora de p95 en Railway exige desplegar el patch y medir después; no se da por demostrada con CI.**

## Matriz funcional

La evidencia automatizada final debe corresponder al HEAD aprobado en CI. Las pruebas físicas no bloquean desarrollo pero sí aceptación comercial.

| Función | Implementada | Prueba automatizada | Física pendiente | Bloqueo externo |
|---|---|---|---|---|
| Puesta en marcha para empresa autenticada | Sí; reanudable, enlaces a CRUD existente y revisión real | PostgreSQL + Chromium | Recorrido comercial PC/Android | Alta de empresa usa SIGO existente |
| Clientes/productos Excel/CSV | Sí; altas conservadoras, códigos, vista previa, validación, corrección y reanudación | PostgreSQL 1.500/5.000; CSV/XLSX; Chromium | Planillas reales representativas | No importa saldos históricos |
| Stock inicial | Sí, sólo apertura sin movimientos | PostgreSQL; rechazo de segunda apertura | Revisión con responsable | Ajustes comerciales por circuito existente |
| Listas/precios | Sí; presentaciones sobre listas activas y precio base existente | PostgreSQL y regresión de cotización | Aceptación comercial de listas | No actualiza precio base por importación |
| Clientes y asignación masiva | Sí; filtros, páginas, hasta 100 por lote | PostgreSQL, concurrencia/versiones y Chromium | Aceptación comercial | Deuda vencida sólo si existe fuente confirmada |
| Gerencia/objetivos | CRUD existente + tabla diaria/semanal/mensual/personalizada | API/PostgreSQL, métricas y Chromium | Gerente real | Ninguno técnico identificado |
| Vendedor/navegación/pedidos | Sí; flujo anterior aprobado, Contado, cantidades, borradores y estados | Regresión IndexedDB/Chromium/API | Android real y dos pedidos reservados | Edición sólo antes del primer intento de envío |
| Autenticación/dispositivo | Sí; clave no extraíble, cifrado, recuperación y revocación | Chromium reiniciado + RLS/sesiones | Reinicio físico/pérdida/biometría del SO | Offline revocado se bloquea al reconectar o vencer, máximo 7 días |
| Catálogo/pedido/gerencia/historial | Optimización SQL, render y consultas acotadas; telemetría | PostgreSQL + recursos/transferencia Chromium | Uso real Android | P95 posterior en Railway después de aprobación |
| Informes Excel | 11 tipos; filtros y XLSX real | Modelo + API/PostgreSQL + archivo ZIP/XLSX + Chromium | Abrir archivos en Excel utilizado por cliente | Hasta 10.000 registros por archivo |
| Respaldo/recuperación local | Existente conservado | Regresiones cifrado/restauración | Otro teléfono/perfil físico | Backup/PITR Railway y restauración del proveedor por verificar |
| Suscripción | Arquitectura y estados persistentes preparados | Modelo, transiciones, versiones y RLS | Aceptación comercial | Cobros y suspensión efectiva desactivados; falta política y proveedor de pagos autorizado |
| Circuito 8 vendedores/1.500/5.000/3 vehículos | P0 persistente existente conservado; regresiones del circuito nuevo en CI | Evidencia P0 previa + regresiones nuevas | Aceptación publicada y física final | No se repite siembra ni circuito mutante en QA |
| ARCA | Simulación/homologación segura conservada | WSFE/CAE/NC simulados y persistencia real CI | Cuando corresponda | Credenciales/autorización de homologación real; producción deshabilitada |

## Despliegue único QA

Preparar únicamente el servicio existente MAYORISTA-QA → qa → mayorista-api-qa, fijando el HEAD final y cambiando predeploy a:

`node /app/src/modules/mayorista/backend/upgrade-launch-qa.mjs`

El programa verifica binding QA y evidencia P0; luego instala la ampliación aditiva en el namespace sintético **ya existente** `mayorista_acceptance_e1031f20aff5`, dentro de una transacción con lock. No crea base, esquema, servicio ni volumen; no siembra, no resetea usuarios, no ejecuta aceptación mutante. Si falla, revierte la ampliación y el deployment anterior sigue activo. Reejecutarlo verifica las tablas/funciones instaladas y RLS. Presupuesto, recursos, dominios y autenticación no se cambian.

Aplicar requiere aprobación específica del patch final Railway. Después: SUCCESS/HEAD, health/readiness, medición real y smoke de lectura/seguridad sobre la empresa existente. No usar los dos pedidos hasta la aceptación física acordada.

P0 permanece abierto. No se declara comercializable ni se publica producción.

## Corrección de predeploy observada en Railway

El deployment `18b8625b-24ff-4880-bd9d-5046e81345ce` compiló, reutilizó correctamente la evidencia P0 y falló al verificar RLS. PostgreSQL registró `relation "mayorista.puesta_marcha" does not exist` en `WHERE oid=$1::regclass` (42P01). El adaptador QA traduce SQL, pero el parámetro conservaba el esquema base en vez del namespace sintético existente. No era un fallo de usuarios, permisos comerciales ni del sembrado. La excepción provoca rollback antes del commit de la ampliación.

La corrección resuelve explícitamente el nombre de esquema del pool validado para `to_regclass($1)`, conserva RLS obligatorio y añade diagnóstico por etapa. El instalador real se ejecuta y se repite en PostgreSQL CI dentro de un namespace aislado; además se prueba rollback si falta RLS. No se reintenta Railway automáticamente: el siguiente HEAD necesita un nuevo patch autorizado. Los datos y movimientos QA se conservan.


## Cierre de desarrollo automatizable posterior a la aceptación QA

Se completa la navegación de todos los errores de importación, con páginas de 20 sobre el lector existente, incluso después de la fila 100. Corregir conserva la fila pendiente: no aplica datos sin confirmar. No cambia API, RLS, SQL ni esquema.

La selección de clientes entre páginas respeta siempre el límite de 100, incluso usando «Seleccionar esta página». Cambiar búsqueda/filtros elimina la selección anterior para evitar asignaciones ocultas. Nuevas regresiones Chromium/PostgreSQL cubren 125 errores, corrección en página final y selección entre cinco páginas de 130 clientes CI.

El despliegue QA aceptado emitió `MAYORISTA_P0_EVIDENCE_REUSED`, `verified: true`, `seeded: false`, `existingOrdersChanged: false`. Evidencia: `evidencia/railway-8082acb7-success.json`. La consulta directa de health/readiness y la nueva medición Railway continúan sin acreditarse por fallo de conexión al proxy del ejecutor; no se sustituyen por resultados CI. Esto no implica un error HTTP del servicio.

No se crea ni aplica otro patch Railway. La aplicación autónoma se apoya en el alta de empresa y habilitación existentes de SIGO; no provisiona infraestructura. Suscripción queda preparada sin cobros/suspensión efectiva. La restauración del proveedor y la homologación fiscal real requieren acceso/autorización externos. Las pruebas físicas continúan postergadas. P0 sigue abierto sólo para la aceptación física final según la decisión del usuario; no se declara comercializable.
