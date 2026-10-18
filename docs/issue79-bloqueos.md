# Issue #79: evidencia y límites de migraciones

F06 queda limitado al inventario Git de `issue79-migraciones.json`, fijado a main
`d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`. Los SHA de blob permiten contrastar
contenido sin modificar ni ejecutar los archivos históricos. Este inventario no
prueba qué versiones están aplicadas, ni resuelve divergencias de esquema.

Para conciliar hace falta una copia autorizada del esquema e historial de
migraciones, un backup identificado y una restauración verificada en un destino
aislado. No hay ese destino ni backup configurados en esta sesión. No se consultan
ni alteran COMERCIAL, SOVI o PROSPECCIÓN; no se ejecutan `db push`, reparaciones del
historial, migraciones históricas ni SQL contra servicios reales.

Las pruebas PostgreSQL de Compras usan una base efímera con fixtures: comprueban
su RPC y permisos, pero no sustituyen la reconciliación del historial real.

F22/F23/F25/F28 no tienen detalle en la issue: se solicitó el informe completo;
no se realizan cambios inferidos a partir de sus números.

El proxy local configurado rechaza conexiones a GitHub/npm. El código se recuperó
con el conector GitHub y la compilación se ejecuta en GitHub Actions. Vercel MCP
devuelve 403 para el equipo autorizado y no hay CLI Vercel instalada; el estado
READY se contrasta mediante GitHub/Vercel bot, sin abrir sesiones comerciales.
