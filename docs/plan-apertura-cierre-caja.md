# SIGO — Apertura, cierre y vuelto de caja

Estado: especificación técnica inicial. No desplegar ni aplicar migraciones sin pruebas.

## Integración existente
- Venta rápida: `src/VentaRapidaOperativa.tsx`; F9 confirma, F10 confirma e imprime.
- Cobro transaccional: `confirmarVentaSigo` en `src/ventas.ts`.
- Movimientos: `public.caja_movimientos_sigo`, con medios de pago separados.
- Nunca registrar el efectivo recibido como ingreso: el ingreso es el total de la venta; el vuelto es la diferencia entregada al cliente.

## Turnos
Crear tablas aditivas `caja_turnos_sigo` (empresa_id, caja_id, usuario_apertura, fecha_apertura, fondo_inicial, estado, fecha_cierre, usuario_cierre, efectivo_contado, efectivo_esperado, diferencia) y `caja_ajustes_sigo` (turno_id, tipo ingreso/retiro, importe, motivo, usuario, fecha).
RLS por empresa y permisos específicos. Una sola apertura activa por caja, garantizada en base de datos. Apertura, movimientos y cierre mediante funciones transaccionales, con claves de idempotencia y bloqueo concurrente. Los registros cerrados son inmutables; correcciones mediante ajustes auditados.

## Cálculos
Efectivo esperado = fondo inicial + cobros en efectivo confirmados + ingresos manuales - devoluciones en efectivo - retiros. Excluir débito, crédito, QR, transferencias y cuenta corriente. Diferencia = contado - esperado. Anulaciones deben descontarse exactamente una vez, sin borrar trazabilidad. Ventas previas al inicio del turno no pertenecen al turno. Registrar caja/turno en el momento de confirmar una venta para evitar asignaciones ambiguas.

## Cobro y vuelto
Mostrar TOTAL A COBRAR, medio de pago, EFECTIVO RECIBIDO, botones de billetes argentinos configurables y VUELTO. Validar recibido >= total y valores finitos, redondear a centavos; al confirmar, persistir únicamente el total de la venta como ingreso. Mantener foco del lector, navegación por teclado, F9 cobrar, F10 cobrar + ticket, F11 factura, F12 reimprimir. El pago electrónico no requiere vuelto. Pagos mixtos solo después de diseñar persistencia transaccional por componentes; no simularlos como medio único.

## Interfaz
Acceso lateral «Apertura / Cierre»; apertura con fondo y responsable; cierre con desglose por medio, efectivo esperado, contado, diferencia, motivo obligatorio si hay diferencia y exportación a Excel. Español de Argentina, ARS, compacto y adaptable a móvil. No abrir ventanas grandes que bloqueen el escáner.

## Pruebas obligatorias antes de publicar
- Apertura duplicada y cierre concurrente; empresas aisladas y permisos.
- Ventas en efectivo, medios electrónicos, devoluciones, anulaciones, reintentos y venta fallida.
- Billete insuficiente, pago exacto, vuelto correcto, redondeos.
- Dos cajas simultáneas, cambio de turno, diferencias y exportación.
- Regresión de F9–F12, impresión, lector, stock, compras y facturación.
- Build y deployment Preview READY; ninguna migración en producción ni merge a main sin validación.
- No modificar SOVI ni PROSPECCIÓN.
