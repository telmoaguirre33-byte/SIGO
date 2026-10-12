# SIGO Mayorista / Distribuidora — fase 1 (aislada)

Rama: `feat/mayorista-distribuidora-offline-20261012`.

## Estado
Se agregó `src/modules/mayorista/offline/pedidos-locales.ts`, motor inicial de borradores locales.
**No está conectado a la interfaz ni al servidor. No hay sincronización real ni prueba en Android.**
No se modificaron pantallas existentes, esquemas de Supabase, producción ni módulos actuales.

## Contrato
- El pedido conserva un UUID en todos los reintentos.
- `empresaId` y `vendedorId` aíslan la cola local por usuario/empresa.
- Los pedidos guardados localmente NO descuentan stock ni emiten comprobantes.
- El callback de envío es externo; NO conectar a tablas de ventas existentes.
- El servidor futuro deberá validar sesión, pertenencia a empresa, cliente, productos, lista de precios y permisos; imponer índice único `(empresa_id, pedido_id)` y acuse idempotente.
- Ante error de red, conservar el pedido para reintento; no dar por confirmado sin acuse.

## Pendientes antes de uso real
1. Reemplazar localStorage por IndexedDB transaccional, con cuotas y manejo de migraciones.
2. Seguridad de datos locales: cierre de sesión, dispositivos compartidos, cifrado según amenazas, minimización de datos.
3. Catálogos, precios, clientes y rutas offline con fecha de actualización y política de vencimiento.
4. API nueva exclusiva de Mayorista y tablas aisladas con RLS, en ambiente de prueba.
5. Manejo de conflictos, cambios de precio, productos inactivos y stock insuficiente.
6. Ensayos de desconexión, cierre forzado, almacenamiento lleno, doble toque, dos dispositivos, reintentos y concurrencia.
7. Pruebas de compilación y regresión; no publicar sin aprobación explícita.

## Restricción permanente
No modificar Caja, Ventas, Compras, Stock, Facturación, SOVI ni producción. Integrar únicamente después de pruebas y autorización.
