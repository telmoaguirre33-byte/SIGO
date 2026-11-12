# Respaldo local privado — SIGO Gestión / PR #122

Esta alternativa **se ejecuta en un equipo autorizado del titular, fuera de Codex**. No requiere guardar secretos ni habilitar TCP en Codex. No modifica SQL/RLS, datos, ventas o despliegues de producción. No contratar un servicio ni crear un proyecto Supabase nuevo.

## Una intervención concreta

El administrador descarga/descomprime este paquete en su equipo y ejecuta:

```bash
python3 respaldo.py completo --ensayar-candidato
```

Requisitos del equipo: Linux, macOS o WSL con Python 3.10+, GnuPG (`gpg`) y **Docker local iniciado y accesible**; conexión saliente al Session pooler en TCP 5432; espacio suficiente para archivo, descifrado y Docker. La imagen completa Supabase y la restauración pueden necesitar decenas de GB temporales. Los datos quedan en `~/SIGO-respaldos-privados/`, con permisos privados, fuera de cualquier repositorio. Elegir un disco privado con cifrado y conservación duradera del titular. No usar carpetas públicas o sincronizadas públicamente.

Si necesita instalar herramientas en Ubuntu/WSL, el administrador puede usar el gestor oficial de su sistema: `sudo apt-get update` y `sudo apt-get install python3 gnupg docker.io`; debe iniciar Docker y dar a su usuario acceso al socket local conforme a su administración. En macOS, usar Python/GnuPG y Docker local ya aprobados por el titular. No se instala ni contrata nada automáticamente.

## De dónde sale la conexión, sin compartirla

