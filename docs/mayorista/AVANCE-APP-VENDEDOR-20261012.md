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


## Commits y comparación remota verificados

- `63e7f65c43a827f685e8fa6d34b863d9c1bc3295`: UUID estable, acuses y concurrencia en la cola IndexedDB; claves de catálogo sin colisión y lectura de datos antiguos.
- `611f97a1deddc168de2b35c398fcf792c9563f93`: aplicación independiente, build, pruebas y documentación.
- GitHub confirmó la actualización de la rama mediante comparación de SHA esperada, sin force push.
- Comparación remota `e97d94d...611f97a`: 17 archivos cambiados; 0 fuera de `src/modules/mayorista/` y `docs/mayorista/`. Los archivos previos restantes se conservaron desde el árbol base.

## Resultados ejecutados

- `node build.mjs`: terminó correctamente; cinco módulos TypeScript transformados y demo estática generada. No equivale a chequeo de tipos TypeScript ni a compilación principal de SIGO.
- `node --check app.mjs`, `storage.mjs`, `sw.js` y `../tests/browser.mjs`: finalizaron con código 0.
- `node ../tests/unit.mjs`: **17 aprobadas, 0 fallidas**. Validación de pedidos, empresa/vendedor, cliente/producto habilitados, cantidades/precios, catálogo vencido, copia de solicitud, identidad y fecha de acuse, constructor y verificaciones estáticas de aislamiento/cache.
- `node --test ../tests/unit.mjs` solo reportó el archivo agregado por el runner en este sandbox; por eso se repitió ejecutándolo directamente y se comprobaron las 17 pruebas individuales.
- `npm test` / pruebas Chromium: **no aprobadas ni completadas**. El servidor HTTP local no pudo abrirse en el sandbox; Chromium con perfil en `/tmp` falla con `setsockopt: Operation not permitted`. Las solicitudes de permisos de red se interrumpieron.
- Persistencia IndexedDB real, cierre inesperado, dos pestañas, recarga offline, PWA Android y GPS físico: **pendientes de ejecución**. El archivo `tests/browser.mjs` contiene los ensayos preparados.

## HTTPS: incidencia y bloqueo

Se creó únicamente el proyecto separado `sigo-mayorista-demo-20261012` (`prj_zWqWvjYqoIKJp3MnToDujdwZcPZG`) con archivos estáticos ficticios, sin integración Git, sin variables de SIGO y sin acceso a Supabase.

El conector devolvió `target: production` para su primer despliegue pese a solicitar `target: preview`. Al detectarlo se pausó inmediatamente **ese proyecto de demo** mediante `pause_project` (respuesta sin error). No se modificó el proyecto, dominio ni despliegue de SIGO actual.

La API luego rechazó `preview` como valor de target; acepta `production`, `staging` o un identificador de entorno. El intento posterior con `staging` devolvió `deployment.state=BLOCKED`. No se reanudó el proyecto porque eso volvería a habilitar el despliegue clasificado como production. La comprobación del enlace también devolvió 403 en la lectura del bypass de protección. El entorno no tiene CLI Vercel disponible y su proxy de red tampoco permite clonación.

URL generada pero **no entregada como demo operativa**:
`https://sigo-mayorista-demo-20261012-etcn5vw87-telmoaguirre33-byte.vercel.app/`

Despliegue inicial: `dpl_4SbcDJyeY8s88ppw6PqrP2LrFgR1`. La demostración HTTPS queda pendiente de retirar ese despliegue inicial y habilitar exclusivamente una preview con permisos adecuados. Las herramientas conectadas no ofrecen eliminación de despliegues; no se intentó sortear la restricción ni reactivar production.
