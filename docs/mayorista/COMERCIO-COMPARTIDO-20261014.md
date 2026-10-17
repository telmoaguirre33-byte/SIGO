# Comercio compartido Mayorista — 14/10/2026

Continuación de `dad1d41`, sin rehacer buscador, infraestructura, panel ni metas. Esta etapa prepara transacciones sobre las tablas reales SIGO; **no activa todavía el circuito compartido en producción**.

## Implementado

- Propuesta SQL `006_comercio_compartido_NO_APLICAR.sql`, transaccional y con rollback final. Reutiliza `productos`, `clientes_sigo`, `ventas_sigo`, `venta_items_sigo`, `cliente_movimientos_sigo` y `caja_movimientos_sigo`. Las tres tablas nuevas guardan únicamente vinculación, solicitud y auditoría Mayorista.
- Una entrega parcial registra exclusivamente las unidades efectivamente entregadas. El UUID del evento de entrega identifica la venta: reintentar la misma operación devuelve el comprobante existente; cambiar su contenido se rechaza. Stock y movimientos financieros se confirman en una misma transacción.
- Si excede crédito, conserva la solicitud y responde `requiere_autorizacion`. El propietario aprueba/rechaza ese pedido con motivo, usuario y fecha; no cambia el límite global del cliente. La autorización no descuenta stock ni contabiliza dinero hasta confirmar la entrega.
- Precio validado en servidor con el producto y oferta vigentes. Precio cambiado o stock insuficiente pide revisión y conserva el pedido de origen. No se aceptan precios arbitrarios ni se simula soporte de listas especiales.
- Cobros reutilizan `registrar_cobro_cliente_sigo_v2`, con UUID, huella y comprobante único por empresa. Una respuesta perdida no duplica Caja ni cuenta corriente. Se mantiene el rechazo de sobrecobros de SIGO.
- Sesión SIGO real, vigencia y revocación, empresa activa, membresía owner/admin, permisos y flag Mayorista se verifican en servidor. Las tablas de vinculación tienen RLS y escritura/lectura directa denegada a usuarios. Ninguna clave de servicio pasa al navegador.
- El portal recibe RPC autenticadas del host SIGO y recupera estados/saldos/comprobantes mediante lectura por empresa. Los controles nuevos solo se muestran si la identidad emitida por el backend declara `fuenteComercial: 'sigo'`; adicionalmente el servidor SQL exige su propia vinculación de fuente.

## Activación pendiente, explícita

El backend QA actual **no declara** esa fuente ni está conectado al catálogo/clientes compartidos. Por tanto los controles nuevos permanecen deshabilitados en el runtime actual, y las tablas QA existentes siguen siendo QA. No se aplicó SQL ni se cambió Railway.

Antes de activar deben implementarse/verificarse: lectura de maestros SIGO con las mismas identidades de producto/cliente/empresa, transición del backend y bloqueo de sus escritores financieros QA, recuperación de operaciones en curso y vinculación de fuente/revisión por empresa. La propuesta SQL no es una migración automática ni una autorización para mezclar ambas fuentes.

La venta devuelve `ventaId` de SIGO y `facturacion: pendiente`: **no emite factura ARCA**. Falta integrar esa referencia al flujo existente de facturación y devoluciones, junto con vencimientos, costos y métricas de fuentes compartidas. Las listas Mayorista especiales, descuentos autorizados y todos los estados del pedido aún requieren integración. La comprobación con PostgreSQL efímero no sustituye aceptación persistente ni pruebas Android reales.

## Verificación

Pruebas Node: fuente QA no escribe en SIGO; entrega parcial/UUID estable; rechazo sin venta; aislamiento de respuesta; cobranza con centavos. Se conserva la prueba de hash del componente previo de Configuración retirando únicamente las adiciones Mayorista.

La suite API instala la propuesta exclusivamente en `mayorista_package_ci` localhost: tablas SIGO obtenidas de migraciones reales, crédito por pedido, stock único, Caja/cuenta, reintento, conflicto de UUID, comprobante duplicado, lectura recuperable, permisos y sesiones expiradas/revocadas. La evidencia de ejecución se publica en PR #72 después de comprobar la CI del HEAD correspondiente.
