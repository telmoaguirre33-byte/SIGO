# Continuación después de auditoría Work

Base auditada: `726abedb6cbc4f556f4dd7dd1aacdc931f994ce1`.
Rama exclusiva: `feat/mayorista-distribuidora-offline-20261012`.

## Bloqueo de ejecución y recuperación

La ejecución anterior quedó esperando una solicitud de permisos de red para las pruebas reales; se interrumpió sin resultado. No hubo nuevos commits durante esa espera. Se conservaron los archivos y se continuó usando el conector GitHub, sin reiniciar el desarrollo.

El ejecutor de navegador ahora tiene manejo de error y límite de cinco segundos al iniciar servidor; no deja una espera sin diagnóstico. Ejecución posterior: `listen EPERM: operation not permitted 127.0.0.1:4173`. No se pidieron más permisos ni se cambiaron restricciones del entorno.

## Cambios guardados

Primer commit de continuación: `f213203077693a3ea7fdced6e42a65ec0e86055b`.

- Componentes preparados de sesión, permisos por empresa y cifrado local.
- Receptor independiente de pedidos, desactivado por defecto, con identidad verificada y contrato de persistencia idempotente.
- Borrador de tablas/RLS exclusivo de un ambiente nuevo de pruebas. Guardado en documentación con `NO_APLICAR` y `rollback`; no ejecutado, sin migración automática.
- Configuración de TypeScript exclusiva de Mayorista, compilador y tipos con versiones exactas.
- Ejecutor de navegador que falla de forma explícita ante restricción de sockets.

La continuación agrega administración demo independiente en `demo/admin.html`: alta/edición de vendedores, rutas, asignaciones de clientes, objetivos, consulta local de pedidos/visitas, informe gerencial y CSV compatible con Excel (no XLSX). Persistencia propia en IndexedDB, revisiones para detectar edición concurrente y neutralización de fórmulas en CSV. No modifica catálogos ni pedidos vendedores. Los pedidos recibidos son solo los del simulador local, no pedidos de un servidor real.

El ensayo de sincronización se preparó para dos pestañas Chromium reales del mismo perfil, además de las pruebas ya preparadas de 100 pedidos, recarga offline y cierre/reapertura. Estos ensayos **no se ejecutaron** por la restricción del entorno.

## Verificaciones realmente ejecutadas

Desde `src/modules/mayorista/demo/`:

| Comando | Resultado |
| --- | --- |
| `node build.mjs` | Generación aislada correcta: módulos TS transformados, vendedor y admin demo. No chequeo de tipos. |
| `node ../tests/unit.mjs` | 17 aprobadas, 0 fallidas. |
| `node ../tests/security.mjs` | 18 aprobadas, 0 fallidas. Sesiones, WebCrypto y API con repositorio de prueba en memoria. |
| `node ../tests/admin.mjs` | 7 aprobadas, 0 fallidas. Modelo, ámbito, asignaciones, objetivos, informe y CSV. |
| `node --check` sobre archivos nuevos/modificados JS | Revisión sintáctica correcta. |
| `node ../tests/browser.mjs` | Bloqueado: `listen EPERM` al iniciar servidor local. Ninguna prueba real aprobada. |
| `node node_modules/typescript/bin/tsc -p tsconfig.mayorista.json` | No ejecutó chequeo: `MODULE_NOT_FOUND`; el compilador no está instalado. |
| Acceso al registro npm/changelog | Proxy no responde (`Could not connect to server`). |

Total de pruebas unitarias: **42 aprobadas, 0 fallidas**. Las pruebas en memoria no acreditan idempotencia, RLS ni persistencia de un servidor real. WebCrypto sí ejecutó cifrado/descifrado y rechazo de contraseñas, ámbito y contenido alterados.

Pendientes: navegador real, 100 pedidos persistidos, cierre/reapertura, pérdida/retorno de red, dos pestañas, instalación Android, GPS físico, TypeScript y políticas RLS en PostgreSQL. No se ejecutó el build principal de SIGO porque sus scripts modifican módulos fuera del alcance.

## Vercel: revisión de solo lectura

Proyecto existente: `sigo-mayorista-demo-20261012`, ID `prj_zWqWvjYqoIKJp3MnToDujdwZcPZG`.
Scope informado por proyecto: `team_jLCgAi5kimO2yxiN4EAxZP8O`.

- Último despliegue: `dpl_CZ74LXonAcPRTxgyjgHTJnNcrVA9`, `target=staging`, `readyState=BLOCKED`.
- Protección SSO: habilitada, `all_except_custom_domains`.
- Protección por contraseña: deshabilitada. Trusted IPs: deshabilitado.
- Consulta del plan/costos del scope: acceso denegado 403. No se pudo confirmar plan, límites ni cargos; no asumir costo cero.
- No se creó proyecto, no se desplegó, no se reactivó ni se modificó protección en esta continuación.

## Condiciones para habilitar Android, sujetas a autorización

1. Habilitar un entorno que permita servidor localhost y Chromium, y acceso al registro npm para instalar los devDependencies exactos y generar lockfile. Ejecutar TypeScript y la suite real antes de usar datos de clientes.
2. Recuperar permiso de lectura/gestión sobre el **proyecto existente** y su scope; confirmar plan, límites y cualquier cargo. No crear otro proyecto.
3. Revisar y retirar el despliegue inicial anterior clasificado como production antes de autorizar cualquier reactivación. Pausar/despausar es una operación del proyecto completo: no reactivar a ciegas.
4. Autorizar expresamente la activación y una preview del proyecto existente con solo `demo/dist`, sin variables de SIGO/Supabase ni promoción a production. En la API Vercel, el target usado para preview es `staging`; no usar `preview` ni omitir/verificar el destino solo después.
5. Mantener SSO; dar acceso al tester Android por una cuenta autorizada o un mecanismo temporal limitado autorizado. No deshabilitar protección global ni usar un alias de production para evitar SSO.
6. Verificar en Android HTTPS, acceso SSO, service worker, manifest, instalación, GPS y modo avión. Una respuesta READY de hosting no equivale a una prueba Android.

La autenticación y el cifrado están preparados como componentes separados, todavía no conectados a los datos demo. El selector de vendedor continúa siendo demo. No introducir datos reales hasta conectar un proveedor validado, repositorio transaccional, RLS probada y migración segura del almacenamiento local. La integración con SIGO permanece desactivada.
