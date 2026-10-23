# Armado de Cargas — módulo Mayorista independiente

Continuación desde `bc1c792`, rama `feat/mayorista-distribuidora-offline-20261012`, PR [#72](https://github.com/telmoaguirre33-byte/SIGO/pull/72). No hubo merge ni publicación.

## Funciones incorporadas

- Aprobación explícita de pedidos recibidos. La API obtiene cliente, ruta conocida, renglones y precios desde los datos Mayorista de QA; no confía en un estado aprobado ni en precios enviados por el navegador.
- Cargas individuales o consolidadas, identificadas por UUID, camión/patente, ruta, chofer y armador responsable.
- Asignación única de cada pedido; bloqueo de procesamiento por el flujo individual paralelo cuando el pedido ya se aprobó para Cargas. Cancelar preparación libera la asignación para reagrupar, manteniendo el pedido aprobado y su historial.
- Consolidación de productos, preparación y conteo por pedido, cliente o carga. La composición se cierra al iniciar picking.
- Registro de faltantes y sobrantes; faltantes requieren autorización por pedido y motivo. Un sobrante bloquea verificación/salida hasta corregir el conteo; su registro original permanece en el historial.
- Verificación de códigos por producto/presentación, factor de unidades, checksum para GTIN/EAN habituales, rechazo de códigos desconocidos/ajenos y controles de exceso de escaneo. Un conteo manual necesita verificación de sus unidades.
- Salida solo después de verificar picking y conciliar diferencias. Camión o chofer con reparto activo no puede iniciar otro.
- Entregas por pedido con cantidades entregadas/devueltas que suman lo cargado; entregas parciales, rechazos y devoluciones posteriores durante el reparto.
- Rendiciones en centavos, comprobante, revisión administrativa y saldo independiente. Una devolución posterior conserva el importe ya rendido, muestra saldo a favor cuando corresponde y exige nueva revisión.
- Cierre con todas las entregas registradas y rendiciones revisadas. El saldo pendiente puede quedar como saldo mayorista independiente; no se registra en las cuentas SIGO.
- Hojas de carga/reparto y hoja por pedido, con cantidades, responsables y espacio de comprobante/firma. Se implementa impresión de navegador y se generó un PDF real en Chromium.
- Estados, revisión optimista, responsables autenticados en API, historial, UUID de comando y reintentos idempotentes. La pantalla demo utiliza persistencia transaccional propia en IndexedDB.

Estados principales: `planificada → picking → verificada → en_reparto → cerrada`; cancelación permitida antes de la salida. Aprobación/asignación, faltantes, entregas, devoluciones y rendiciones conservan su trazabilidad.

## Aislamiento y permisos

Código en `src/modules/mayorista/cargas/`; pantalla `demo/cargas.html` accesible desde la administración Mayorista. No modifica módulos SIGO, ventas, inventario, facturación ni Caja. La aprobación no constituye una venta ni una reserva de stock; la asignación protege pedidos contra doble despacho.

API nueva: GET `/cargas` y POST `/cargas/commands`. Reutiliza la autenticación Mayorista de QA, membresía vigente y RLS; actualmente requiere administrador de la empresa. Armador/chofer se registran como responsables asignados, pero no se habilitaron identidades operativas comerciales ni una nueva jerarquía de permisos sin la matriz del organigrama.

`cargas/schema-qa.sql` es una propuesta terminada en rollback, no una migración de producción. El CI la aplica solo a su PostgreSQL 17 efímero en localhost. Una clave única por empresa/pedido impide dos asignaciones simultáneas. Estado/asignaciones se guardan juntos; transacciones SERIALIZABLE y reintentos acotados protegen también la carrera con el flujo individual Mayorista.

La pantalla Cargas es demo local con datos ficticios y actor demo visible. La API está comprobada en QA real, pero no se conectó automáticamente esa pantalla a un backend comercial. El historial API registra el usuario verificado; el historial local refleja el responsable demo. La protección de datos comerciales/cifrado sigue pendiente de integración.

## Continuación App Vendedor

Se agrega `vendedor/connected.mjs`: pantalla QA con login real, descarga del catálogo propio, persistencia en IndexedDB, creación offline y sincronización con la API idempotente existente. Mantiene tokens solo en memoria y conserva pedidos al cerrar sesión.

La página `demo/connected.html` está desactivada por defecto y no tiene endpoint comercial. La prueba CI habilita la pantalla exclusivamente en su servidor HTTPS localhost de QA, en el mismo origen. La App Vendedor demo existente se conserva. No se habilitó login remoto Supabase ni se publicaron configuraciones o credenciales.

Todavía faltan la conexión comercial de pantallas, publicación controlada de catálogos/asignaciones, visitas/rendiciones remotas generales, cifrado integrado y recuperación comercial. No se declara el sistema completo terminado.

## Commits

| Commit | Cambio |
| --- | --- |
| `b2e4b6f` | Sector Cargas, API/RLS, pantalla independiente y pantalla Vendedor QA |
| `be3c434` | Corrección de sintaxis SQL y ensayo de reapertura/RLS |
| `48f8873` | Pruebas de picking offline/PDF y Vendedor conectado desde interfaz |
| `61183ef` | Reintento de lectura tras cierre HTTP real |
| `d0cbb45` | Picking por cliente, control de ruta y cierre/reapertura de Chromium |

El primer commit tuvo un error de delimitación de una consulta SQL JavaScript, corregido inmediatamente; el ensayo de reapertura detectó un socket HTTP reutilizado y se agregó el reintento explícito. No se contabilizaron esos fallos como pruebas aprobadas.

## Verificación ejecutada

Código probado: `d0cbb451f7d3e006f75c313649ecfd57cdcb7f86`.

[CI Mayorista](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38296541283): **success**.

| Prueba | Resultado |
| --- | --- |
| TypeScript y build demo | Aprobados |
| Unitarias | 112 aprobadas; incluyen 24 nuevas de Cargas |
| API/auth/PostgreSQL reales | 39 controles aprobados; incluyen 7 de Cargas y 2 nuevos de interfaz Vendedor QA |
| Demo en Chromium real | 30 aprobadas; incluyen Cargas desde UI, picking, cierre/reapertura offline y PDF |
| RLS dedicado | 7 controles anteriores aprobados; aislamiento Cargas adicional incluido en los 39 nativos |
| Build SIGO y verify:critical | [Run 38296541381](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38296541381): success |
| Workflow Compras | [Run 38296541285](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38296541285): failure, fallo previo fuera del alcance |

Se ejecutó asignación concurrente del mismo pedido a dos cargas: un éxito, un conflicto y una sola fila de asignación. Se probaron picking consolidado, cliente/precio falsificado rechazado como fuente, códigos incorrectos, salida prematura, reparto, rendición, otra empresa, reapertura HTTP y acuse del pedido original conservado. La UI Vendedor autenticó, descargó catálogo, guardó sin red y sincronizó el mismo UUID al volver la conexión.

Cargas se verificó desde la interfaz, se cerró y reabrió Chromium con el mismo perfil y después se recargó sin red: se conservaron dos clientes y cantidades preparadas/escaneadas. La hoja se renderizó y produjo `cargas-hoja.pdf`; no se probó una impresora física.

[Artifact](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38296541283/artifacts/11768977613) con PDF, JSON y capturas. SHA256 informado por GitHub: `e9e8c0933299f98bda598133fab4df4f885b376793de0cab08ee6be25d37cd0c`. Expira el 2026-10-19.

Localmente: 24 nuevas unitarias de Cargas, generación demo y sintaxis de 39 archivos JavaScript. Navegador, PostgreSQL y chequeo TypeScript se ejecutaron en CI por las restricciones de sockets/dependencias del entorno local.

Delta desde `bc1c792` inspeccionado: todos los archivos modificados pertenecen a Mayorista. No se editaron workflows, dependencias raíz, main ni módulos protegidos.

## Pruebas manuales pendientes

1. En una URL HTTPS independiente previamente autorizada, abrir App Vendedor con red, esperar instalación del service worker y entrar en Administración → Armado de Cargas. Usar únicamente datos ficticios.
2. Cargar ejemplo, crear camión/ruta/chofer/armador, asignar dos pedidos y probar modalidad individual por separado.
3. Registrar código `9780201379624` con una unidad base para el producto ficticio. Iniciar picking; escanear por pedido, cliente y consolidado. Probar código incorrecto, una unidad faltante y otra sobrante.
4. Corregir sobra, autorizar faltante con motivo y verificar las cantidades. Cerrar Chrome/reabrir y repetir en modo avión físico. No borrar almacenamiento.
5. Imprimir ambas hojas en una impresora de pruebas; comparar cantidades, clientes, camión y responsables. El PDF de CI no demuestra salida por una impresora.
6. Registrar salida, entrega parcial/rechazo, devoluciones y rendición. Probar sobrecobro, duplicación y cierre prematuro; completar revisiones y cerrar.
7. Con backend persistente QA y pantallas conectadas autorizadas, probar dos operarios/dispositivos simultáneos y un lector de barras físico. Validar sus permisos según el organigrama.

Pendientes reales: hosting HTTPS autorizado (último estado documentado del proyecto existente: BLOCKED/acceso de scope 403), dos Android físicos, GPS físico, lector, impresora, roles operativos y backend persistente autorizado. No se creó ni reactivó hosting, no se aplicó SQL en Supabase, no se realizó merge ni despliegue. El PR sigue borrador.

