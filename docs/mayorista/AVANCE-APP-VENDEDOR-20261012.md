# App Vendedor — continuación del estado existente

Rama exclusiva: `feat/mayorista-distribuidora-offline-20261012`.
Base recuperada por conector GitHub: `e97d94dc8305f6b34ff3291e3145411b33763602`.
La clonación no pudo completarse porque el proxy del entorno no respondió. Se recuperaron los archivos Mayorista exactos de ese commit, sin inventar un checkout ni repetir el desarrollo existente.

## Aplicación independiente

Nueva entrada en `src/modules/mayorista/demo/`; no se importa desde SIGO ni modifica su menú, package.json, configuración de hosting o módulos actuales.

- Inicio e identificación de empresa/vendedor con identidades ficticias seleccionables.
- Clientes asignados, búsqueda, rutas y mapa de coordenadas offline. El mapa es esquemático; la navegación de calles abre Google Maps y requiere conexión.
- GPS con permiso del dispositivo y registro local de visitas con resultado y nota.
- Catálogo, presentaciones unidad/pack/caja/bulto, precios, oferta demo y objetivos comerciales.
- Borrador persistente en IndexedDB con revisión para detectar edición concurrente.
- Pedidos pendientes, errores, detalle e historial; indicadores diarios de pedidos y visitas.
- Shell offline con service worker exclusivamente en el origen de la demo; manifest para instalación Android.

## Recuperación de pedidos

Se reutiliza `PedidosIndexedDB`, preservando su base y esquema existentes. Se agregaron exclusión entre pestañas mediante Web Locks, actualización transaccional, validación de fecha del acuse y creación idempotente con UUID opcional del borrador. Si se interrumpe entre guardar pedido y limpiar borrador, el mismo UUID evita crear otro pedido al reintentar.

El catálogo usa claves compuestas sin colisión; conserva lectura de claves antiguas verificando empresa/vendedor.

El simulador de recepción está desactivado por defecto y guarda acuses únicamente en IndexedDB. La pantalla distingue «Recibido por simulador» de una recepción real. No existe conexión a servidor Mayorista, Supabase, Caja, Ventas, stock ni facturación.

## Seguridad y alcance

Las identidades seleccionables son solo demostración, no login ni autorización real. No cargar datos personales reales. El filtrado local por empresa/vendedor y los Web Locks no sustituyen autenticación y RLS en servidor. Dispositivo compartido, cifrado, revocación y limpieza segura siguen pendientes antes de uso real.

La administración Mayorista y la integración real siguen pendientes. Esta entrega prioriza App Vendedor y demostración HTTPS conforme a la instrucción de continuación.

## Verificación reproducible

Desde `src/modules/mayorista/demo/`:

```sh
npm run build
node ../tests/unit.mjs
npm test
```

El build aislado usa Node 24 para transformar los cinco módulos TypeScript originales y generar la aplicación estática; no realiza chequeo de tipos `tsc`. No se ejecuta el build principal de SIGO, que invoca scripts que modifican módulos actuales.

Pruebas de navegador preparadas: IndexedDB real, 100 pedidos, separación local de empresas/vendedores, UUID estable, conflicto de borrador, visitas, acuse inválido, caída posterior a recepción, concurrencia, precio cambiado, catálogo vencido, transacción abortada, recarga offline y reapertura de Chromium.

Estado a esta fecha: build aislado ejecutado, revisión sintáctica JavaScript ejecutada y 17 pruebas unitarias ejecutadas: 17 aprobadas, 0 fallidas (Node 24). Se ejecutó el archivo de pruebas directamente para evitar el aislamiento de procesos del runner en este entorno. Chromium no pudo iniciarse dentro del sandbox (`setsockopt: Operation not permitted`) y el servidor local de pruebas tampoco pudo abrirse. Las solicitudes de permiso para habilitar red se interrumpieron; **no hay pruebas de navegador aprobadas**. Android físico, persistencia offline real, GPS, instalación PWA y recepción remota permanecen pendientes.
