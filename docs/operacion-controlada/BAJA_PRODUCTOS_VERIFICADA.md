# Baja de productos: rechazo visible y confirmación verificada

Base: main bcadd782ca9ceca0b37dfe8bbbc75f236560a068. Alcance: interfaz Productos y readback; sin SQL, cambios de unidades, modificaciones de stock, históricos, Caja, scanner, fiscal o Mayorista.

## Diagnóstico

El contrato vigente en código rechaza la baja con stock distinto de cero (PRODUCT_HAS_STOCK). Los pasos de confirmación previos no prueban una baja: se pedía confirmar antes de mostrar el rechazo en un alert descartable. Una captura con stock 100 es compatible con ese rechazo, pero no prueba el estado de la base. No se consultaron registros comerciales.

El cambio de unidad requiere stock cero y ausencia de historial en los circuitos protegidos. La función de alta disponible inserta stock_actual directamente; no se puede afirmar que toda carga inicial genere un movimiento. Corregir una carga equivocada necesita revisar su significado real y trazabilidad. Este PR NO corrige datos reales ni convierte piezas en kilos, ni propone vaciar stock para ocultarlo.

## Corrección

- Comprueba stock visible antes de abrir confirmación. Stock desconocido o no finito bloquea de forma segura y pide actualizar.
- Rechazo persistente y accesible que explica por qué sigue activo. No se quita ninguna protección servidor.
- Una sola solicitud pendiente, incluso doble clic rápido.
- RPC true requiere lectura acotada id/empresa/activo=false. RPC false, fila ausente, otra empresa, activo=true, error de red/RLS o readback fallido nunca se presentan como éxito. No hay reintento automático.
- Sólo una baja verificada retira la fila y muestra confirmación. El historial se conserva.
- Productos se remonta por empresa para no mostrar resultados tardíos de otra empresa. El parche de compilación de importación de stock preserva esa key.

## Pruebas sintéticas

npm run test:baja-productos: controles de stock, servidor, resultado incierto, readback/RLS sin fila, aislamiento de empresa, doble clic y componente DOM real. Se ejecuta también en CI después de build.

npm run test:manual-medidas: 55 pruebas y circuito sintético de recuperación de cobro aprobados.

npm run build (incluye TypeScript) y npm run verify:critical aprobados localmente. Pruebas de baja también ejecutadas después de los parches de build. No se validó una baja de datos comerciales ni una sesión autenticada productiva.

## Límite separado: otra pestaña con Caja abierta

Los RPC de catálogo/códigos del repositorio ya filtran empresa y productos activos. Volver de Productos a Caja remonta el catálogo. Una pestaña de Caja que permanezca abierta puede conservar sugerencias viejas hasta actualizarse; las guardas servidor disponibles rechazan mover productos inactivos. Esto es un hallazgo distinto y no prueba la causa de la captura. No se modifica scanner ni caché en este PR.

## Publicación y reversión

Requiere revisión y autorización separada para integrar/publicar. No aplicar migraciones. Reversión: revertir este commit web; no hay datos ni esquema que restaurar. Una eventual corrección del alta errónea del usuario requiere confirmar si las existencias son reales y revisar historial antes de definir una operación específica.
