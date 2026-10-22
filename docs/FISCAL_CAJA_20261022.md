# Caja fiscal F11/F12: entrega y activación controlada

Estado: código preparado y probado con fixtures sintéticos. No activado en producción. No se hicieron emisiones reales, consultas a ARCA real, cambios de Windows/controlador ni pruebas físicas. La revisión local no certifica conformidad normativa integral ni velocidad del servicio ARCA o de la impresora.

## Fallas y correcciones

- F11 confirmaba la venta y abría un módulo de administración, con selección potencialmente distinta y confirmación repetida. Ahora identifica empresa + venta, confirma una sola vez, abre un flujo compacto y solicita una única emisión cuando pasan los controles fiscales y de activación. Bloquea repetición de teclado y doble acción; no modifica las funciones de F9/F10.
- F12 podía usar el ticket común aunque existiera factura fiscal. Ahora recupera por empresa + venta; el historial no emite ni imprime al abrirse. Si hay un intento fiscal pendiente, no lo sustituye silenciosamente por un ticket común.
- Un timeout o una recarga podía llevar a repetir FECAESolicitar. La reserva y el snapshot se guardan antes del llamado; la recuperación consulta el comprobante original sin generar CAE. Se compara fecha, identidad, receptor, moneda, cotización e importes antes de conciliar. El endpoint antiguo delega al nuevo cuando el modo seguro está activo.
- Una autorización de ARCA seguida de fallo de persistencia conserva la reserva y el detalle original. La siguiente consulta recupera el CAE y no crea otra venta ni autorización.
- Los snapshots y las reservas eran modificables por clientes autorizados mediante REST. Se prepara una fase manual separada que revoca todas sus mutaciones, incluso TRUNCATE y permisos de columna. El writer del servidor está limitado a esta tabla, empresa, venta e ID. La activación comprueba privilegios efectivos, no solo una marca de migración. Snapshots preexistentes provocan aborto de la fase manual y requieren revisión, nunca se convierten silenciosamente en confiables.
- Una respuesta R definitiva puede bloquear el siguiente número. Solo se libera la posición si la respuesta original R coincide con todo el pedido, no contiene CAE, FECompConsultar devuelve específicamente 602 y el último autorizado sigue siendo N−1. Se conserva la auditoría y no se reintenta esa venta automáticamente. Timeout, 601, HTML, respuestas incompletas y conflictos conservan el bloqueo seguro.
- La impresión anterior dependía de tamaño de página inadecuado y un QR remoto/denso. El ticket nuevo usa QR SVG local, columna útil de 48 mm para papel de 58 mm, zona blanca y módulos enteros a 203 dpi. Mide la altura tras cargar fuentes y QR; rechaza más de 500 mm sin cortar artículos y ofrece A4. No usa window.open ni depende de un popup tras la espera de ARCA. Solo llama a print explícitamente, una vez.
- afterprint también ocurre al cancelar. El mensaje es “Factura autorizada; F12 para reimprimir”, nunca una afirmación de impresión física completada.

## Datos originales y límites

El snapshot fiscal congela el texto disponible al emitir el primer comprobante, además de los importes y cantidades persistidos de la venta. La unidad proviene exclusivamente de venta_items_sigo.unidad_medida; NULL histórico queda sin unidad inferida. Se muestra, por ejemplo, 0,750 kg. No se recalculan subtotales ni totales multiplicando valores redondeados.

La migración de medidas V4 no conserva el nombre del producto al momento del cobro. Un renombre previo a la primera emisión no se puede reconstruir. Una vez creado el snapshot, F12 no consulta el catálogo para reemplazar sus textos. Los comprobantes históricos sin snapshot recuperan datos verificables mediante FECompConsultar; los textos no conservados se advierten explícitamente y no se imprime automáticamente una reconstrucción como si fuera el original completo.

El encabezado requiere domicilio comercial, condición IVA real, número IIBB o condición verificada de no contribuyente, y fecha de inicio del establecimiento o una excepción legal explícita. Un panel inicial, dentro de Caja, permite a un administrador completar únicamente los datos de impresión. CUIT, razón social, ambiente y punto de venta provienen del servidor y no son reemplazables por el pedido. No se modifican credenciales ni configuración ARCA autorizada. No se inventaron datos de la empresa.

## Pruebas ejecutadas

