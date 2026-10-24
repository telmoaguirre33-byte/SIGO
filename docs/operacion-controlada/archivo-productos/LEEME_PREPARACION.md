# Baja comercial con existencias, reversible y sin borrar

Estado: preparación, NO autoriza SQL productivo ni publicación. Sustituye el objetivo incompleto del PR102: no es solamente un mensaje de bloqueo por stock.

## Contrato

Dar de baja comercial cambia exclusivamente archivado_comercial y registra actor, fecha, stock y unidad preservados en auditoría. Conserva activo legacy, ID, stock, códigos, costos, precio y toda referencia histórica. Puede archivarse con stock cero, positivo o negativo; no inventa ajustes para permitir la baja. Reactivar revierte exclusivamente el estado comercial, también con auditoría.

Nuevas ventas, compras, catálogo operativo, códigos y portal excluyen archivados. Guardas de detalle impiden forzar un ID viejo por carrito o escáner. Estas guardas comparten lock de producto con archivo, y fallan dentro de la transacción. La interfaz no vacía automáticamente un carrito ni genera reintentos: informa que el producto fue archivado.

Devoluciones y anulaciones históricas conservan sus controles existentes y pueden restituir stock/costo sin reactivar comercialmente el producto. Editar una compra reinserta detalles, por lo que una edición que vuelve a incluir un archivado queda bloqueada. No se modifica la semántica de las operaciones históricas.

## Inventario y lectores

- Stock y valorización incluyen stock físico archivado y legacy inactivo; no desaparece del total a costo.
- Productos archivados tienen vista propia y reactivación verificada. Su precio de venta es referencia, no margen potencial vendible.
- Stock tiene lookup separado, incluyendo alias. Venta/Compra conservan lookup operativo.
- Reposición/riesgo de quiebre y compras sugeridas siguen sólo catálogo operativo.
- La conciliación posterior de venta lee inventario: un archivo concurrente no hace desaparecer el producto del readback.
- Otras pestañas del mismo navegador reciben invalidación de catálogo; volver a enfocar Caja también refresca. Otra caja sin notificación puede mostrar una sugerencia vieja hasta refrescar, pero el servidor rechaza su cobro y no permite venta nueva.
- No se modifica la API de conteo físico por imagen: ya consulta inventario completo, no catálogo vendible; por ello conserva los archivados.

## Seguridad

RPC con auth.uid, permiso products.write, filtro empresa+ID, lock y readback exacto. El trigger de estado valida y audita también UPDATE directo: no puede cambiar archivo junto con unidad/stock/precio ni sustituir identidad/empresa. Auditoría sin permisos DML/SELECT para anon/authenticated; RLS habilitada; FK impide purga de producto auditado.

No se reactivan automáticamente productos con activo=false previo. Las nuevas RPC no reparan políticas RLS generales anteriores. Es indispensable verificar las políticas y triggers reales mediante el preflight de metadatos y ensayar con roles reales antes de autorizar producción. No se consultaron registros comerciales durante la preparación.

## Pruebas

- npm run test:archivo-productos: contrato frontend, DOM real y PostgreSQL PGlite con datos sintéticos.
- PostgreSQL17 multisesión: tests/archivoProductos.concurrent.test.mjs, servicio efímero local de CI, base exclusiva sigo_archivo_test. Sin esa variable queda omitida explícitamente, no aprobada.
- npm run test:manual-medidas, npm run build, npm run verify:critical y Chromium sintético.
- No se ejecutan emisiones, impresiones físicas, venta/baja real ni migraciones productivas.

## Integración con corrección de unidad

unidad_revision de inventario es texto decimal para evitar pérdida de precisión bigint en JavaScript. El archivo y la corrección se aplican en operaciones separadas; una corrección de unidad debe rechazar archivados hasta reactivar. El candidato conjunto necesita pruebas que combinen los dos SQL y las guardas antes de publicar.

## Habilitación y reversión

1. Revisar metadatos y resolver incompatibilidades; asegurar respaldo recuperable autorizado aparte.
2. Ensayar candidato combinado en base aislada y comprobar roles, devoluciones/anulaciones y concurrencia.
3. Solicitar autorización específica para SQL y publicación. El SQL está en docs, fuera de migraciones automáticas.
4. Aplicar SQL controlado antes del cliente nuevo. Mientras falten RPC/columnas, este cliente no se presenta como habilitado.
5. Validación de una operación real sólo con autorización concreta del usuario.

No hacer rollback que vuelva a ofrecer productos archivados ni ocultar existencias. Si hay archivos reales, conservar columna, auditoría, filtros y guardas; deshabilitar nuevas transiciones y corregir hacia adelante. Desarchivar requiere decisión explícita por producto. No incluir DROP COLUMN/TABLE ni borrar auditoría. Revertir solamente la web vieja puede ocultar residuales en su listado antiguo: no es una reversión completa segura. Sin archivos realizados puede retirarse la UI nueva, conservando el esquema aditivo sin pérdida.
