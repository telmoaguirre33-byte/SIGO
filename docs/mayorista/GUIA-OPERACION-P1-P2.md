# SIGO Mayorista: puesta en marcha y operación

Estas funciones se desarrollan en PR #72 y requieren el despliegue QA autorizado. No habilitan producción ni ARCA productiva. La aceptación física queda para el final.

## Accesos QA

- SIGO Preview: https://comercial-git-feat-mayorista-distrib-f5e6ed-telmoaguirre33-byte.vercel.app
- Portal: https://mayorista-api-qa-qa.up.railway.app/portal.html
- Vendedor: https://mayorista-api-qa-qa.up.railway.app/secure.html

Elegí la cuenta QA correspondiente al rol. Las credenciales se administran mediante el canal privado existente. No se incluyen en esta guía ni en enlaces. La empresa sintética se selecciona en el servidor; cambiar de navegador/origen no cambia de empresa.

## Gerencia: preparar una empresa

1. Crear o seleccionar la empresa desde el alta habitual de SIGO y habilitar Mayorista con los permisos correspondientes. El asistente configura una empresa autenticada; no crea otra identidad ni otro sistema de usuarios.
2. Abrir **Puesta en marcha**. Guardar tipo de negocio, empresa y depósito. Cada guardado persiste y se puede retomar.
3. Usar los pasos para productos, stock, clientes, vendedores, zonas/rutas, vehículos, listas, condiciones, objetivos y usuarios. Los pasos enlazan las funciones existentes.
4. Para planillas, abrir **Importar Excel / CSV**. Descargar la plantilla, completar códigos y datos, ver la vista previa y preparar la importación.
5. Confirmar la importación. Se aplican lotes de 25 filas, con progreso y opción de pausa. Si se corta la conexión, reanudar la misma importación. No volver a dar altas a mano para resolver un corte.
6. Usar **Errores anteriores / Más errores** para corregir cualquier fila, incluso en archivos grandes, y luego confirmar para continuar. Corregir por sí solo no aplica la fila. Las filas aplicadas permanecen intactas. Volver a subir el mismo archivo recupera su importación; los códigos identifican registros existentes.
7. En **Clientes**, buscar y filtrar. Seleccionar una página o clientes concretos; elegir vendedor, ruta/zona y lista. Confirmar hasta 100 asignaciones por operación. Una edición concurrente exige actualizar. Al cambiar búsqueda o filtros se descarta la selección anterior; revisar siempre la cantidad antes de confirmar.
8. En **Objetivos**, elegir vendedor/empresa, métrica y período diario, semanal, mensual o personalizado. Guardar y editar desde la tabla objetivo/real/%/falta. Los importes se ingresan en pesos; internamente se conservan centavos.
9. Revisar el paso final. El asistente verifica conteos reales, no considera una casilla como prueba de existencia de productos/clientes/roles. La dirección del depósito es configuración del módulo, sin habilitar depósitos adicionales de SIGO.

Los importadores conservan las fichas existentes: no sobrescriben nombres, precios base, saldo ni límites de crédito. Productos requieren código/EAN y precio positivo. Clientes requieren documento o código. El stock es exclusivamente de apertura: productos con stock o pedidos/ventas se rechazan y deben utilizar un ajuste operativo revisado. Precios importa presentaciones sobre listas activas y conserva el precio base SIGO; no crea automáticamente listas faltantes. Los números no llevan separadores de miles. La importación de saldos iniciales no está habilitada.

**Suscripción** permite preparar prueba, activo, vencido, pago pendiente, suspendido y reactivado. Es independiente del tipo de negocio y del módulo habilitado. Este desarrollo conserva el modo de preparación: no cobra ni suspende operaciones automáticamente. La suspensión nunca borra datos. La activación de políticas comerciales y pagos requiere una etapa posterior autorizada.

## Administración: jornada diaria

1. Revisar pedidos recibidos y sus condiciones. Aprobar por el circuito existente.
2. Crear la carga y asignar armador y chofer. Consolidar pedidos de la misma operación.
3. Autorizar faltantes/sustituciones con motivo. No alterar silenciosamente el pedido recibido.
4. Revisar entregas y rendiciones. Una rendición presentada todavía no equivale a cobranza confirmada.
5. Consultar cuenta corriente, stock y ventas desde la fuente compartida.
6. En **Informes**, elegir ventas, facturación, cobranzas, deuda, vendedores, objetivos, clientes, rutas, productos entregados, entregas o devoluciones. Aplicar los mismos filtros del panel y exportar **Excel (.xlsx)**. Hasta 10.000 registros por archivo; si el informe cambia entre páginas, se cancela la exportación para evitar un archivo inconsistente. Fechas en UTC; la deuda es al cierre del período.

