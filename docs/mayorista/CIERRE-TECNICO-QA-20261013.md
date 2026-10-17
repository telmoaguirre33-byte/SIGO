# Mayorista QA — evidencia y comprobaciones externas

Esta entrega conserva el desarrollo existente y corrige únicamente el instalador Mayorista. No implica merge, publicación productiva ni certificación comercial.

## Estado confirmado por Railway

**Actualización 2026-10-14:** `/health` HTTPS está **APROBADO EXTERNAMENTE** por el operador desde Android, con respuesta `{"status":"ok","module":"mayorista"}`. No repetir esta comprobación para el cierre actual. Login, roles y operaciones persistentes siguen pendientes; no se infieren del health.

- Proyecto `MAYORISTA-QA`: `b9a7da94-1d87-46fe-b4da-c7e241ebe185`.
- Entorno `qa`: `2addc3e9-f088-42df-a72c-c233fd4308cb`.
- API `mayorista-api-qa`: `9053689a-0e32-4f3c-b5da-3c01e480a9c6`.
- Despliegue API `c888f2f2-20d9-45a5-9d56-0657965edf65`: **SUCCESS**, código desplegado `f996b7ebaf727efdc9aa0393e5e2b0c9ec11e6fa`.
- Logs del despliegue: `MAYORISTA_QA_SCHEMA_READY`, `installed=true`, `verified=true`, y `Mayorista QA iniciado`.
- PostgreSQL existente: `9120b029-d20c-4073-a9cc-003953f60817`, despliegue `29dcc5de-f731-4ded-aa0d-ba988295a8a7` **SUCCESS**. Arranque original `/usr/bin/tini -g -- /usr/local/bin/wrapper.sh postgres -p 5432 -c listen_addresses=*` restaurado, sin impresión de certificados.
- No se crearon proyectos, servicios, bases, réplicas ni proxies. No se modificó producción.
- Origen HTTPS exacto: **https://mayorista-api-qa-qa.up.railway.app**.
- App Vendedor: https://mayorista-api-qa-qa.up.railway.app/secure.html . Portal operativo: https://mayorista-api-qa-qa.up.railway.app/portal.html . Son URLs configuradas; no se certifica desde este entorno su respuesta externa.

## Corrección Windows y TLS

El mensaje anterior ocultaba la causa de SSH. Registrar una clave no garantiza que OpenSSH, el relay y su host verificado sean accesibles. No se pide registrar nuevamente la clave.

En Windows se resuelve el `bin/railway.js` oficial instalado por npm/npx y se invoca con Node y `shell:false`. Se conservan espacios/metacaracteres como argumentos literales y se pasan secretos exclusivamente por stdin. Los errores SSH se clasifican sin imprimir stdout/stderr sensibles. Nunca se desactiva la validación de host ni TLS.

La vía predeterminada usa `qa-public-certificates.json`, con **solo certificados públicos** obtenidos mediante logs administrativos autenticados del despliegue PostgreSQL `4bd21e01-7445-467d-befb-9947fab3b329`. Verifica identidad de proyecto/entorno/base, cadena X509, firma, CA, hostname privado, vigencia y huella. La alternativa SSH explícita queda disponible con `--ssh-public-certificates`; no es necesaria para esta QA.

Huella CA SHA-256: `45:18:AB:B5:92:30:5A:C8:01:8A:A1:57:C3:8F:4A:65:47:41:75:87:28:62:BE:22:F4:73:6C:7D:37:9F:F8:AB`. La cadena pública local validada no equivale a una nueva prueba HTTP externa ni a un nuevo handshake remoto desde este ejecutor. Si se reemplaza la base o rota su CA, actualizar el bundle mediante una fuente administrativa autenticada y volver a validar; nunca aceptar un certificado remoto no verificado.

**No volver a ejecutar el bootstrap para esta QA ya instalada.** El instalador conserva el rechazo de bootstrap existente para evitar reemplazar usuarios/credenciales. Las claves privadas, contraseñas y tokens no están en Git. Las credenciales de instalación no están en Git. El ejecutor fue reemplazado y no dispone ahora de ese archivo privado. Usar una cuenta QA existente o recuperar el archivo privado de instalación por un canal seguro; no enviar contraseñas al chat ni reiniciar el bootstrap.

## Comprobación externa desde Windows

Desde un equipo con acceso a Internet y Node 24, en el checkout de la rama Mayorista. Para este cierre ejecutar solo la tercera línea, que omite health ya aprobado. Las dos primeras quedan como referencia histórica:

```powershell
curl.exe --fail-with-body --connect-timeout 10 --max-time 30 -i https://mayorista-api-qa-qa.up.railway.app/health
node src/modules/mayorista/railway/verify-existing-qa.mjs
node src/modules/mayorista/railway/verify-existing-qa.mjs --login-only --credentials "C:\QA-Privado\credenciales-qa.json"
```

La primera comprobación debe devolver HTTP 200 y `{"status":"ok","module":"mayorista"}`. No usar `-k`, ni desactivar TLS. El segundo comando comprueba health y rechazo 401 del catálogo anónimo. El tercero requiere un archivo privado de una cuenta **gerencia QA**, no credenciales productivas, con esta estructura (los valores indicados son marcadores):

