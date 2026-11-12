# COMERCIAL PR #122: custodia recuperable del respaldo

El respaldo anterior del run 43317161295 conservó la clave privada sólo en el
entorno local del operador. No existe constancia de entrega al administrador.
No se lo usa como único respaldo recuperable para autorizar el RLS pendiente.

El operador manual de esta rama crea una clave GPG nueva en un runner privado,
guarda el paquete de clave privada/pública/fingerprint como un secreto nuevo en
Vault de COMERCIAL y verifica su lectura. No cambia grants de Vault, tablas de
negocio, funciones del catálogo, RLS productivo ni otros proyectos.

La captura PostgreSQL mantiene snapshot consistente READ ONLY. El ciphertext,
frase envuelta e índice se guardan como objetos nuevos del bucket privado
existente. Se eliminan las copias locales originales antes de descargar desde
Storage, verificar SHA-256, recuperar nuevamente la clave de Vault, descifrar y
restaurar en PostgreSQL sin red ni puertos. Se comparan filas, esquema, roles,
policies, ACL y secuencias, y se ensaya sólo el RLS de SHA-256
991d9a777676206cd91f517e8ec09454b54b2051b789350a46433c5a15fc8136.

Un administrador autorizado de Supabase puede recuperar la clave en **COMERCIAL
→ Database → Vault**, por el nombre `sigo122_recovery_<run>_<attempt>_<nonce>`
que consta en el informe. El valor es un JSON con `private_key`, `public_key` y
`fingerprint`. Es privado: no pegarlo en comentarios, logs ni chats. El informe
identifica también el prefijo y hash del respaldo correspondiente. Puede
custodiarse una copia independiente del secreto en el gestor privado del
administrador; la custodia automática realizada aquí reside en Vault del mismo
proyecto, no protege por sí sola frente a la eliminación completa de COMERCIAL.

No hay claves ni datos comerciales en commits, artifacts o logs. El rol
service_role existente tiene acceso administrativo a Vault; anon/authenticated
no deben poder leer secretos. El operador lo comprueba antes de guardar claves.

El archivo cubre PostgreSQL, sin passwords LOGIN, bytes de objetos Storage ni
configuración/secretos externos. No restaurar toda la base sobre ventas nuevas.
El informe PASS no autoriza aplicar RLS ni publicar la PR: se requiere la
autorización específica del usuario después del ensayo real.
