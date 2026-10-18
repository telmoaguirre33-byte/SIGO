# Mayorista / Distribuidora: avance verificable para Work

El sistema **no está certificado para comercialización ni listo para la auditoría final de aceptación**. Este informe entrega código y evidencia de un avance; no declara terminadas las funciones y pruebas pendientes.

Rama exclusiva: `feat/mayorista-distribuidora-offline-20261012`. PR #72 sigue borrador, sin merge. Punto de partida auditado: `55a8d86`. Ninguna publicación ni migración remota se realizó.

## Cambios realizados

- Nueva App Vendedor cifrada, independiente de la demo previa: identidad validada online, catálogo propio, borrador durable con varias líneas, pedidos con UUID estable, visitas con resultado GPS, recuperación offline con clave local y sincronización autenticada. El catálogo operativo actual es el normalizado de la base de QA; no se representa como catálogo comercial publicado.
- IndexedDB nuevo: AES-GCM de 256 bits, clave derivada mediante PBKDF2-SHA256 de 310.000 iteraciones, salt e IV aleatorios, empresa/vendedor/tipo/UUID/revisión en AAD y comparación de revisión en la transacción. Datos comerciales cifrados; claves y tokens no se persisten. Se mantienen los almacenes previos sin reemplazarlos ni migrarlos silenciosamente.
- Bloqueo local inmediato, protección contra login que termina después de logout, tiempo máximo de petición de veinte segundos y bloqueo por inactividad. Desbloqueo offline limitado a siete días desde la validación online. La revocación del servidor no puede comprobarse mientras el dispositivo está desconectado.
- Respaldo cifrado: restauración íntegra en un segundo perfil vacío, rechazo de contraseña/ámbito/contenido alterado y rechazo de sobrescribir un almacén existente. Recuperación por pérdida de la clave y conciliación de dos almacenes con datos distintos siguen pendientes.
- Visitas: API real GET/POST `/visits`, validación de coordenadas y errores GPS, unicidad por empresa/UUID, contenido inmutable y RLS. Cola cifrada y confirmación únicamente con acuse válido del servidor.
- Inventario exclusivamente Mayorista: ingresos con comprobante único, reservas por carga verificada, salidas y reingresos de devoluciones. Saldo y efectos de carga comparten transacción serializable. Ningún acceso al Stock de SIGO.
- Libro propio de cuentas: cargos por entrega, créditos por devolución y cobros al revisar rendición. Una devolución posterior al cobro conserva lo cobrado y genera saldo acreedor; revisar otra vez no contabiliza otro cobro. Ningún acceso a Caja ni cuentas existentes.
- API nueva `/inventory`, `/inventory/commands`, `/accounts`. `inventoryRequired` y `accountsEnabled` están desactivados por defecto y activados expresamente en CI aislado. Las cantidades devueltas proceden del reparto declarado; todavía falta confirmar recepción física en depósito antes de usarlo comercialmente.
- Entrada PWA segura `secure.html`, manifest propio con inicio independiente y configuración desactivada por defecto. El manifest y sus PNG cumplen los controles automatizados; no acredita instalación en un teléfono.
- Matriz autorizada de cinco roles con controles unitarios: gerencia, administración, vendedor, armador y chofer. **No está vinculada todavía a las membresías persistentes y políticas comerciales del servidor**. La API de QA continúa con vendedor/administrador; armadores y choferes son responsables registrados de las cargas, no usuarios comerciales habilitados por este avance.

## Commits de este avance

| Commit | Cambio |
|---|---|
| 8206e37 | Almacén cifrado y recuperación de cien pedidos |
| 60f07fa | App cifrada y matriz autorizada de roles |
| e8093ee | Visitas con API, outbox cifrada y RLS |
| febe127 | Inventario propio y libro de cuentas de cargas |
| 6678fe6 | Devolución posterior al cobro y rollback por falta de mercadería |
| 40cc41e | Espera segura durante recarga offline del arnés |
| 2cbbaeb | Sesión cancelable, bloqueo inmediato y entrada PWA |
| 1cee307 | Manifest independiente de globals de un perfil cerrado |
| 3b31d86 | Restauración de respaldo en segundo perfil |
| 076862b | Sincronización automática con conexión/sesión renovadas |

## Evidencia ejecutada

Código verificado `076862bca24db72dafe970ad90f9bfb9e7a486a5`:

| Verificación | Resultado y alcance |
|---|---|
| Node | 114 pruebas automáticas; 24 controles adicionales de matriz de roles |
| TypeScript | tsc del proyecto aislado aprobado; no sustituido por stripTypeScriptTypes |
| Chromium/IndexedDB | 43 controles aprobados, incluyendo cien pedidos cifrados y reapertura completa del perfil |
| API + PostgreSQL 17 | 52 controles aprobados; sesiones firmadas, dos perfiles, idempotencia, visitas, cargas, saldo y concurrencia |
| RLS dedicado | 7 controles aprobados; más verificaciones específicas incluidas en las 52 de API |
| Build SIGO | Aprobado; verificación crítica de módulos existentes aprobada |
| Compras | Fallo previo persistente `150 !== null`; no aprobado ni corregido dentro de este trabajo |

