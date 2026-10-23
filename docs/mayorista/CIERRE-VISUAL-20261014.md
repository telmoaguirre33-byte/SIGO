# Entrega de interfaces Mayorista — PR #72

Código verificado: `8e4995c2fe8ad8ec9e679ad7c7c3551de273c631`, sobre la aceptación persistente `79a89f04aef4be31fcf6292460a8784d132051ce`. No es una declaración de cierre definitivo de todo el alcance comercial original.

## Implementación de esta etapa

- Diez accesos dentro del menú SIGO, condicionados por empresa, módulo, disponibilidad y rol. Sin configuración confirmada no aparece la sección Mayorista. Las páginas reutilizan el portal operativo existente y conservan su sesión al cambiar de sección.
- Registro con Minorista, Mayorista y Mixto. Mayorista/Mixto llaman a la declaración empresarial después de crear la empresa y al completar la confirmación de correo. La preferencia de alta no es un permiso; el servidor verifica propietario. Minorista conserva el camino previo sin declaración adicional. Una falla de declaración se informa y conserva la preferencia; no modifica la suscripción.
- Clientes canónicos SIGO disponibles para asignación administrativa, incluyendo los todavía no asignados. El servidor verifica empresa, toma nombre/dirección del cliente real y guarda exclusivamente asignaciones Mayorista. El vendedor recibe únicamente clientes habilitados/asignados. No se habilita crear clientes SIGO desde una tabla QA.
- Vendedores, objetivos, rutas con días, orden de recorrido, coordenadas y vehículos con patente/capacidad/chofer. Calendario y orden llegan al catálogo offline sin otro catálogo comercial.
- Pedidos con productos, estados derivados de la carga, entrega, crédito y trazabilidad; botones operativos solamente en estados compatibles. La cantidad originalmente pedida se conserva.
- Depósito, cargas, reparto, entrega y rendición con accesos propios de armador/chofer. Gerencia administra metas; Administración puede consultarlas sin mostrar un formulario que el servidor rechace.
- Precios/productos/stock compartidos no ofrecen escritores paralelos bloqueados. Cobranzas usan la cuenta SIGO. Rendición no vuelve a registrar el cobro.
- Formularios conservan UUID en un reintento fallido mientras el portal permanece montado. Los pedidos del vendedor mantienen su cola cifrada persistente y su UUID. No se afirma persistencia local de formularios administrativos tras cerrar el navegador.
- Buscador aprobado conservado; el adaptador entrega marca, código interno y EAN canónicos. Estilos comunes del portal, captura en 390 y 1280 px, sin cambio del diseño Minorista.

## Evidencia

[CI Mayorista 38645984431](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38645984431): SUCCESS. TypeScript, build Mayorista, pruebas Node, RLS, 92 controles API/PostgreSQL, 53 pruebas Chromium, Docker y runtime desactivado por defecto. Se agregan 16 controles UI independientes: login, vendedores, asignación, objetivos, vendedor/pedido/sincronización, vehículos, aprobación/carga, picking, despacho/entrega, crédito/venta/stock, cobro/Caja/cuenta, rendición sin segundo cobro, factura con emisor existente y WSFE simulado, métricas y tamaños 390/1280.

[Build SIGO 38645984389](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38645984389): SUCCESS. Controles críticos y seguridad de notificaciones aprobados. Hash del punto de entrada anterior, quitando únicamente el launcher añadido, verificado. Las funciones Minoristas no se reimplementan. Esto no sustituye una regresión funcional autenticada de todos los módulos Minoristas en una empresa real.

Los 16 controles UI ejecutan Chromium → HTTPS → backend existente → PostgreSQL CI real, en esquemas aislados y con identidades ficticias. El emisor fiscal es el existente; WSFE y transporte Supabase fiscal están simulados, y la reserva/conciliación se persisten en PostgreSQL. No se emiten comprobantes reales. Los grupos de pruebas se solapan; no sumarlos como casos únicos.

La QA persistente aprobada sigue en deployment `046dfd7b-a0a2-4904-b8a3-cb3f76fd03cd`, commit `79a89f0`. Su informe y /health sobrevivieron al reinicio. No se repitió esa aceptación sin cambios: las nuevas funciones fueron verificadas en CI porque modifican el adaptador.

