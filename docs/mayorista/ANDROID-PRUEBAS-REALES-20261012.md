# Protocolo de aceptación en Android

Estado: pendiente de ejecución en dispositivos físicos. No hay una URL HTTPS operativa confirmada. Las pruebas Chromium de CI no equivalen a probar teléfonos, GPS, lectores o impresoras.

## Preparación

1. Usar únicamente un Supabase QA independiente autorizado, datos ficticios y el origen HTTPS independiente aprobado. No usar credenciales ni datos de SIGO existente.
2. Habilitar `secure-config.mjs` con `enabled: true` y el origen exacto aprobado, sin claves. La entrada `secure.html` y `secure.webmanifest` arrancan la aplicación cifrada, distinta de la demo. El servidor debe autenticar, comprobar empresa y permisos; esta configuración pública no concede acceso.
3. Antes de activar, resolver la persistencia QA, el adaptador Supabase, las membresías de los cinco roles, activación por empresa y el mantenimiento del catálogo real. El backend actual de pruebas solo admite PostgreSQL localhost; no está configurado como servidor comercial.
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
- Intentar acceder a empresa B desde A mediante UI y peticiones API; comprobar RLS con identidades reales. Estos cinco roles todavía requieren vinculación persistente en servidor; los controles unitarios no sustituyen esta aceptación.
- Aprobar pedidos recibidos, asignar camión/ruta/chofer/armador y preparar por cliente y por carga consolidada. Repetir asignación a dos camiones: debe existir un solo destino.
- Usar lector físico con cada presentación y con un código inválido/ajeno. Registrar sobrantes y autorizar faltantes por pedido. No salir sin verificación completa.
- Con inventario exclusivamente Mayorista habilitado, intentar verificar dos cargas que excedan la disponibilidad conjunta. Confirmar una sola reserva válida y que la operación rechazada no cambió carga, inventario ni cuenta.
- Imprimir hoja de carga, reparto y pedido. Comprobar legibilidad, cliente, cantidades, chofer y firmas en papel. Un PDF generado no acredita funcionamiento de la impresora.
- Registrar entregas parciales, rechazo, devolución posterior al cobro, rendición y revisión. Confirmar que el cobro se conserva y que la cuenta muestra el crédito correspondiente. No se efectúan operaciones en Caja, Stock o Facturación de SIGO.
- Cerrar solo con todas las entregas y rendiciones revisadas. Verificar devolución física recibida en depósito antes de aceptar el reingreso: el control comercial de recepción física sigue pendiente.

## Registro de resultados

Para cada caso: PASS/FAIL/BLOQUEADO, equipo/usuario/empresa, UUID implicados, resultado esperado/observado y evidencia. No marcar «aprobado» un caso no ejecutado. Conservar los errores y no borrar pedidos para obtener una pantalla limpia.

La comercialización exige además alta/baja y recuperación de usuarios, monitoreo, respaldos persistentes/restauración completa, carga de datos reales, permisos persistentes, publicación de catálogos/listas/ofertas/objetivos y administración operativa completa. Este protocolo no certifica que esas tareas estén terminadas.
