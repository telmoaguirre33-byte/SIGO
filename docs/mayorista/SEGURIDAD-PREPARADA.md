# Seguridad Mayorista: componentes preparados, integración desactivada

`security/session.mjs`: ciclo de sesión con proveedor inyectado, vencimiento, rechazo de anónimos/revocados, permisos por empresa, cierre local aunque falle el remoto y protección contra login que termine después del logout. No hay un proveedor real configurado ni se usa la identidad seleccionable de la demo como login.

El proveedor futuro debe verificar firma JWT, emisor, audiencia y sesión en servidor, consultar pertenencia activa a la empresa y devolver permisos vigentes. Nunca autorizar usando `user_metadata`, datos del formulario, localStorage o un JWT solamente decodificado. El API requiere validar revocación en cada recepción. Mantener tokens en memoria o usar cookies HttpOnly/Secure/SameSite con defensa CSRF en un adaptador HTTP; nunca incluir service_role en la aplicación.

`security/vault.mjs`: cifrado local AES-256-GCM con IV aleatorio y PBKDF2-SHA256 (310000 iteraciones). Empresa y vendedor se incluyen como datos autenticados: otro ámbito no puede abrir el sobre. No persiste contraseña ni claves. Este componente todavía **no cifra las bases existentes**; preparar una migración transaccional con copia/verificación antes de conectar datos reales. Contraseña mínima 12 caracteres; definir recuperación sin borrar pedidos pendientes. En cierre de sesión bloquear lectura, vaciar claves de memoria y revocar remotamente; no eliminar pedidos pendientes automáticamente.

`api/receive-order.mjs`: recepción exclusiva de Mayorista con flag `enabled=false`, validación de UUID/cantidades, empresa y vendedor provenientes de sesión verificada, referencias/precios en servidor, huella SHA256 y recuperación del mismo acuse. El adaptador de persistencia debe implementar `UNIQUE(empresa_id,pedido_id)`, consultar el pedido recibido antes de revisar precios nuevos y rechazar el mismo UUID con otra huella. La validación y la inserción requieren una transacción. No se monta en `/api` de SIGO ni tiene credenciales.

Antes de habilitar el adaptador HTTP: restringir origen, método POST y content-type JSON, limitar cuerpo a 256 KiB, agregar rate limit, devolver 401/403/409/422/503 sin revelar detalles internos, no registrar tokens ni datos personales. Conexión con rol sujeto a RLS y JWT del usuario; sin conexiones de browser a un rol privilegiado.

Pruebas locales: `node src/modules/mayorista/tests/security.mjs`. Se verifican contratos y criptografía real de WebCrypto; las pruebas del servidor usan un repositorio en memoria. No sustituyen autenticación real, persistencia PostgreSQL, políticas RLS ejecutadas o evaluación del dispositivo.

El esquema SQL propuesto permanece en documentación, fuera de migraciones automáticas. No se ejecutó SQL remoto ni se modificó Supabase. Toda activación requiere un ambiente de prueba independiente y autorización.
