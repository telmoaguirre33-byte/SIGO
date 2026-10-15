# Cierre de extensiones funcionales Mayorista — PR #72

Base conservada: `a7045e0686d4aee39df66a0353cea8342ba9f1af`. Esta entrega sustituye la matriz de pendientes de código de CIERRE-VISUAL-20261014.md; conserva su evidencia histórica. El HEAD de entrega se consulta en PR #72 y en el único cambio de commit preparado para MAYORISTA-QA.

## Resultado y alcance verificable

Se implementaron ficha integral, cinco motivos de visita, políticas de listas/presentaciones derivadas de SIGO, condiciones cifradas del pedido, transiciones y anulación, sustituciones cotizadas por servidor, cobradores autorizados, recepción/conciliación de devoluciones, saldo a favor autorizado y notas de crédito reutilizando ARCA SIGO. Los registros financieros, de stock y clientes continúan en las tablas canónicas SIGO.

Los perfiles Mayorista se asignan a identidades existentes de Usuarios SIGO. No se cambia `empresa_usuarios.rol` ni los permisos Minoristas. Se verifican los valores canónicos `owner/admin/seller/warehouse/client`, con perfiles independientes en Mayorista. Auth SIGO conserva su tabla `auth.sessions`; las sesiones Mayorista se verifican por su propia persistencia y firma, sin sustituirla por una vista.

Una sesión SIGO verificada puede ingresar al módulo y vincular automáticamente su empresa habilitada. El servidor comprueba identidad, membresía, flags y disponibilidad de la fuente; conserva desactivaciones/perfiles existentes. Solo crea metadata del módulo, nunca otra empresa, catálogo, cliente, stock o cuenta canónica. Empresa con datos QA previos requiere conciliación explícita de su fuente; no se sobrescribe. El origen Auth SIGO es configuración exclusiva del servidor, no un valor recibido del navegador.

Matriz aprueba un destino común una vez; nuevas empresas Mayoristas/Mixtas lo heredan automáticamente, manteniendo el override individual. Ni ingreso ni renovación reescriben el tipo, el flag o la licencia.

## Evidencia

Código funcional `7ce32e8e2418119549d39476b1e5fa19d3408667`:

- [CI Mayorista 38662325161](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38662325161): SUCCESS. TypeScript estricto, build Mayorista, Node, RLS, 92 grupos de controles API/PostgreSQL, 42 controles UI operativos, 53 pruebas Chromium, Docker y runtime sin red/desactivado por defecto.
- [Build SIGO 38662325167](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38662325167): SUCCESS.
- [Matriz Mayorista 38662325162](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38662325162): SUCCESS.
- El hash del código previo de Administrar se conserva al retirar exclusivamente las adiciones Mayorista; mismo control para el punto de entrada SIGO. Los 25 controles críticos existentes aprueban. SOVI, PROSPECCIÓN, Compras y los flujos Minoristas no se modifican.
- Compras conserva su fallo previo del workflow aislado; no se lo atribuye a Mayorista ni se lo corrige en esta tarea.

Los grupos se solapan; no sumar 92 + 42 + 53 como casos únicos. Los controles adicionales de precio, cobradores, devolución, bridge SIGO y nota de crédito se ejecutan dentro de esos grupos y quedan identificados en los logs.

UI: Chromium → HTTPS → backend operativo → PostgreSQL CI, con React y formularios reales. Verifica los cinco perfiles, altas/asignaciones, objetivos, pedido cifrado/sincronización, depósito, carga, entrega, créditos, cobranza, rendición, ficha, motivos, listas, sustitución, devoluciones y nota de crédito. Incluye primer acceso desde la sesión SIGO, destino común, Minorista oculto, Mayorista automático, Mixto y override Matriz. Las identidades/datos son ficticios; los transportes Auth Supabase/WSFE externos están simulados. No acredita sesión Supabase de un cliente real.

## Matriz completa

UI/PG = evidencia CI; Base QA = aceptación persistente aprobada en `79a89f0`. **Los cambios de esta entrega aún no se aplicaron a Railway**: su aceptación persistente nueva queda para el único despliegue preparado.

