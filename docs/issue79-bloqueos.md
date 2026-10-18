# Issue #79: evidencia y límites de migraciones

F06 queda limitado al inventario Git de `issue79-migraciones.json`, fijado a main
`d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`. Los SHA de blob permiten contrastar
contenido sin modificar ni ejecutar los archivos históricos. Este inventario no
prueba qué versiones están aplicadas, ni resuelve divergencias de esquema.

Se identificó el proyecto COMERCIAL mediante metadatos de la conexión existente.
Se leyó únicamente su lista de versiones/nombres, sin consultar tablas comerciales
ni ejecutar SQL. La comparación local respaldada en
`issue79-conciliacion-inventario.json` da:

- 98 archivos en Git y 107 entradas de historial en servidor.
- 84 coincidencias de versión y nombre.
- 14 nombres coincidentes con versiones distintas.
- 9 nombres presentes sólo en el historial del servidor; ninguno sólo en Git.

El caso `compra_ia_precio_existente`, por ejemplo, figura con versión
`20260925124916` en servidor y `20260925135500` en Git. Eso NO demuestra igualdad
SQL ni permite registrar una versión como aplicada. El archivo JSON conserva la
lista completa y los pares para su revisión, sin normalizar el historial.

La conexión consultada no ofrece un proyecto QA separado. No hay un backup del
esquema real ni una restauración acreditada disponibles mediante las herramientas
conectadas. Antes de reparar hacen falta los SQL/checksums originales y un backup
restaurable del esquema/historial, ensayados en una base aislada. No se ejecutaron
`db push`, reparaciones del historial, migraciones históricas ni SQL contra
servicios reales. Tampoco se crearon proyectos ni recursos pagos.

La copia del inventario tiene SHA256
`d0f6c76ba76e0336ddd7b7ca4bb3a744226a328a3806e1236952438fdd2b9b85`;
es respaldo de metadatos y no equivale a backup de una base de datos.

Las pruebas PostgreSQL de Compras usan una base efímera con fixtures: comprueban
su RPC y permisos, pero no sustituyen la reconciliación del historial real.

F22/F23/F25/F28 no tienen detalle en la issue: se solicitó el informe completo;
no se realizan cambios inferidos a partir de sus números.

El proxy local configurado rechaza conexiones a GitHub/npm. El código se recuperó
con el conector GitHub y la compilación se ejecuta en GitHub Actions. Vercel MCP
devuelve 403 para el equipo autorizado y no hay CLI Vercel instalada; el estado
READY se contrasta mediante GitHub/Vercel bot, sin abrir sesiones comerciales.