```json
{"origin":"https://mayorista-api-qa-qa.up.railway.app","empresaId":"UUID-DE-EMPRESA-QA","email":"EMAIL-QA","password":"CONTRASEÑA-SOLO-EN-ARCHIVO-PRIVADO"}
```

Restringir el archivo a su propietario con las propiedades de seguridad de Windows; en Linux/macOS usar `chmod 600 archivo.json`. No agregarlo al checkout, compartirlo en el PR ni enviar claves por chat. Para la instalación inicial, empresa QA `38ebe62a-4bb4-4c48-9123-0cd4042624dd`, email `gerencia-qa@example.invalid`; la contraseña solo está en el archivo privado de instalación.

Con `--login-only`, el verificador omite health y comprueba login, `/me` con empresa/rol/permisos, lectura de catálogo, logout y rechazo 401 después de revocación. No imprime tokens ni contraseñas y no modifica datos comerciales. No instala ni cambia Railway. Sus pruebas unitarias usan transporte simulado: **no acreditan ejecución externa**.

Si todos los pasos pasan, retirar en el servicio QA la contraseña de bootstrap (`MAYORISTA_BOOTSTRAP_PASSWORD` vacía) y establecer `MAYORISTA_BOOTSTRAP_INSTALL_ONCE=false`, conservando la clave de firma, UUID y credenciales privadas del usuario ya creado. Este endurecimiento queda pendiente del login externo; no implica generar usuarios nuevos. Cualquier redeploy posterior debe verificar el esquema existente sin reinstalar.

## Pendientes externos sin hardware

- Ejecutar únicamente el comando `--login-only --credentials` para este cierre; health ya fue aprobado externamente. Conservar fecha, estados HTTP y salida sanitizada.
- Probar los cinco roles reales, restricciones de funciones/asignaciones y dos empresas distintas; un login de gerencia no demuestra todo el aislamiento.
- Crear catálogo/pedido QA, repetir el mismo UUID en paralelo y confirmar una recepción; completar aprobación, picking, despacho, entrega/devolución, cobro/rendición/cierre en PostgreSQL QA. No usar stock ni facturación de SIGO.
- Verificar persistencia después de reiniciar API, recuperación de respaldo y límites/consumo mensual. No se certifican aquí.
- Ejecutar el circuito de navegador contra QA; mantener separado el CI PostgreSQL efímero del PostgreSQL Railway persistente.

El ejecutor no puede conectar con su proxy HTTP. Se reconoce `/health` aprobado externamente por el operador; login y operaciones comerciales reales no se declaran aprobados desde el ejecutor. Tampoco se declara probada la ejecución física del CLI en Windows por pruebas de argumentos simuladas en Linux.

## Checklist físico con el operador

Usar exclusivamente QA y registrar modelo de Android, versión de Chrome, fecha, UUID y resultado. Antes de desinstalar, sincronizar o respaldar pedidos; cambiar de origen crea otro almacén local.

1. **Instalación Android:** abrir `/secure.html` en Chrome por HTTPS; elegir instalar. Confirmar nombre SIGO Vendedor, S negra sobre blanco y apertura independiente desde el lanzador. Cerrar Chrome y abrir desde el icono. Registrar si ofrece WebAPK/instalación o solo acceso directo.
2. **Offline y cierre real:** con catálogo descargado, activar modo avión, crear pedidos/visitas, anotar UUID/cantidades, cerrar forzosamente y reabrir. Confirmar recuperación exacta. Restablecer red y verificar en administración una recepción por UUID, sin duplicados. No borrar datos ni desinstalar durante esta prueba.
3. **Dos dispositivos:** usar vendedores QA con clientes asignados; enviar pedidos simultáneos y comprobar que cada uno ve su empresa/asignaciones. Con el mismo UUID/reintento, verificar idempotencia en el backend; no confundir dos pedidos nuevos con duplicaciones.
4. **GPS:** permitir ubicación, registrar visita en un cliente QA y comparar coordenadas/precisión/hora con el lugar. Denegar permiso y comprobar mensaje recuperable; repetir sin red. El mapa offline de coordenadas no certifica navegación vial.
5. **Lector:** conectar el lector real y escanear código conocido/desconocido y repetido durante picking. Comprobar cantidades, rechazo de códigos ajenos, faltantes/sobrantes y control de exceso, sin afectar stock SIGO.
6. **Impresora:** imprimir hoja de carga y reparto en el equipo/impresora reales. Comprobar legibilidad, cliente, ruta, chofer, cantidades, saltos de página y ausencia de información de otra empresa.
7. **Reparto/cobranzas:** con chofer QA, registrar entrega parcial, devolución y cobro; rendir, recibir devoluciones y cerrar la carga. Comprobar importes, responsables, historial y rechazo de reintentos duplicados en el portal QA.

Las pruebas físicas siguen pendientes y no bloquean guardar este trabajo. Su aprobación requiere evidencia del dispositivo real.
