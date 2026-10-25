# Aceptación física final — postergada

No bloquea el desarrollo automatizable. No declara P0 cerrado ni comercialización aprobada.

## Antes de comenzar con Telmo

- [ ] Railway QA del HEAD final: SUCCESS; `/health` y `/readiness` correctos.
- [ ] CI Mayorista y Build aprobados; Preview exacto READY.
- [ ] Accesos QA privados para cinco roles; sin datos comerciales reales.
- [ ] Confirmar empresa sintética compartida en PC y Android.
- [ ] Revisar los **dos pedidos existentes**: cliente, renglones, presentación, cantidad, importe, pago, fecha y UUID interno. Guardar evidencia antes de utilizarlos.

## Android

- [ ] Abrir con el perfil ya preparado: sin contraseña cotidiana adicional.
- [ ] Cerrar/reabrir; reiniciar teléfono; modo avión; conservar clientes, catálogo, borradores y los dos pedidos.
- [ ] Navegar Inicio/Nuevo pedido/Mis pedidos/Clientes/Ruta/Cobranzas/Objetivos con una mano.
- [ ] Buscar cliente/productos por variantes, códigos/EAN y tildes; cambiar presentación y cantidades sin contaminación entre productos.
- [ ] Editar un pedido de prueba permitido conservando UUID; pedidos enviados/consolidados sólo lectura.
- [ ] Recuperar conexión sin envío automático. Sincronización únicamente al autorizar expresamente los pedidos de evidencia.
- [ ] Pérdida de confirmación/doble pulsación: un pedido, una venta, un movimiento por operación.
- [ ] Cámara, lector real, GPS, impresión y bloqueo del sistema operativo.

## PC, otro teléfono y reparto real de prueba

- [ ] SIGO Preview → Mayorista mediante SSO, sin segundo login.
- [ ] Administración recibe exactamente el pedido del vendedor.
- [ ] Depósito realiza picking; carga consolidada; faltante/sustitución autorizada.
- [ ] Chofer recibe sólo sus cargas; entrega parcial/completa y devoluciones con comprobante.
- [ ] Cobranza, rendición y revisión administrativa; factura simulada.
- [ ] Conciliar pedidos, entregas, ventas, facturas simuladas, stock, caja, cobros y saldos exactamente una vez.
- [ ] Revocar un teléfono y verificar bloqueo al reconectar y vencimiento offline; conservar datos.
- [ ] Restauración local en perfil separado; nunca encima de los dos pedidos.

## Dependencias previas a comercializar

- [ ] Homologación fiscal real con credenciales externas, si se exige.
- [ ] Política de suscripción/suspensión y cobros reales aprobada y puesta a prueba.
- [ ] Backup Railway/retención/recuperación del proveedor verificados y restauración autorizada ensayada.
- [ ] Rendimiento posterior al patch medido en Railway; comparar SQL, JSON, transferencia y frontend.
- [ ] Autorización específica de producción. Sin merge ni publicación durante este desarrollo.