Ejecuciones: [Mayorista](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38310952431), [Build](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38310952516), [Compras](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38310952415).

Artefacto `mayorista-evidencia-38310952431`, ID `11774283612`, vence 19/10/2026. SHA256 `1e04cd9e1395e8b55a136b6b14118ed0007f863be5b771a64871e6105e1db5c1`. Contiene resultados JSON, capturas, PDF de carga y lockfiles. Descargar antes del vencimiento para la auditoría.

Se ejecutó además localmente la batería Node completa de 114 pruebas más los 24 controles de roles y build aislado. El navegador/API/DB se ejecutaron realmente en GitHub Actions con PostgreSQL efímero y HTTPS localhost con certificado temporal; no se conectaron a un Supabase remoto ni constituyen una URL Android pública.

Se detectaron y corrigieron dos errores de arnés: consultar `document.body` antes de terminar la recarga y usar un helper global de un perfil Chromium ya cerrado. Se conservaron las ejecuciones fallidas; sus resultados no se declararon aprobados.

La reanudación automática de la cola al recuperar conexión con sesión vigente y al validar nuevamente online se agregó en `076862b`. El recorrido de renovación/sincronización automática pasó contra API y PostgreSQL reales en la ejecución 38310952431.

## Diagnóstico de Compras

La ejecución falla en `scripts/verify-guardar-compra-ia.mjs:19`: el caso espera `null`, pero el fixture conserva un precio explícito de 150. El helper y el test son idénticos a `main`, comprobados por contenido remoto. La reproducción previa aislada confirma que quitar ese precio explícito produce null. No se modificó helper, módulo, workflow o expectativas de Compras para conseguir una marca verde. Sus pasos posteriores se omiten por el fallo y tampoco se cuentan como aprobados.

## Aislamiento y conservación

Los 27 archivos del avance de código hasta `3b31d86` pertenecen a `src/modules/mayorista/`; contenido local y blobs remotos coinciden en los 27. `main` continúa en `aca5a09cd2fe3ca66537d9d07598b6d450437241`. Los únicos cambios posteriores son dentro de Mayorista y su documentación.

Las nuevas propuestas SQL terminan en rollback y solo se aplicaron a la base efímera fija `127.0.0.1:55471/mayorista_qa` del workflow. No se aplicaron a Supabase. El adaptador actual rechaza cualquier otra base; habilitarlo comercialmente requiere implementar y revisar un adaptador para el entorno aprobado.

## Entorno y demostración

El usuario eligió Supabase para QA. La búsqueda de solo lectura encontró una organización gratuita y dos proyectos activos existentes; ninguno es Mayorista QA. No se creó ni reactivó ningún proyecto ni se cambió una base existente. Está pendiente confirmar organización, consultar costo y obtener un entorno QA persistente independiente. Un costo no autorizado impide crear el recurso.

No existe un enlace Android HTTPS operativo comprobado. El proyecto Vercel ya existente fue observado bloqueado y protegido por SSO; no se crearon proyectos, cambiaron configuraciones ni realizaron despliegues. Primero debe existir el backend QA persistente, definirse su origen y acceso Android; recién entonces se prepara una preview independiente autorizada, sin producción.

## Pendientes técnicos de aceptación

1. Adaptador Supabase QA persistente, alta/baja/recuperación de usuarios, pertenencias vigentes y aplicación real de los cinco roles mediante API y RLS. No basta el helper de permisos unitario.
2. Activación persistente por empresa, licenciamiento/permisos y proveedor del acceso Administrar. La entrada existente permanece desactivada; ningún módulo existente se utiliza para forzar activación.
3. Publicación del catálogo y asignaciones: la administración persistida de vendedores/rutas/clientes/objetivos sigue siendo planificación separada del catálogo normalizado. Completar productos, listas por cliente/zona, ofertas, objetivos y publicación transaccional con historial, sin perder pedidos históricos por reasignación.
4. Conectar las pantallas administrativas y de cargas a las API operativas, incluyendo cuentas/cobranzas/rendiciones e informes/Excel con datos reales. Las pantallas locales existentes y su exportación siguen siendo una demostración; una API probada no acredita una UI comercial completa.
5. Permisos operativos por armador y chofer, confirmación física de mercadería devuelta, ajustes/reembolsos auditados, rutas/mapa/GPS y objetivos/ofertas completos en la entrada segura.
6. Monitoreo, despliegue QA autorizado, secretos del servidor, rate limit real, respaldos persistentes y ensayo de restauración completa de base/API/dispositivos. El rate limiter del fixture de CI acepta solicitudes para las pruebas; no es un limitador comercial.
7. Dos teléfonos Android físicos, GPS real, lector concreto e impresora concreta, prueba de instalación e inicio completamente offline en el HTTPS final. Se dispone del [protocolo manual](ANDROID-PRUEBAS-REALES-20261012.md); todos esos casos siguen sin ejecutar.
8. Resolver el fallo de Compras mediante un trabajo autorizado separado o decisión de sus responsables. No fue alterado en esta rama para encubrirlo.

Estos pendientes impiden declarar finalizado el producto o pedir aprobación de publicación productiva. Work recibe este avance con evidencia y limitaciones, sin una afirmación de aceptación comercial.