1. Abrir personalmente **[Supabase COMERCIAL → Connect](https://supabase.com/dashboard/project/pafnbxfgpedbvpimjmun?showConnect=true)** con acceso autorizado al proyecto.
2. Elegir **Session pooler**, base `postgres`, usuario `postgres.pafnbxfgpedbvpimjmun`, puerto **5432**. No usar Transaction pooler/6543 ni una API key. Usar el host exacto mostrado por Connect, no adivinarlo.
3. Obtener la contraseña PostgreSQL vigente del gestor privado del titular; no resetearla como parte de este procedimiento. Completar la URI **en el gestor privado**; codificar caracteres especiales de contraseña conforme a URI. Nunca usar un conversor online.
4. La herramienta pide la **URI completa con entrada oculta**. Pegarla allí; no aparece en pantalla, argumentos ni historial del shell. No pasarla como argumento. Borrar el portapapeles al terminar. Alternativamente, un gestor de secretos local puede inyectar `SIGO_BACKUP_DATABASE_URL` sólo al proceso; la herramienta usa esa variable sin imprimirla.
5. La herramienta valida el proyecto/usuario/puerto y fuerza **TLS `verify-full` con CA del sistema**. No acepta desactivar TLS. Ante error de certificado, detenerse y corregir la CA con el administrador; no sustituir por `sslmode=disable` ni saltar verificación.
6. La conexión y pgpass temporales son 0600; se eliminan al terminar. Se pide además una frase de cifrado **nueva y distinta de la contraseña de DB**. Guardarla en el gestor privado del titular, separada del archivo. No enviarla por chat, GitHub ni junto con el respaldo.

No es necesario crear una variable permanente ni editar `.env` de la aplicación. En esta alternativa, el secreto se entrega directamente y de forma oculta a la herramienta local. Tampoco hace falta abrir puertos entrantes: sólo permitir salida TCP al host oficial que mostró Connect, puerto 5432, en el firewall del equipo/red autorizado. No se habilita acceso a otros proyectos.

## Qué hace `completo`

- Usa un cliente PostgreSQL 17.6 en Docker local; ninguna credencial se envía a un daemon Docker remoto.
- Mantiene una transacción READ ONLY y un snapshot exportado. `pg_dump --format=custom --create --snapshot=…` y los hashes de tablas usan ese snapshot. Evitar cambios de esquema/roles durante la captura. Se limita la espera de locks y se aborta ante errores.
- Captura roles/atributos/membresías **sin contraseñas**, esquema, datos, funciones, triggers, propietarios, ACL, RLS/policies, restricciones, índices, secuencias y large objects según el alcance estándar de `pg_dump`. No usa `--no-owner`, `--no-acl` ni exclusiones de tablas comerciales. Las tablas transitorias internas de extensiones no incluidas por `pg_dump` se declaran fuera de cobertura.
- Las secuencias no son MVCC: se verifican contra los valores que quedaron en el archive, no contra un valor observado después mientras siguen entrando ventas. Una restauración futura sobre datos posteriores exige reconciliarlas; este procedimiento nunca modifica secuencias en origen.
- Cifra el paquete con GnuPG AES-256 y comprueba descifrado e integridad. El archivo final es `COMERCIAL-backup.tar.gpg`. Los archivos temporales en claro se eliminan al terminar. El borrado no promete saneamiento físico de SSD; usar el disco privado cifrado del titular.
- Descifra **ese mismo archivo** y lo restaura en una instancia nueva Docker de `supabase/postgres:17.6.1.166`, con **`network=none`, sin puertos publicados y sin credenciales de producción**. No restaura sobre ninguna base existente. La copia queda sin red también durante el restore: no puede enviar correo, webhooks ni CAE.
- Usa un cluster vacío y un operador local distinto, para restaurar roles/propietarios sin colisiones con un Supabase ya inicializado. No ignora errores ni excluye objetos para obtener un verde artificial.
- Compara esquema/funciones/ACL, roles/membresías, políticas, extensiones/versiones, hash de todas las filas de tablas del alcance, large objects y valores de secuencias. Borra únicamente su contenedor/volumen de ensayo al terminar; conserva el archivo cifrado del titular.
- Con `--ensayar-candidato`, después de verificar la copia original, coteja los SHA-256 de `catalogo.sql` y `rls.sql` incluidos y los ejecuta **sólo dentro de ese contenedor nuevo sin red**. Comprueba las postcondiciones de los SQL exactos, permisos anon/escritura directa, endpoint, sesión nula y que todas las filas del alcance sigan iguales. Nunca dispone del objeto de conexión productiva en esa fase. Esto complementa la matriz sintética de roles existente; no sustituye la revisión del alcance compartido ni autoriza producción.

**No cubre:** contraseñas LOGIN, claves/configuración externa del proyecto, objetos físicos de Storage, despliegues Edge ni secretos externos que necesiten extensiones/Vault. Mantenerlos por los canales seguros existentes y revisar su recuperación separadamente. No confundir este archive con un respaldo completo de todos los servicios Supabase. Un error de permisos de captura o una incompatibilidad de una extensión deja la prueba fallida; no reducir cobertura para declararla aprobada.

## Resultado y retorno seguro

Sólo `PASS_DATABASE_ARCHIVE` con coincidencias completas acredita el ensayo de recuperación de **ese archive PostgreSQL**. `CAPTURED_NOT_RESTORED`, cualquier error o una imagen no descargada no acreditan recuperabilidad.

El archivo `resultado-sin-secretos.json` contiene estado, SHA-256 y limitaciones, sin URI, contraseña, nombres de tablas ni filas. Se puede entregar ese informe para continuar #122. **No enviar** el respaldo, la frase ni `diagnostico-PRIVADO.log` por GitHub/chat. Conservar archivo y frase separadamente en almacenamiento privado duradero del titular. Codex distinguirá la ejecución documentada por el titular de una restauración observada directamente por Codex.

Si ya quedó capturado pero falló el ensayo, no es necesario volver a leer producción para reintentar el restore:

```bash
python3 respaldo.py verificar /ruta/privada/COMERCIAL-backup.tar.gpg --ensayar-candidato
```

Si cambia el candidato de restauración o hay incompatibilidades administradas, detenerse y revisar el diagnóstico local privado. No editar el archive, omitir auth/storage ni suprimir errores para aprobarlo.

## Evidencia de la herramienta antes de entregarla

El ensayo de este código en PostgreSQL 17.6 sintético pasó: snapshot excluye una inserción concurrente posterior; cifrado/descifrado, rechazo de corrupción, restore sin red, datos/esquema/funciones/triggers/roles/membresías/RLS/ACL/secuencias coinciden; se rechazan otro proyecto y puerto 6543. Sin datos comerciales.

**Límite explícito:** la descarga de la imagen Supabase completa falló en Codex por espacio durante la extracción. Su ejecución y las extensiones administradas reales aún no están verificadas. La herramienta aborta si no restaura íntegramente; el ensayo sintético no es un respaldo de COMERCIAL.

El resultado no autoriza migraciones ni publicación. Tras respaldo real verificado y cierre del gate RLS, presentar el SQL exacto y pedir autorización específica. Orden: SQL autorizado y verificado → web compatible → validación del cliente sin operaciones comerciales reales.

## SQL exacto incluido, únicamente para ensayo de la copia

Los dos archivos se copian sin modificaciones del candidato de #122. La herramienta coteja sus hashes antes de usarlos. No son migraciones automáticas de esta rama operativa.

| Archivo del paquete | Origen en #122 | SHA-256 |
| --- | --- | --- |
| `catalogo.sql` | `20261112021657_catalogo_busqueda_servidor_121.sql` | `33dcd3c00c02535f8df262752bc148726345a240de71eb931565f746b8e68046` |
| `rls.sql` | `02_APLICAR_PRODUCTOS_RLS_NO_AUTORIZADO.sql` | `991d9a777676206cd91f517e8ec09454b54b2051b789350a46433c5a15fc8136` |

Se probó también la cadena captura → cifrado → descifrado → restore → aplicación de estos archivos exactos sobre otro fixture sin red. Pasó sin cambiar filas. No certifica la copia comercial ni la imagen Supabase completa. La matriz RLS previa de 50.000 por empresa sigue siendo evidencia separada. Cuatro pruebas unitarias adicionales pasan: TLS/pgpass privado, proyecto/puerto/host incorrectos rechazados, comparación de políticas sin ignorar expresiones/permisos y rechazo de entrada de contraseña que pudiera tener eco.

RLS productivo continúa pendiente del alcance compartido/autorización. Su rollback anterior reabre permisos y no se ejecuta automáticamente. Esta herramienta no cierra ese gate por mostrar `PASS_DATABASE_ARCHIVE`.
