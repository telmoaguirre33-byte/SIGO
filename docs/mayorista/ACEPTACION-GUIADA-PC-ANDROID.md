# Prueba final P0: PC y Android

Estado: cambios preparados en PR #72. Requieren aprobación y despliegue QA antes de usar los controles nuevos. P0 no está cerrado. No repetir el sembrado ni el ensayo de API ya aprobado.

## Enlaces

- SIGO Preview (SSO): https://comercial-git-feat-mayorista-distrib-f5e6ed-telmoaguirre33-byte.vercel.app
- App Vendedor QA: https://mayorista-api-qa-qa.up.railway.app/secure.html
- Portal Mayorista QA: https://mayorista-api-qa-qa.up.railway.app/portal.html

## Preparación privada, una sola vez

El responsable QA entrega a cada participante su acceso existente por un gestor de contraseñas que ya utilice la organización, con compartición restringida al destinatario. Si no existe, realiza el ingreso presencialmente en el dispositivo del participante. No contratar un servicio ni publicar enlaces con credenciales. Nunca enviar contraseñas o tokens por este chat. No copiar valores secretos en capturas o evidencia.

Las cuentas siguen siendo las ya sembradas: gerencia, administracion, armador, chofer1/2/3 y vendedor1..8, todas bajo @distribuidora.qa.invalid. La interfaz permite elegirlas por nombre del rol y fija la empresa sintética QA. El selector no autentica ni cambia permisos. No hay contraseña nueva, pública o incluida en la aplicación. El responsable necesita acceso autorizado a la configuración privada QA existente; esta gestión no ha entregado secretos.

Usar un perfil de navegador distinto por rol. En Android usar Chrome normal, nunca incógnito. El vendedor elige una clave local de al menos 12 caracteres; no se guarda ni se comparte. Mantiene el cifrado y la caducidad offline de siete días, bloqueo por inactividad y renovación online. La identidad empresarial cifrada se recupera después de validar esa clave. Los metadatos del dispositivo no autorizan solicitudes al servidor.

## PC: ingresar desde SIGO

1. Abrir SIGO Preview. Completar el acceso Vercel si aparece y luego el ingreso SIGO habitual.
2. Abrir Menú → MAYORISTA / DISTRIBUIDORA → Panel. Debe mostrar QA AISLADO sin otra contraseña de Mayorista.
3. Volver a SIGO y reabrir el módulo. Confirmar misma empresa QA y mismo rol.

SSO actual: usuario SIGO owner/admin. Las cuentas sintéticas de vendedor, armador y chofer ingresan en sus propias interfaces; no son cuentas SIGO ni acreditan SSO de esos roles. No operar en las pantallas comerciales reales de lapizcito5.

## Android: un pedido, sin escribir identificadores

1. Abrir App Vendedor QA. Elegir Vendedor 1, usar su contraseña privada y elegir la clave local del dispositivo. Ingresar online y esperar el catálogo actualizado.
2. Probar Buscar cliente y el buscador de productos por nombre/código. No agregar productos todavía.
3. Activar modo avión y apagar Wi-Fi. Pulsar Preparar / ver mi pedido de prueba. Prepara una unidad de un producto QA para un cliente asignado, con la referencia visible PRUEBA P0. Revisar y pulsar Guardar pedido una sola vez.
4. Cerrar completamente la app y reabrirla sin conexión. Elegir el acceso guardado e ingresar solo la clave local. Debe conservar catálogo y el pedido pendiente con la misma referencia. No se pide empresa ni UUID del vendedor.
5. Recuperar conexión. Si hace falta renovar sesión, usar la misma cuenta y clave local. Pulsar Sincronizar pedidos; esperar Confirmado por el servidor. Repetir Sincronizar no debe crear otro pedido.

El botón de prueba reutiliza un único marcador cifrado por almacén/dispositivo. No garantiza exclusividad entre dispositivos distintos: realizar esta aceptación desde un solo Android y Vendedor 1. Si hay otro borrador, conservarlo antes de preparar la prueba. No borrar el almacenamiento del navegador.

## PC: seguir PRUEBA P0

1. Administración → Pedidos: identificar PRUEBA P0 y aprobar. En Cargas crear una carga con vehículo/ruta existentes; agregar ese pedido y asignar Depósito y Chofer 1. No crear clientes, productos ni vehículos nuevos.
2. Depósito → Iniciar picking → Conteo de una unidad → Verificar carga → Confirmar mercadería en carga.
3. Administración → Salida a reparto.
4. Chofer 1 → Entrega: una unidad entregada, cero devuelta, comprobante de prueba.
5. Administración → confirmar Entrega → venta / stock SIGO si sigue pendiente. Cuenta corriente: registrar una sola cobranza por el importe de esa venta, con referencia PRUEBA P0.
6. Chofer 1 → Rendición por ese importe. Gerencia → Revisar rendición y cerrar carga.

La referencia PRUEBA P0 aparece en el historial del vendedor, los pedidos administrativos, el selector de pedidos aprobados y el detalle de pedidos de la carga. Las acciones comerciales siguen siendo las existentes y exigen sus roles. No registrar el mismo cobro en administración y chofer. Ante una confirmación ambigua, conservar la pantalla y pedir conciliación antes de repetir un cobro.

## Cierre y evidencia

El usuario registra referencia visible, fecha y capturas de: pendiente offline tras reabrir, confirmación de sincronización, recepción administrativa, entrega y rendición final. Sin claves ni tokens.

El responsable técnico vincula esa referencia a los UUID internos y concilia solo este pedido adicional: una entrega/venta/cobro, stock menos una unidad, saldo restaurado y una rendición revisada, sin duplicados. No volver a ejecutar la aceptación anterior de 16 pedidos. No declarar P0 cerrado hasta completar ambas verificaciones: circuito publicado y Android físico.
