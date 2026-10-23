# Cierre de la corrección Windows — PR #72

Fecha: 2026-10-14. Rama exclusiva: feat/mayorista-distribuidora-offline-20261012.

## Código publicado y conservación

Corrección publicada: **5c7d55d5a272b3177bb8971f09cb4b7cf07fae7f**, padre directo **9466620ebe22370ef42fb4bca72fe69c95679e2d**. Recupera la corrección e8d305c, conservando buscador, frecuentes, lector y pruebas de los commits nuevos. Ocho archivos Mayorista: launcher Windows sin shell, diagnóstico seguro, bundle público QA con verificación X509, verificador externo login-only, dos suites, actualización del script security y guía. No se modificó SIGO Minorista, main, producción ni se hizo merge.

El segundo commit solo corrige una referencia documental rechazada por el verificador general y registra esta evidencia. No cambia el código UX ni el verificador de SIGO.

## Pruebas realmente ejecutadas

- Local actual: 17 casos aprobados (CLI 6, verificación 6, provisión 5) y sintaxis de tres scripts. Las respuestas HTTP de estas suites son simuladas; no certifican login en Railway.
- [CI Mayorista 38575286216](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38575286216), código 5c7d55d: **SUCCESS**. TypeScript, build, pruebas Node, 7 controles RLS PostgreSQL 17 efímero, **81 controles API/PostgreSQL**, **53 pruebas Chromium/IndexedDB**, Docker y runtime bloqueado por defecto. Los grupos contienen casos solapados; no sumar como verificaciones independientes.
- Compras conserva el error externo `150 !== null`, existente también en 9466620. No se modifica su módulo, pruebas ni workflow.
- Build SIGO 38575286058 falló en el control de referencias por la documentación UX nueva; el mismo fallo existía en 9466620. Se corrigió exclusivamente su frase documental y se dejó el control original intacto. Verificar el resultado de CI posterior; no declarar ese nuevo resultado aprobado por anticipado.
- Railway API confirmado **live/SUCCESS**, deployment c888f2f2-20d9-45a5-9d56-0657965edf65, runtime f996b7e. Publicar el instalador no cambia automáticamente el runtime QA ni representa un despliegue productivo.

## HTTPS aprobado por el operador

Origen: https://mayorista-api-qa-qa.up.railway.app

**/health aprobado externamente desde Android**, respuesta informada por el operador `{"status":"ok","module":"mayorista"}`. No se volvió a ejecutar esa prueba. App: /secure.html; administración/cargas: /portal.html.

## Comprobaciones externas pendientes

El ejecutor fue reemplazado y no conserva credenciales privadas de instalación. El proxy rechaza la conexión (HTTP 000). No se reseteó bootstrap ni se pidieron contraseñas por chat. Usar una cuenta QA existente y un archivo privado recuperado de forma segura.

```powershell
node src/modules/mayorista/railway/verify-existing-qa.mjs --login-only --credentials "C:\QA-Privado\credenciales-qa.json"
```

Archivo fuera de Git: origin exacto QA, empresaId, email y password de gerencia QA. En Linux/macOS permisos 0600; en Windows acceso solo al propietario. El comando omite health, no requiere Railway CLI, no migra ni crea usuarios y no imprime contraseñas/tokens.

1. Login, /me, catálogo y logout 200; acceso anónimo y token revocado 401. /me debe devolver empresa, gerencia y permiso admin:gestionar correctos.
2. Login con los cinco roles QA; verificar empresa/rol/asignaciones. GET /admin/state: gerencia y administración 200; vendedor, armador y chofer 403. GET /catalog y /accounts con armador/chofer 403. GET /operations/loads solo devuelve cargas asignadas, sin importes para armadores.
3. Dos empresas QA A/B: login del vendedor A contra B 403; usuario A no lee/modifica datos B. Comando sobre carga ajena rechazado 403/404. Registrar UUID/estado HTTP sin tokens ni información privada.
4. Catálogo/visita/pedido ficticios contra QA persistente. Repetir UUID en paralelo y tras pérdida de acuse: una recepción. Mismo UUID con contenido distinto: 409. Reabrir sesión y confirmar persistencia.
5. Aprobar, asignar camión/ruta/armador/chofer, preparar/picking, verificar, despachar, entregar/devolver, cobrar/rendir, revisar y cerrar. Reintentos no duplican; chofer no inicia picking ni revisa su rendición; armador no cobra/toma pedidos. Comprobar importes, inventario Mayorista e historial.
6. Cambiar/revocar membresía de un usuario QA de prueba y verificar permisos de su token vigente. No utilizar cuentas productivas.
7. Verificar respaldo/restauración persistente y presupuesto operativo. No apuntar fixtures CI que crean/modifican esquema a Railway.

Estas pruebas no fueron aprobadas en Railway por este ejecutor. El PostgreSQL efímero de CI no sustituye QA persistente.

## Checklist físico posterior

Seguir [guía exacta de Android y dispositivos](CIERRE-TECNICO-QA-20261013.md#checklist-físico-con-el-operador): instalación S negra/nombre SIGO Vendedor; catálogo descargado, modo avión, pedidos/visitas, cierre forzoso/reapertura y sincronización sin duplicados; dos Android; GPS permitido/denegado/offline; lector conocido/desconocido/repetido; hoja de carga/reparto en impresora real; entregas/devoluciones/cobros/rendiciones.

Antes de desinstalar, respaldar/sincronizar pedidos. Registrar modelo, Android/Chrome, fecha, UUID y resultado. Las pruebas físicas quedan separadas y no impiden publicar esta corrección. No se certifica comercialización ni se afirma que únicamente reste hardware.
