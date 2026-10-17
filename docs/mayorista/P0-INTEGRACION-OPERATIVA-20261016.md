# P0 · Integración operativa y empresa ficticia QA

Base auditada: `1984e81b0237864502b3c71e3a480a753044a412`. PR #72, sin merge.

## Corrección

`server.mjs` construye un único servicio con el pool del namespace interactivo cuando está habilitado. Se eliminó la selección de base según `Origin`. El Preview, portal, App Vendedor y operadores usan el mismo contexto. Un origen no autorizado sigue recibiendo 403; cambiar el origen no cambia la empresa.

Las sesiones SIGO mantienen verificación remota de identidad, membresía y flag. Un reinicio exige revalidarlas desde SIGO. Las cuentas locales de demostración necesitan contraseña, membresía vigente, rol, empresa y dos registros privados: cuenta autorizada y sesión emitida por login local. No se reutiliza la ausencia de una sesión SIGO como permiso local. RLS, firma Ed25519, revocación, TLS y límites de solicitudes se conservan.

Se admiten como máximo dos orígenes SIGO HTTPS exactos, además del origen API: `MAYORISTA_SIGO_ORIGIN` y `MAYORISTA_SIGO_PREVIEW_ORIGIN`. Permiten fijar el alias de rama y el Preview exacto sin comodines.

## Preparación persistente, pendiente de aplicar en Railway

Ejecutable: `node /app/src/modules/mayorista/backend/prepare-demo-qa.mjs`.

Solo abre la PostgreSQL QA existente, exige su binding de infraestructura y el namespace sintético interactivo vinculado. No abre una conexión comercial remota ni ejecuta escrituras en lapizcito5 real.

Prepara Distribuidora Horizonte · FICTICIA QA, empresa `30000000-0000-4000-8000-000000000001`:

- 8 vendedores activos y cuentas separadas, con clientes distribuidos por vendedor/ruta/zona.
- 1.500 clientes y 5.000 productos totales de esa empresa; completa los registros sintéticos anteriores sin borrarlos ni reiniciar su stock/saldo.
- 3 vehículos, 8 rutas nuevas, 2 listas con presentaciones y metas del mes de preparación.
- Cuentas corrientes sintéticas con asientos iniciales.
- Un depósito central lógico, correspondiente al stock compartido único existente. No se agrega un sistema multidepósito ni un segundo inventario.
- 14 accesos locales: 8 vendedores, gerencia, administración, armador y 3 choferes. Correos `vendedor1` a `vendedor8`, `gerencia`, `administracion`, `armador`, `chofer1` a `chofer3`, todos en `@distribuidora.qa.invalid`. La contraseña procede de `MAYORISTA_BOOTSTRAP_PASSWORD` existente; nunca se incluye en evidencia, URLs ni repositorio.

El primer sembrado es una transacción con lock y manifest privado. Si ya existe, devuelve ese manifest sin resetear datos, contraseñas o metas. Si los datos previos exceden los tamaños autorizados, se detiene para conciliación. Posteriormente cierra el pool, abre otro y verifica counts/binding/manifest. Persiste el resultado en `mayorista_private.qa_demo_evidence` y emite `MAYORISTA_DEMO_PREPARED`. Ese estado es **seed_persisted**, con aceptación operativa y escala **pending**: sembrar no aprueba el circuito publicado.

## Evidencia medida en CI

Primera ejecución de código: `dec38568cd0673ae2d1138b206fe77567b323e7d`.

[Mayorista 38911790239](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38911790239) SUCCESS: TypeScript, build, RLS, 94 controles API/PostgreSQL, 51 UI, Chromium/offline, Docker y runtime desactivado por defecto. [Build SIGO 38911790249](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38911790249) y [Matriz 38911790103](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38911790103) SUCCESS. Compras conserva su fallo previo en su workflow aislado; no se modificó.

Artefacto: `mayorista-evidencia-38911790239`, ID `12049534968`, SHA256 `da45563d8680f2bc43012e6db2c4e6059692bb080876444e253a680ffc59e7cc`. Incluye `p0-demo-scale.json` con muestras por operación y errores; los logs conservan el resumen. La copia permanente resumida está en `evidencia/p0-ci-dec38568.json`.

