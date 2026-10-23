# Protocolo de aceptación en Android

Estado: pendiente de ejecución en dispositivos físicos. No hay una URL HTTPS operativa confirmada. Las pruebas Chromium de CI no equivalen a probar teléfonos, GPS, lectores o impresoras.

## Preparación

1. Usar únicamente Railway MAYORISTA-QA, datos ficticios y un origen HTTPS independiente aprobado. No usar credenciales ni datos de SIGO existente. La activación sigue bloqueada por la verificación del presupuesto; consultar `RAILWAY-QA-OPERACION.md`.
2. El runtime independiente genera `secure-config.mjs` público con el origen exacto. `secure.html` y `secure.webmanifest` arrancan la aplicación cifrada; `portal.html` administra mediante la misma API. La configuración pública no concede acceso: el servidor verifica sesión, empresa habilitada y membresía persistente en cada petición.
3. Instalar el paquete SQL en una base vacía y habilitar explícitamente la empresa QA. El backend admite exclusivamente la instancia privada autorizada con CA y hostname TLS verificados. Los cinco roles, catálogos, clientes, precios y cargas ya disponen de API/PostgreSQL; resta ejecutar esta aceptación en el entorno persistente y teléfonos reales.
4. Preparar dos teléfonos Android con Chrome actualizado, empresas QA A/B, vendedores A1/A2/B1, clientes asignados, precios unidad/pack/caja/bulto y productos con códigos. Registrar modelo, Android, Chrome, fecha, commit y URL.
5. Usar un lector concreto y la impresora de reparto que utilizará la distribuidora. Anotar modelo y conexión Bluetooth/USB/red. Registrar comprobantes anonimizados de cada caso.

## Vendedor y recuperación

- Ingresar online con empresa/email/contraseña. Definir una clave local de al menos doce caracteres, separada de la contraseña online. Descargar el catálogo; registrar empresa y vendedor que muestra la pantalla.
- Instalar desde Chrome «Instalar aplicación». Comprobar que abre `secure.html`, sin abrir la demo, y que no hay aviso de preparación offline fallida.
- Crear un borrador con varios productos y presentaciones. Activar modo avión, cerrar completamente Chrome y la aplicación, reabrirla y desbloquear con empresa, vendedor y clave local. Comprobar cliente, renglones, unidades y precios completos. El inicio offline de la entrada operativa aún requiere este ensayo físico con su HTTPS final.
- Guardar 100 pedidos offline. Anotar sus UUID y exportar un respaldo cifrado. Cerrar y reabrir, comprobar los cien UUID y contenidos. No declarar recuperación por contar solo filas.
- Una clave local errónea debe bloquear sin borrar datos. Después del plazo offline de siete días se requiere validar nuevamente online; el token del servidor nunca se guarda en IndexedDB.
- Recuperar conexión e iniciar sesión online si se cerró o venció. Sincronizar, comparar cada UUID/cliente/renglón con el servidor, volver a sincronizar y comprobar que no aparecen filas nuevas.
- Interrumpir la conexión después de que el servidor reciba el pedido y antes de que llegue su acuse; reintentar con el mismo UUID. Probar dos pestañas y dos dispositivos sincronizando a la vez.
- Descargar el respaldo cifrado, restaurarlo en un segundo dispositivo vacío del mismo vendedor y comprobar UUID y acuses. No reemplazar un almacén que ya contenga pedidos. La recuperación por pérdida de la clave local requiere un procedimiento comercial aún pendiente; no existe recuperación de contraseña por la demo.
- Registrar visitas con ubicación permitida, denegada, señal GPS ausente y modo avión. Confirmar que se conserva el resultado/precisión/error y que la sincronización de visitas no duplica UUID. La UI no presenta posición fallida como ubicación válida.
- Cambiar precios/asignaciones mientras el vendedor está offline. Un pedido no aceptado debe conservarse con conflicto visible. Un pedido ya recibido debe recuperar su acuse original aunque cambie el catálogo.

## Administración, carga y reparto

- Validar por cada rol la matriz aprobada: gerencia total; administración clientes/vendedores/productos/precios/rutas/pedidos/cargas/cobranzas; vendedor asignados/visitas/objetivos; armador preparación/picking/control; chofer rutas/entregas/devoluciones/rendiciones.
- Intentar acceder a empresa B desde A mediante UI y peticiones API; comprobar RLS con identidades reales. Los roles persistentes y RLS pasaron CI contra PostgreSQL; repetir con empresas QA A/B y comprobar también revocación de sesiones, cambio de rol y desactivación de usuarios.
- Aprobar pedidos recibidos, asignar camión/ruta/chofer/armador y preparar por cliente y por carga consolidada. Repetir asignación a dos camiones: debe existir un solo destino.
- Usar lector físico con cada presentación y con un código inválido/ajeno. Registrar sobrantes y autorizar faltantes por pedido. No salir sin verificación completa.
- Con inventario exclusivamente Mayorista habilitado, intentar verificar dos cargas que excedan la disponibilidad conjunta. Confirmar una sola reserva válida y que la operación rechazada no cambió carga, inventario ni cuenta.
- Imprimir hoja de carga, reparto y pedido. Comprobar legibilidad, cliente, cantidades, chofer y firmas en papel. Un PDF generado no acredita funcionamiento de la impresora.
- Registrar entregas parciales, rechazo, devolución posterior al cobro, rendición y revisión. Confirmar que el cobro se conserva y que la cuenta muestra el crédito correspondiente. No se efectúan operaciones en Caja, Stock o Facturación de SIGO.
- Cerrar solo con todas las entregas y rendiciones revisadas. El armador registra la recepción física exacta de las devoluciones antes del cierre. Intentar cerrar sin ese registro: debe rechazarse sin reingresar inventario. Repetir el cierre y comprobar un único movimiento por producto.
- Cancelar una carga publicada que aún no salió, reintentar la cancelación y reasignar su pedido a otro camión. Conservar ambos historiales y un único destino activo.
- Consolidar el mismo producto vendido por unidad y pack promocional: verificar cantidades, total exacto y cuenta de la entrega parcial. El total parcial se prorratea sobre el importe consolidado del pedido, con redondeo a centavos.

## Registro de resultados

Para cada caso: PASS/FAIL/BLOQUEADO, equipo/usuario/empresa, UUID implicados, resultado esperado/observado y evidencia. No marcar «aprobado» un caso no ejecutado. Conservar los errores y no borrar pedidos para obtener una pantalla limpia.

La API ya incluye alta/baja, cambio de rol y restablecimiento de contraseña por gerencia, permisos persistentes y publicación de catálogos/listas/ofertas/objetivos. Antes de comercializar faltan la aceptación física, monitoreo operativo, respaldos persistentes y un ensayo completo de restauración. El historial local del vendedor corresponde a su almacén cifrado: validar la política comercial de consulta entre dispositivos. Este protocolo no certifica tareas no ejecutadas.