| FUNCIÓN | IMPLEMENTADA | PROBADA UI | PROBADA QA | FÍSICA PENDIENTE | OBSERVACIÓN |
|---|---|---|---|---|---|
| Alta/configuración Minorista | Sí | React + SQL CI | Nueva aceptación pendiente | No | No muestra sección Mayorista |
| Activación Mayorista automática | Sí | React + SQL CI | Nueva aceptación pendiente | No | Flag persistente por empresa |
| Mixto y funciones compartidas | Sí | React + SQL CI | Base; cambios pendientes | No | Productos/stock/cuentas canónicos |
| Matriz override/auditoría/destino común | Sí | React + SQL CI | Nueva aceptación pendiente | No | Una configuración común, override conservado |
| Ingreso desde sesión SIGO / primera empresa | Sí | Sí; Auth externo simulado | Nueva aceptación pendiente | No | Identidad verificada; no alta manual del módulo |
| Diez accesos y administración integrada | Sí | Sí | Nueva aceptación pendiente | No | Navegación con sesión conservada |
| Panel, filtros y gráficos | Sí | Sí | Base; nuevos cálculos pendientes | No | Pedido, venta, entrega, factura y cobro separados |
| Margen histórico / vencimientos | Ausencia explícita | Sí | Sin fuente histórica suficiente | No | Sin datos/no disponible; nunca cero inventado |
| Ventas/facturación netas / cobranzas | Sí | Sí + PG | Nueva aceptación pendiente | No | Crédito por devolución no es cobranza; NC resta facturación |
| Metas generales/vendedor/períodos | Sí | Sí | Base; extensiones pendientes | No | Objetivo, real, %, falta; propias en vendedor |
| Vendedores y actividad | Sí | Sí | Base; cambios pendientes | No | Asignaciones y perfiles del módulo |
| Usuarios/perfiles vinculados a SIGO | Sí | Alta y edición UI + PG | Nueva aceptación pendiente | No | Mismo UUID; sin modificar roles Minoristas |
| Ficha comercial integral cliente | Sí | Sí | Nueva aceptación pendiente | No | Compras compartidas, pedidos, visitas, cuenta, cobros y devoluciones |
| Frecuencia / habituales / última compra | Sí | Ficha y buscador | Nueva aceptación pendiente | No | Fuentes canónicas; cantidades netas devueltas |
| Zonas / rutas / días / recorrido | Sí | Sí | Base; cambios pendientes | GPS / recorrido | Clientes/vendedores asignados |
| Visitas sin pedido / cinco motivos | Sí | Sí | Nueva aceptación pendiente | GPS | Cerrado, no necesita, sin dinero, volver, otro |
| App Vendedor / misma API | Sí | Sí | Base; cambios pendientes | Android | Extensión del módulo |
| Offline / cifrado / borrador / cola | Sí | Chromium / IndexedDB | Base; cambios pendientes | Avión / reapertura | UUID y datos conservados |
| Sincronización / idempotencia | Sí | Sí + concurrencia PG | Base; cambios pendientes | Dos teléfonos | Acuses, reintentos y conflictos sin duplicados |
| Buscador 5.000+, teclado y EAN | Sí, reutilizado | Sí, 5.000 productos | Campos y precios PG CI | Cámara / lector | 8–10 resultados, foco y frecuentes |
| Unidad/pack/display/bulto/caja | Sí | Sí + PG | Nueva aceptación pendiente | No | Factores base, metadata del mismo producto |
| Lista por cliente / volumen / vigencia | Sí | Sí + PG | Nueva aceptación pendiente | No | Política derivada; no segundo precio base |
| Ofertas/promociones SIGO | Sí | Lectura + PG | Nueva aceptación pendiente | No | Oferta vigente/expirada y acuse anterior probados |
| Revisión / observaciones / condición de pago | Sí | Sí | Nueva aceptación pendiente | No | Condiciones y renglones cifrados/persistidos |
| Pedidos / aprobación / trazabilidad | Sí | Sí | Base; cambios pendientes | No | Acuse original inmutable |
| Estados / transiciones / anulación | Sí | UI + modelo + PG | Nueva aceptación pendiente | No | Preparación/carga/despacho/entrega/devolución/cierre |
| Crédito por pedido | Sí | Sí | Base; cambios pendientes | No | Gerencia; autorización final previa a contabilización |
| Depósito / picking / preparación | Sí | Sí | Base; cambios pendientes | Lector | Original/preparado/faltante separados |
| Faltantes pendientes/cancelados | Sí | Sí + modelo | Base; cambios pendientes | No | No se borra cantidad pedida |
| Sustitución autorizada completa | Sí | Sí + PG | Nueva aceptación pendiente | No | Solicitado, faltante, sustituto, cantidad, autor, fecha y precio servidor |
| Cargas individuales/consolidadas | Sí | Sí | Base; cambios pendientes | No | Una asignación compatible; equipo y ruta |
| Vehículos / patente / capacidad / chofer | Sí | Sí | Base; cambios pendientes | No | Configuración simple |
| Hoja carga / reparto / PDF | Sí | Generación y controles | Base | Impresora | PDF por impresión del navegador |
| Reparto / orden / observaciones | Sí | Sí | Base; cambios pendientes | Recorrido | Cargas asignadas al chofer |
| Entrega completa/parcial/rechazo/devolución | Sí | Sí + pruebas conservadas | Base; cambios pendientes | Recorrido | Vinculada al pedido y evento original |
| Cobranza / Caja / cuenta compartida | Sí | Sí | Base; cambios pendientes | No | Cuenta y Caja SIGO; sin segundo asiento |
| Cobro vendedor/chofer autorizado | Sí | Sí + PG | Nueva aceptación pendiente | No | Límite, revocación, UUID cifrado y autor |
| Rendición / revisión / cierre | Sí | Sí | Base; cambios pendientes | No | Revisar no vuelve a cobrar |
| Devolución SIGO / recepción física | Sí | Sí + PG | Nueva aceptación pendiente | Recepción real | Mismo UUID físico al conciliar; venta conservada |
| Vendible / averiada / revisión | Sí | Sí + PG | Nueva aceptación pendiente | Inspección real | Averiada/revisión no quedan disponibles |
| Devolución CC ya cobrada / saldo a favor | Sí | Sí + PG | Nueva aceptación pendiente | No | Autorización expresa gerencia; asiento canónico |
| Factura SIGO / conciliación | Sí | Simulación | Base simulada; cambios pendientes | No | Emisor existente; nunca ARCA productiva |
| Nota crédito / factura asociada / conciliación | Sí | Simulación UI + PG | Nueva aceptación pendiente | No | Comprobantes SIGO, reserva única, acuse perdido recuperado |
| Stock / venta exactamente una vez | Sí | Sí + PG | Base; cambios pendientes | No | Stock canónico, también para sustitutos/devoluciones |
| Informes / alertas / rankings / rotación | Sí | Sí | Base; cambios pendientes | No | Devoluciones canónicas sin doble conteo físico |
| Cinco roles / RLS / empresa A-B / revocación | Sí | Sí + PG | Base; cambios pendientes | No | Autorización servidor, perfiles compatibles SIGO |
| Caja/Ventas/Productos/Stock/Precios/Clientes/Cta. Cte. existentes | Reutilizadas | Flujo compartido CI | Base; cambios pendientes | No | No se reimplementan |
| Compras/sugerida/Ofertas/Usuarios/Configuración/Informes existentes | Conservadas | Contratos/build/regresión estática | Sin regresión autenticada completa | No | Compras previo fuera de alcance; no cambios funcionales |