Preview del código: [comercial-q7a7stp8g-telmoaguirre33-byte.vercel.app](https://comercial-q7a7stp8g-telmoaguirre33-byte.vercel.app), READY, deployment `dpl_EUysJHBb3eXiAxrLeGfK4GbtN5Cg`. READY confirma publicación del frontend, no una sesión operativa autenticada de SIGO.

## Matriz funcional

UI = controles Chromium de esta etapa o los controles previos conservados; QA = aceptación persistente 79a89f0, indicada como Base. CI significa PostgreSQL efímero con fuente SIGO de prueba. Ninguna marca equivale a prueba con datos productivos.

| FUNCIÓN | IMPLEMENTADA | PROBADA UI | PROBADA QA | FÍSICA PENDIENTE | OBSERVACIÓN |
|---|---|---|---|---|---|
| Tipo de negocio / activación / Mixto | Sí | Pendiente alta SIGO real | Base SQL | No | RPC por empresa; sin vínculo de licencia |
| Matriz activar/desactivar / auditoría | Sí | Contrato UI | Base SQL | No | Override conservado |
| Diez accesos dentro de SIGO | Sí | Portal sí; launcher SIGO pendiente | Pendiente | No | Ocultos sin configuración verificada |
| Panel y filtros | Sí | Sí | Base + CI | No | Eventos financieros separados |
| Margen / deuda vencida | Parcial | Ausencia explícita | Sin fuente confirmada | No | No se inventa cero ni costo histórico |
| Objetivos generales / vendedor / períodos | Sí | Sí | Base + CI | No | Gerencia edita; vendedor ve propios |
| Vendedores / actividad / asignación | Sí | Sí | Base; cambios nuevos CI | No | Roles administrados en Usuarios |
| Cliente SIGO y asignación | Sí | Sí | Nueva asignación CI | No | Un solo maestro; backend valida tenant |
| Historial / frecuencia / habituales del cliente | Parcial | Pedidos y visitas; frecuentes vendedor | CI parcial | No | Falta ficha integral de historial compartido |
| Zonas / rutas / días / orden | Sí | Sí | Cambios nuevos CI | GPS | Calendarización como metadata |
| Visitas y GPS | Sí, básica | Controles previos | Base | GPS / recorrido | Motivos detallados pendientes |
| App Vendedor | Sí | Sí | Base + CI | Android / dos teléfonos | Misma API Mayorista |
| Pedidos offline / cifrado / sincronización | Sí | Sí | Base + CI | Avión / reapertura | UUID y cola conservados |
| Buscador / frecuentes / marca / código / EAN | Sí | Sí, 5.000 productos | Campos compartidos CI | Cámara / lector | Implementación aprobada reutilizada |
| Presentaciones / listas / ofertas | Parcial | QA nativo sí | Fuente compartida: unidad/lista general | No | Listas especiales compartidas bloqueadas |
| Revisión y toma de pedido | Sí, básica | Sí | Base + CI | No | Observaciones/descuentos avanzados pendientes |
| Administración / recepción / aprobación | Sí | Sí | Base + CI | No | No se cuenta pedido como venta |
| Todos los estados solicitados | Parcial | Estados existentes | Base + CI | No | No se simulan estados sin transición backend |
| Crédito por pedido | Sí | Sí | Base + CI | No | Autorización actual al confirmar venta tras entrega |
| Depósito / picking / lectura | Sí | Sí | Base + CI | Lector | Preparación sobre carga planificada |
| Faltantes / cantidades originales | Sí | Controles previos | Base + CI | No | No se borra lo pedido |
| Sustituciones autorizadas | Pendiente | No | No | No | No implementar reemplazo sin contrato comercial |
| Cargas individuales / consolidadas | Sí | Sí | Base + CI | No | Una asignación compatible por pedido |
| Vehículos / patente / capacidad / chofer | Sí | Sí | Nuevo CI | No | Configuración simple, sin flota adicional |
| Hoja de carga / impresión PDF | Sí | Generación y botón | Base | Impresora | Guardar como PDF del navegador |
| Reparto | Sí | Sí | Base + CI | Recorrido | Solo cargas del responsable |
| Entrega completa / parcial / rechazo | Sí | Completa nueva; parcial controles previos | Base + CI | Recorrido | Vinculada al pedido |
| Cobro / Caja / cuenta compartida | Sí | Sí | Base + CI | No | Contado/transferencia/crédito; cobro parcial |
| Cobranza vendedor/chofer autorizada | Parcial | Rendición sí | Base parcial | No | Cobro compartido confirmado por administración |
| Rendición / revisión / cierre | Sí | Sí | Base + CI | No | Sin repetir cobranza al revisar |
| Facturación / conciliación ARCA | Homologación preparada | Simulación CI | Base simulada + CI | No | Emisor SIGO; no CAE real ni ARCA productiva |
| Stock / venta una vez | Sí | Sí | Base + CI | No | Misma fuente comercial en fixture |
| Devoluciones físicas / averiado | Parcial | Controles previos | Base parcial | Recepción física | Falta devolución/nota de crédito compartida completa |
| Informes / alertas / rankings / rotación | Sí, con límites de fuente | Sí | Base + CI | No | Margen/vencimiento dependen de datos faltantes |
| Cinco roles / RLS / aislamiento / revocación | Sí | Gerencia/vendedor/armador/chofer; Administración parcial | Base + CI | No | Autorización en servidor |
| Caja / Ventas / Stock / Cuenta corriente SIGO | Reutilizadas | Circuito compartido CI | Base | No | No se crean equivalentes Mayorista |
| Productos / Precios / Ofertas SIGO | Reutilizadas | Vista de consulta | Base + CI parcial | No | Edición en funciones existentes |
| Compras / sugerida / Clientes / Usuarios / Configuración SIGO | Reutilizadas | Regresión estática/build | No regresión real completa | No | Fallo previo de Compras fuera de alcance |
| ARCA / Devoluciones / Informes SIGO | Reutilizadas | Circuito fiscal simulado / controles existentes | Base parcial | Impresora | No se alteran sus flujos |
| Empresa Mixta / fuente única | Preparada | Fixture de fuente única | Base + CI | No | Falta empresa SIGO de prueba vinculada |
| Recuperación / idempotencia / trazabilidad | Sí | Sí | Base + CI | Dos teléfonos | Formularios administrativos: retry en sesión |

## Bloqueos y pendientes reales

1. `accept-deploy` canceló el cambio QA de commit con “the user did not approve this action”. Quedó un único cambio no destructivo en patch `971bf99f-c94b-42ca-8c05-7f1eba970ccf`: servicio `mayorista-api-qa`, de `79a89f0` a `8e4995c`. No hay cambios de infraestructura, variables o base. El usuario debe aprobar la herramienta o aplicar ese cambio en el dashboard; no se sustituyó el deployment operativo.
2. Falta una empresa/sesión SIGO de prueba vinculada en un entorno existente no productivo con las RPC empresariales y la fuente comercial compartida. La aceptación anterior usa fixtures aislados; sus usuarios se revocan al terminar. No permite acreditar ingreso de un cliente SIGO real al circuito nuevo ni probar el launcher autenticado o toda la regresión Minorista. No se aplicaron propuestas SQL a Supabase productivo ni se inventó un vínculo.
3. Las extensiones marcadas Parcial/Pendiente requieren continuar implementación: listas y condiciones avanzadas compartidas, vencimientos/costos históricos, ficha comercial integral, estados adicionales, sustituciones y devoluciones/notas de crédito compartidas. No se ocultan como pendientes físicos ni se declara terminado el módulo completo.
4. CAE real de homologación requiere credenciales/certificados reales en un canal privado. La simulación aprobada sigue siendo la única aceptación fiscal realizada; no es necesaria para repetir la simulación.

## Checklist físico

Usar exclusivamente una empresa de prueba QA, antes de operar datos reales:

- Instalar SIGO Vendedor en Android y verificar empresa/vendedor correctos.
- Descargar catálogo, apagar datos/Wi-Fi, crear pedido y visita; confirmar estados pendientes.
- Cerrar/reabrir en modo avión, desbloquear con clave local y comprobar pedido/catalogo conservados.
- Recuperar conexión y reintentar: un UUID, un pedido y un movimiento de stock por operación.
- Usar dos teléfonos del mismo vendedor: pedidos distintos no se mezclan ni se duplican.
- Conceder/denegar GPS y cámara; comprobar ubicación y alternativa por teclado/lector.
- Probar lector físico con EAN/código y confirmar que el producto resaltado es el agregado.
- Imprimir hoja de carga/reparto; guardar PDF; recorrer una ruta de prueba con entrega parcial y devolución inspeccionada.

Sin merge, main ni publicación productiva. El trabajo permanece en PR #72; los commits aprobados se conservan.