`demo-scale.mjs` usa HTTP y PostgreSQL reales, 8 vendedores concurrentes, 2 pedidos por vendedor, cargas consolidadas, picking, despacho, entrega, ventas, cobros, rendiciones, cierre, cuenta corriente y una factura con WSFE simulado. La identidad SIGO externa se sustituye explícitamente; el ensayo no puede ejecutarse contra Railway. Se verifican dos orígenes autorizados, otro origen denegado, permisos de depósito, reinicio de servicio, recuperación idempotente y conciliación. El circuito UI y las interrupciones/offline se prueban además con Chromium real en el workflow existente. No se probaron 8 teléfonos físicos ni 8 interfaces de vendedor simultáneas sobre Railway.

Conciliación de la primera ejecución: 16 pedidos = 16 entregas = 16 ventas = 16 cobros; 8 cargas consolidadas; stock del producto probado 10.000 → 9.984; saldos finales iguales a los iniciales tras venta+cobro; una factura simulada sin segunda baja de stock. Lectura desde conexiones independientes y reinicio del servicio conservó movimientos y sesiones locales.

| Operación CI | Muestras | p95 ms |
| --- | ---: | ---: |
| Catálogo | 9, incluye una denegación esperada | 4.313,93 |
| Pedidos POST | 33, incluye conflicto esperado | 3.235,35 |
| Comandos de carga operativa | 112 | 14,80 |
| Entrega comercial | 32, incluye reintentos | 12,07 |
| Cobro | 32, incluye reintentos | 9,00 |
| Panel gerencial | 1 | 2.791,73 |
| Informes | 1 | 99,52 |

Búsqueda local: 5.000 productos, 320 consultas, p95 1,21 ms. Duración del ensayo 39,81 s. CPU Node 6,96 s usuario + 0,55 s sistema. RSS antes/después 299,85/509,13 MB; máximo del proceso 517.288 KiB. **El proceso incluye cliente HTTP, servidor, catálogos retenidos y suites anteriores; no es memoria aislada del servicio Railway ni de PostgreSQL.** No se midieron recursos PostgreSQL bajo carga.

Estos resultados no aprueban capacidad del contenedor Railway de 500 MB ni establecen un SLA. Catálogo/pedidos y memoria requieren medición del proceso desplegado bajo la carga real. La revisión siguiente agrega el limitador real al ensayo y prueba el preparador con cierre/reapertura; su resultado se registra en el PR.

## Estado publicado y bloqueos

Preview de la primera ejecución READY: `https://comercial-5bwiwr766-telmoaguirre33-byte.vercel.app`, Vercel `dpl_4fKzaH5kJ1b8JKPDeNuqnMZr7yxL`, SHA exacto `dec38568`. El Preview final y su SHA se indican en el PR.

Railway continúa con `1984e81`, deployment `74c6dbd6-5a1d-4e5d-b152-fddb179f45c6`; por tanto no ejecuta todavía esta corrección ni el sembrado. Se prepara un patch revisable sobre MAYORISTA-QA/qa/mayorista-api-qa: source fijada al HEAD probado, predeploy existente seguido del preparador demo, y dos orígenes explícitos. No se cambian Postgres, recursos, presupuesto, servicios ni claves.

La última hora observada antes del patch no tuvo solicitudes HTTP registradas: no permite afirmar ausencia de 503 bajo uso ni medir latencia. Memoria del servicio anterior en reposo ~69,38 MB; no es un resultado de escala.

El workspace no tiene credenciales de DB/CLI y falla al conectar con su proxy; además deniega escuchar puertos locales. Los conectores permitieron publicar y ejecutar CI. Si Railway solicita aprobación interactiva se detiene la aplicación del patch y se pide al propietario; no se intenta eludirla.

Pendientes de aceptación P0: aplicar el patch, comprobar logs de persistencia en la DB existente, CORS del Preview final, ingreso SIGO real sin segundo login, circuito publicado entre perfiles, offline/sincronización y carga concurrente con métricas del servicio/DB. No se sustituyen por los resultados de CI. No se declara comercializable ni listo para producción; siguen pendientes puesta en marcha, importaciones, UX, fiscal y suscripciones.