## Cuándo se mueve stock y dinero

Pedido, aprobación, picking, confirmación de carga y salida no descuentan nuevamente stock SIGO. La confirmación comercial de la entrega escribe venta/stock/Caja o cuenta corriente una vez, con el UUID del evento de entrega. Reintento devuelve la operación existente. El sustituto autorizado mueve su SKU real; la cantidad solicitada original se conserva.

Una devolución de reparto queda registrada físicamente y se concilia por su mismo UUID en Devoluciones SIGO. La clasificación vendible suma stock; averiada/revisión neutralizan la restitución a disponible dentro de la transacción. Una inspección posterior suma vendible una sola vez. Rechazo de mercadería nunca vendida no genera una venta/devolución contable ficticia.

Cuenta corriente ya cobrada requiere autorización explícita de gerencia para registrar crédito real a favor. No se manipula saldo antes de llamar la RPC, no se simula una cobranza, no se cambia la función Minorista. Se usa una extensión para ese caso no cubierto por su guardia, con las mismas tablas de devolución/stock/cuenta y permisos estrictos.

Factura y NC no vuelven a mover stock ni cuenta. La NC utiliza los helpers ARCA existentes de cálculo, ticket, solicitud y consulta; se reserva en `arca_comprobantes`, vinculada a factura/devolución por el control Mayorista. También se vincula una devolución registrada antes de emitirse la factura. Reservas, datos fiscales y autorizaciones conservan historial.

