# Ensayo sintético de recuperación Supabase 17

Este job de PR usa únicamente runners estándar de GitHub Actions en el repositorio público, imágenes oficiales y datos creados durante el job. No usa secretos de GitHub, Supabase gestionado, Railway, COMERCIAL, Auth o Storage reales. No crea infraestructura externa.

Se fija Supabase upstream en d4584290813a59954d7d6f098a5fb31ff433afaa; el job resuelve y registra digests de imágenes. Levanta la pila oficial completa en red Docker interna, sin puertos publicados y con pruebas negativas de salida antes de sembrar o restaurar datos. Deshabilita correo, SMS, proveedores externos y jobs cron. La función Edge es una sonda sintética sin dependencias remotas.

El origen crea identidades con GoTrue real, sesiones firmadas, dos propietarios aislados por RLS, una función SQL invoker, un secreto Vault y un objeto Storage privado. Con los consumidores detenidos, archiva todas las bases no template usando pg_dump 17 y los bytes de Storage y funciones por separado. Restaura en un cluster nuevo con pg_restore transaccional, sin ignorar errores ni descartar objetos incompatibles, y claves JWT diferentes. Conserva la clave pgsodium si existe.

La aceptación exige versiones, roles y atributos, extensiones, policies, funciones, usuarios y datos idénticos antes de iniciar servicios destino; descifrado Vault; login real con contraseña restaurada; rechazo de JWT de origen y contraseña incorrecta; aislamiento RLS; RPC; SHA256 del objeto Storage y rechazo del otro propietario. El resultado saneado queda en el artefacto del job. Los dumps y credenciales sintéticos no se publican.

**Límites:** un PASS acredita este ensayo sintético de Supabase completo con la combinación fijada de versiones. No acredita respaldo ni recuperación de COMERCIAL, compatibilidad con extensiones/configuración productivas aún no comparadas, OAuth/SMTP/SMS/ARCA, reubicación del binding comercial, migraciones productivas, RPO/RTO comercial ni publicación. Las 21 migraciones y la regresión integrada se verifican en el CI Mayorista existente, por separado.