- npm run test:fiscal-caja: PASS. Backend totalmente simulado, React DOM con StrictMode, doble F11, event.repeat, confirmación única de F9/F10/F11, timeout/recarga, F12 fiscal/común/historial, fallo de impresión y recuperación sin emisión nueva.
- Dos pedidos backend simultáneos compiten por la reserva: el fixture permite una sola FECAESolicitar. Esto no equivale a una prueba de estrés contra ARCA real.
- node scripts/test-arca-cae-protocol.mjs: PASS.
- npx tsc --noEmit y npm run build: PASS. Advertencia preexistente de tamaño de bundle; no se afirma una mejora medida de ARCA/hardware.
- QR: 26 entradas inválidas rechazadas; cinco SVG reales decodificados después de rasterizar a 203 dpi, también en blanco y negro. Incluye moneda extranjera, documento identificado, consumidor final y límites de número/importe.
- Fixture SQL de las dos migraciones aditivas: 36 pasos, 66 aserciones, cero fallos.
- Fixture SQL del hardening manual: 46 pasos, 90 aserciones, cero fallos. Incluye RLS por empresa, roles, denegación de mutaciones, TRUNCATE, permisos heredados/columna, writer servidor, NULL de rechazo y rollback ante snapshot preexistente.
- Revisión independiente de seguridad: PASS dentro del alcance local revisado, sin habilitación productiva.

Pendiente de la rama consolidada: CI con Chromium/PDF, pruebas combinadas de Caja y medidas, Vercel Preview READY y verificación posterior al despliegue. El script de navegador aborta toda red externa y sustituye print; no imprime físicamente. La ejecución local de Chromium fue bloqueada por el sandbox, no se eludió esa restricción. La validación física de GADNIC/POS-58 (copy 1) queda pendiente.

## Orden de despliegue, no ejecutado

1. Revisar la rama consolidada y superar CI/Preview. Obtener autorización explícita antes de cualquier despliegue productivo o cambio de permisos/acceso servidor.
2. Aplicar la migración manual de medidas V4 y las dos migraciones fiscales aditivas revisadas. No hacer backfill ni reconstruir históricos.
3. Desplegar el backend nuevo y comprobar READY con ARCA_FISCAL_SERVER_WRITE_ENABLED ausente/apagado. Esta fase preserva compatibilidad manual, pero NO es el estado final protegido ni habilita el F11 automático nuevo.
4. Con autorización específica para el uso acotado de la credencial servidor existente y los permisos: activar ARCA_FISCAL_SERVER_WRITE_ENABLED=true. Toda nueva emisión, incluso por /api/arca/cae y sin flujoCaja, queda bloqueada hasta completar el hardening. No copiar claves al frontend, logs o archivos.
5. Ejecutar expresamente supabase/manual/20261022_arca_server_write_hardening.sql. Está fuera de supabase/migrations y no debe ser incluido en db push automático. Si encuentra snapshots preexistentes o privilegios heredados inseguros, aborta sin borrar datos y requiere revisión.
6. Verificar readiness, permisos y encabezado con el administrador; comprobar homologación y funcionamiento físico con autorización y entorno apropiados antes de dar por validada la operación.

Si falta clave servidor, esquema, hardening o datos obligatorios, no se llama a FECAESolicitar. La venta ya confirmada se conserva y el mensaje pide no volver a cobrarla.

Rollback: no restaurar escrituras del cliente mientras los snapshots se consideran confiables. La desactivación y la vuelta de backend/permisos requieren un plan coordinado; no ejecutar un rollback parcial que reactive rutas antiguas contra reservas pendientes. Los rechazos definitivos quedan auditados; la corrección administrativa de esa misma venta no se implementa como reintento automático.

## Fuentes oficiales revisadas

- QR ARCA: https://arca.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
- RG 1415, anexo II, datos del comprobante: https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-1415-2003-81316/actualizacion
- Excepciones de fecha de inicio: https://www.afip.gob.ar/genericos/guiavirtual/consultas_detalle.aspx?id=132712
- Datos e identificación del receptor: https://www.afip.gob.ar/fe/emision-autorizacion/datos-comprobantes.asp
- WSFEv1, códigos y consulta: https://arca.gob.ar/ws/WSFEV1/documentos/manual-desarrollador-COMPG-v3-4-2.pdf

PR, commit, CI y Preview: se completan tras la publicación coordinada de la rama independiente. Esta entrega no modificó módulos mayoristas ni otros proyectos, ni ejecutó cambios de stock/compras/productos/informes o configuración fiscal real.
