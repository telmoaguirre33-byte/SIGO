# Prueba final P0: PC y Android

Estado: cambios preparados en PR #72. Requieren aprobación y despliegue QA antes de usar los controles nuevos. P0 no está cerrado. No repetir el sembrado ni el ensayo de API ya aprobado.

## Enlaces

- SIGO Preview (SSO): https://comercial-git-feat-mayorista-distrib-f5e6ed-telmoaguirre33-byte.vercel.app
- App Vendedor QA: https://mayorista-api-qa-qa.up.railway.app/secure.html
- Portal Mayorista QA: https://mayorista-api-qa-qa.up.railway.app/portal.html

## Preparación privada, una sola vez

El responsable QA entrega a cada participante su acceso existente por un gestor de contraseñas que ya utilice la organización, con compartición restringida al destinatario. Si no existe, realiza el ingreso presencialmente en el dispositivo del participante. No contratar un servicio ni publicar enlaces con credenciales. Nunca enviar contraseñas o tokens por este chat. No copiar valores secretos en capturas o evidencia.

Las cuentas siguen siendo las ya sembradas: gerencia, administracion, armador, chofer1/2/3 y vendedor1..8, todas bajo @distribuidora.qa.invalid. La interfaz permite elegirlas por nombre del rol y fija la empresa sintética QA. El selector no autentica ni cambia permisos. No hay contraseña nueva, pública o incluida en la aplicación. El responsable necesita acceso autorizado a la configuración privada QA existente; esta gestión no ha entregado secretos.

Usar un perfil de navegador distinto por rol. En Android usar Chrome normal, nunca incógnito, con bloqueo seguro del teléfono. Un teléfono nuevo se prepara con la contraseña de acceso, sin segunda clave cotidiana. El teléfono que contiene los dos pedidos anteriores necesita su clave local anterior una sola vez para habilitar la reapertura rápida sin reemplazar datos. Ver política y limitaciones en [UX Vendedor](UX-VENDEDOR-P0.md).

## PC: ingresar desde SIGO

1. Abrir SIGO Preview. Completar el acceso Vercel si aparece y luego el ingreso SIGO habitual.
2. Abrir Menú → MAYORISTA / DISTRIBUIDORA → Panel. Debe mostrar QA AISLADO sin otra contraseña de Mayorista.
3. Volver a SIGO y reabrir el módulo. Confirmar misma empresa QA y mismo rol.

SSO actual: usuario SIGO owner/admin. Las cuentas sintéticas de vendedor, armador y chofer ingresan en sus propias interfaces; no son cuentas SIGO ni acreditan SSO de esos roles. No operar en las pantallas comerciales reales de lapizcito5.

## Android: conservar los DOS pedidos actuales

No crear otro pedido PRUEBA P0 ni enviar todavía. Los dos pedidos manuales son intencionales.

1. Después de autorizar y confirmar el nuevo despliegue, cerrar la app anterior antes de recuperar conexión. No limpiar datos ni desinstalar. Abrir la misma instalación y completar una vez la preparación del almacén anterior con su clave local previa si se solicita.
2. Inicio → Mis pedidos → Pendientes: abrir los dos pedidos existentes. Verificar cliente, productos, cantidades, condición y total. En Detalles técnicos, el responsable puede registrar sus UUID sin modificarlos.
3. Cerrar y reabrir. Repetir en modo avión. Deben seguir ambos pedidos y catálogo sin pedir contraseña cotidiana.
4. Recuperar conexión: NO debe enviarse nada. Solamente después de revisar y autorizar ambos pedidos, pulsar Sincronizar. Repetir la acción no debe duplicar pedidos.
5. Para un pedido NUEVO posterior: Nuevo pedido → buscar cliente → agregar productos → Revisar → Contado o Cuenta corriente expresa → Guardar. Guardar no envía. Mis pedidos permite editar pendientes sin intentos; desde el primer intento el pedido queda de solo lectura.

No usar respaldos para reemplazar este almacén. No borrar IndexedDB. La aceptación persistente anterior no se repite.

## PC: continuar con las referencias de los pedidos revisados

1. Administración → Pedidos: identificar los pedidos revisados por cliente y referencia, y aprobar. En Cargas crear una carga con vehículo/ruta existentes; agregar ese pedido y asignar Depósito y Chofer 1. No crear clientes, productos ni vehículos nuevos.
2. Depósito → Iniciar picking → Conteo de una unidad → Verificar carga → Confirmar mercadería en carga.
3. Administración → Salida a reparto.
4. Chofer 1 → Entrega: una unidad entregada, cero devuelta, comprobante de prueba.
5. Administración → confirmar Entrega → venta / stock SIGO si sigue pendiente. Cuenta corriente: registrar una sola cobranza por el importe de esa venta, con referencia del pedido revisado.
6. Chofer 1 → Rendición por ese importe. Gerencia → Revisar rendición y cerrar carga.

La referencia del pedido aparece en el historial del vendedor, los pedidos administrativos, el selector de pedidos aprobados y el detalle de pedidos de la carga. Las acciones comerciales siguen siendo las existentes y exigen sus roles. No registrar el mismo cobro en administración y chofer. Ante una confirmación ambigua, conservar la pantalla y pedir conciliación antes de repetir un cobro.

## Cierre y evidencia

El usuario registra referencia visible, fecha y capturas de: pendiente offline tras reabrir, confirmación de sincronización, recepción administrativa, entrega y rendición final. Sin claves ni tokens.

El responsable técnico vincula esa referencia a los UUID internos y concilia exclusivamente los dos pedidos revisados, cada uno por separado: una entrega/venta/cobro, stock descontado según cantidades efectivamente entregadas, saldo restaurado y una rendición revisada, sin duplicados. No volver a ejecutar la aceptación anterior de 16 pedidos. No declarar P0 cerrado hasta completar ambas verificaciones: circuito publicado y Android físico.
