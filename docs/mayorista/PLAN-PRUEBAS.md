# Plan de pruebas — Mayorista offline (sin modificar SIGO)

## Invariantes
1. No importar ni modificar Caja, Ventas, Compras, Stock, Facturación o componentes existentes.
2. Todo cambio se limita a `src/modules/mayorista/` y `docs/mayorista/` hasta la integración autorizada.
3. No crear tablas ni migraciones en Supabase de producción.
4. Ningún pedido local equivale a venta, factura, reserva o descuento de stock.
5. No dar por sincronizado un pedido sin acuse verificable del servidor.

## Pruebas funcionales pendientes
- Guardar 1, 15 y 100 pedidos sin red; reiniciar navegador y comprobar persistencia.
- Simular caída de red antes y después de la recepción del servidor; reintentar con el mismo UUID.
- Comprobar que la base remota admite una sola fila por (empresa_id, pedido_id).
- Verificar aislamiento entre empresas, vendedores y sesiones; probar acceso no autorizado.
- Forzar cuota de almacenamiento agotada y cierre de pestaña durante escritura.
- Modificar precio, cliente o producto en servidor antes de sincronizar y exigir revisión.
- Probar doble pulsación, dos pestañas, dos celulares y pedidos concurrentes.
- Validar fecha de actualización del catálogo y el modo sin catálogo.
- Comprobar instalación PWA, reinicio de Android, modo avión y retorno de señal.
- Revisar cifrado y borrado seguro de datos en equipos compartidos.

## Criterio de aprobación
No integrar al menú SIGO ni publicar hasta completar pruebas, revisión de seguridad y autorización explícita.