## Preparación de un solo despliegue QA

Destino existente exclusivo: proyecto MAYORISTA-QA `b9a7da94-1d87-46fe-b4da-c7e241ebe185`, entorno `qa` `2addc3e9-f088-42df-a72c-c233fd4308cb`, servicio `mayorista-api-qa` `9053689a-0e32-4f3c-b5da-3c01e480a9c6`, PostgreSQL `9120b029-d20c-4073-a9cc-003953f60817`.

Live conservado: `046dfd7b-a0a2-4904-b8a3-cb3f76fd03cd`, HEAD `79a89f04aef4be31fcf6292460a8784d132051ce`. El patch existente `971bf99f-c94b-42ca-8c05-7f1eba970ccf` debe conservar un solo cambio de commit del servicio API y apuntar al HEAD final verificado. No ejecutar accept-deploy durante este cierre.

Paquete SQL: 006/007 actualizadas; 008 operación/cliente/cobradores/devoluciones, 009 precios/condiciones, 010 NC, 011 destino común. Son propuestas `NO_APLICAR` para la fuente compartida, ejecutadas solamente en fixtures CI. El predeploy existente instala/valida esas extensiones en un esquema aislado dentro de la misma base QA; no crea bases ni servicios. Una fuente SIGO existente deberá recibirlas únicamente en su entorno no productivo autorizado, no en producción.

Para ingreso integrado real, la conexión del backend debe compartir la fuente canónica SIGO validada y requerirá los valores del entorno SIGO **no productivo existente**:

- `MAYORISTA_SIGO_ORIGIN`: origen HTTPS de esa interfaz, para CORS exacto.
- `MAYORISTA_SIGO_AUTH_URL`: origen Auth de ese entorno; nunca recibido desde el cliente.
- `MAYORISTA_SIGO_AUTH_ANON_KEY`: clave pública del mismo proyecto Auth, por configuración del servidor.

No se inventan estos valores ni se apunta al proyecto productivo para completar una prueba. Falta identificar/acceder a ese entorno y empresa existente para la prueba autenticada externa; se solicitó su identificación. La simulación CI ya prueba bridge, firma, persistencia, roles, primer ingreso y circuito completo. READY/build no equivale a esa aceptación externa.

Después del único despliegue: health/readiness + SHA exacto, login, cinco roles, aislamiento, circuito persistente, UUID/reintentos, stock/venta/Caja/cuenta una vez, factura y NC simuladas, reconexión/reinicio. Si falla predeploy o healthcheck, conservar el deployment anterior. No merge, main, producción, nueva infraestructura ni credenciales ARCA productivas.

## Checklist físico y externo

1. Android: instalar App Vendedor QA; descargar clientes/rutas/catálogo y comprobar objetivos propios.
2. Modo avión: pedido, visita y cobranza autorizada; cerrar/reabrir con clave local; conservar UUID/borrador.
3. Reconectar/reintentar con dos teléfonos: una recepción por UUID y una contrapartida financiera/stock.
4. GPS y cámara/lector: conceder/denegar permisos; verificar alternativa por teclado, selección exacta y foco.
5. Imprimir carga/reparto y guardar PDF; recorrer ruta QA con parcial/rechazo/devolución/inspección/rendición.
6. ARCA real: exclusivamente homologación con credenciales/certificado externos por canal privado. Hasta entonces, simulación segura identificada como tal.