## Vendedor: vender sin pasos técnicos

1. Primera vez: seleccionar vendedor QA e ingresar una contraseña de acceso. Preparar el teléfono personal con bloqueo de pantalla.
2. Descargar catálogo/clientes con conexión. Las siguientes aperturas usan almacenamiento cifrado y el acceso del dispositivo. No hay una segunda contraseña cotidiana. Un perfil antiguo puede requerir su clave local anterior una sola vez para conservar sus datos.
3. **Nuevo pedido** → buscar cliente → agregar productos/presentaciones/cantidades → revisar → condición de pago → guardar. **Contado** es el valor inicial; Cuenta corriente se elige expresamente y el servidor mantiene sus controles.
4. **Mis pedidos** permite revisar borradores, pendientes, enviados, confirmados y cancelados. Editar un borrador o pendiente que nunca se intentó enviar conserva su UUID y trazabilidad. Tras un intento o recepción, queda de sólo lectura, incluyendo confirmaciones perdidas. No se permiten cambios silenciosos a pedidos consolidados.
5. Usar **Consultar pedidos anteriores** para descargar otro lote de historial; no envía pedidos. Los datos descargados quedan cifrados para su consulta offline.
6. Sin señal, continuar con clientes/productos descargados. Guardar pedidos conserva los pendientes; **Sincronizar** es una acción manual. Recuperar conexión no los envía automáticamente.
7. Ruta, cobranzas autorizadas y objetivos tienen accesos propios. Si falla un envío, conservar el pedido y reintentar la misma operación.

**Los dos pedidos físicos actuales están reservados como evidencia:** no sincronizar, editar, cancelar, borrar, restaurar encima ni limpiar almacenamiento durante el desarrollo. Se revisarán juntos al final.

## Depósito

Abrir las cargas asignadas, iniciar picking, contar/escanear, informar faltantes y pedir autorización para sustituciones. Verificar, confirmar carga y registrar devoluciones recibidas con su clasificación. El acceso permanece limitado a las cargas y operaciones del rol.

## Chofer

Abrir el reparto asignado, registrar entrega completa/parcial y devolución con comprobante. Registrar cobranza sólo si está autorizada; presentar rendición y esperar revisión administrativa. Un reintento conserva el identificador de la operación.

## Problemas y recuperación

- **Sin señal:** conservar la aplicación y sus datos. No desinstalar ni limpiar el navegador. Reintentar al recuperar conexión.
- **Sesión vencida/revocada:** ingresar nuevamente con acceso autorizado. Los pedidos cifrados se conservan. Un dispositivo totalmente offline no puede recibir una revocación inmediatamente: se bloquea al reconectar o al vencer la ventana offline, como máximo siete días.
- **Conflicto de edición:** actualizar y revisar la versión actual. No crear otro pedido para ocultar el conflicto.
- **Importación interrumpida:** abrir Importaciones guardadas → Reanudar. Confirmar el progreso del servidor antes de repetir.
- **Archivo grande/incorrecto:** usar plantilla CSV/XLSX y dividirlo si supera límites. XLS antiguo debe guardarse como XLSX. Excel comprimido requiere soporte de descompresión del navegador; CSV es alternativa.
- **Dispositivo perdido:** Gerencia → Usuarios y roles → Teléfonos y sesiones → Revocar. No elimina los pedidos del teléfono ni afecta otras sesiones.

## Respaldo y restauración

El respaldo local cifrado existente exige una contraseña de recuperación para exportar y restaurar en otro dispositivo. Nunca contiene la clave de dispositivo ni tokens de sesión. No sobrescribir un almacén existente para probar una restauración; usar un perfil de prueba separado.

La persistencia PostgreSQL no equivale a un backup. Backups, retención, recuperación puntual y restauración de volumen dependen del plan y configuración actuales de Railway. No se ha creado ningún servicio ni backup pago. Antes de producción debe verificarse disponibilidad, descargar/verificar una copia autorizada y ensayar su restauración en un destino autorizado; no restaurar sobre QA con evidencia ni sobre producción. No hay autorización para contratar un destino nuevo.

ARCA permanece en simulación/homologación segura. Credenciales y autorización de homologación real son una dependencia externa; no bloquean las demás pruebas del módulo.
