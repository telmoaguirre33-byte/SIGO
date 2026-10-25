# SIGO Vendedor: aceptación de experiencia en QA

P0 permanece abierto. Los dos pedidos físicos existentes no se inspeccionan, editan,
reidentifican ni envían desde este desarrollo. No se limpia IndexedDB ni se cambia
su versión, nombre de base, claves de alcance o cifrado de los registros existentes.

## Flujo de trabajo

Inicio ofrece Nuevo pedido, Mis pedidos, Clientes, Ruta, Cobranzas y Objetivos.
Cliente se busca entre los asignados descargados (máximo 20 resultados visibles)
por nombre, nombre comercial, código, dirección, zona e identificadores disponibles.
Productos reutiliza el buscador de 5.000 productos, cámara, lector, EAN, marca y
normalización de tildes. Cada selección/presentación reinicia cantidad a uno.

Nuevo pedido: cliente → productos → revisión, pago y guardar. Contado es el valor
inicial solamente de pedidos nuevos. Los pedidos anteriores conservan su condición.
Cuenta corriente exige selección expresa; muestra datos de crédito descargados y
mantiene intacta la validación comercial del servidor. Las cantidades representan
presentaciones y se convierten a unidades internas de forma explícita.

Mis pedidos separa borradores, pendientes, recibidos, confirmados y cancelados. El
UUID está en detalles técnicos. Los borradores se conservan cifrados. Pedidos locales
pendientes con cero intentos admiten edición/cancelación mediante CAS, mismo UUID e
historial de revisión. Desde el primer intento son de solo lectura, incluso cuando
se pierde el acuse: cambiar el cuerpo podría contradecir la idempotencia remota.
No se implementa una ruta paralela para modificar pedidos recibidos o consolidados.

Guardar, abrir, iniciar sesión, descargar catálogo o reconectar NO envían pedidos,
visitas ni cobranzas. Solo Sincronizar inicia sus colas existentes con Web Locks.
Los dos pedidos manuales intencionales no se deduplican por similitud de contenido.

## Preparación y protección del teléfono

Primera preparación: login verificado → clave AES-GCM aleatoria de 256 bits → datos
cifrados → descarga. No se exige una segunda contraseña. La clave se guarda como
CryptoKey no exportable mediante structured clone de IndexedDB, aislada por origen
y vendedor. La contraseña no se persiste. Una copia de recuperación de la clave
aleatoria se cifra con PBKDF2 (310.000 iteraciones, salt aleatorio) derivado de la
contraseña de acceso; permite volver a autenticar tras cerrar sesión voluntariamente.

Un almacén legado necesita su clave local anterior UNA vez para habilitar reapertura
rápida sin recifrar ni reemplazar pedidos. No se intenta adivinar ni evadir esa clave.
Cerrar sesión elimina la clave de apertura automática y vacía la sesión cifrada;
conserva los registros. Un perfil legado vuelve a necesitar su clave anterior después
de ese cierre explícito. Un restablecimiento de contraseña tras cierre/revocación puede
requerir el respaldo o la contraseña anterior para recuperar datos locales pendientes.

La sesión preparada se solicita expresamente y solo se concede al vendedor operativo.
Caduca como máximo a los siete días; otros roles y logins normales mantienen una hora.
Cada request conserva las verificaciones actuales de sesión, usuario, empresa, rol y
revocación. Reabrir online, reconectar y el control periódico verifican /me sin enviar
movimientos. Offline no permite extender el plazo ni superar la caducidad guardada.
Gerencia puede listar y revocar una sesión concreta en Personal → Teléfonos y sesiones.
Desactivar vendedor/cambiar permisos/renovar contraseña conserva la revocación existente.

Una revocación no puede comunicarse a un teléfono totalmente desconectado: el límite
es reconexión o vencimiento del permiso offline. La clave del navegador NO es una
clave en enclave hardware ni una implementación de biometría WebAuthn. Debe utilizarse
el bloqueo PIN/huella del sistema operativo y un perfil personal del teléfono.
No hay garantía contra malware/XSS del mismo origen o un dispositivo desbloqueado.
El respaldo portátil usa una clave independiente elegida al exportar; excluye CryptoKey,
material de recuperación del dispositivo y tokens de sesión.

## Continuación física después del despliegue autorizado

1. Abrir la misma instalación Android y autenticar si corresponde. Para el almacén
   anterior, ingresar la clave local anterior una vez. No pulsar Sincronizar.
2. Mis pedidos: abrir los DOS pedidos previos y verificar cliente, líneas, cantidades,
   condición, total y UUID en Detalles técnicos. Registrar sus referencias.
3. Cerrar/reabrir; modo avión; comprobar ambos pedidos. No crear otra PRUEBA P0.
4. Solo después de revisar ambos pedidos y autorizar su envío, pulsar Sincronizar.
5. Comprobar administración, depósito, entrega, cobranza y conciliación en QA.

CI utiliza PostgreSQL y Chromium efímeros existentes en el workflow, con datos de prueba
propios. Reiniciar Chromium y emular red no equivale a reiniciar un Android físico.
No se ejecuta nuevamente la aceptación persistente ya aprobada en Railway.
