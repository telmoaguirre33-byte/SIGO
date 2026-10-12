# Tarea GitHub #71 — desarrollo abierto, sin merge ni producción

Base: `0d909f9435b24e7933f8ba235e481ee8d7776403`.
Rama: `feat/mayorista-distribuidora-offline-20261012`.

## Acceso desde Administrar

Se agregó un import y una llamada al componente nuevo en `ModulosControlPanel.tsx`, dentro del tablero administrativo. Todo el código anterior del archivo se conserva; una prueba estática comprueba su SHA256 después de quitar únicamente esas dos incorporaciones. No se modifican presets, RPC existentes, permisos, contadores, ventas, stock ni facturación.

`integration/MayoristaAdministrarAccess.tsx` muestra el botón **Mayorista / Distribuidora** desactivado. Su clave `mayorista_distribuidora` es distinta del preset legacy `mayorista`, que sigue siendo portal cliente. El componente admite un proveedor de configuración por empresa; **la llamada real todavía no inyecta proveedor** y no hace solicitudes adicionales.

Para habilitar se requiere configuración del mismo tenant, flag booleano true, aplicación disponible, rol owner/admin y destinos HTTPS de un origen aprobado. No se transfieren tokens de SIGO en URLs. Desactivar el flag retira los accesos; la aplicación destino debe volver a autenticar y autorizar al usuario. La configuración UI nunca sustituye RLS ni permisos de servidor.

La integración completa sigue pendiente de una API real de configuración, identidad Mayorista y destinos accesibles autorizados. No se habilitó empresa alguna.

## PWA Android

El manifest usa ahora PNG de 192 y 512 píxeles, reutilizados sin modificar los iconos oficiales ya existentes en el repositorio. Se verifican firma PNG y dimensiones de ambos archivos, alcance del manifest y cache propio del service worker. No se generó APK. HTTPS accesible e instalación física siguen pendientes: el proyecto existente está pausado y no fue reactivado.

## Pruebas y CI aislado

Se agregaron 13 pruebas unitarias de la política de acceso, separación de empresa/rol, URLs, rollback, conservación del código legacy y manifest/iconos. Localmente: 13 aprobadas, 0 fallidas, y generación aislada de 6 módulos TS correcta. Esto no equivale a render React, TypeScript o prueba Android.

La ejecución local del navegador sigue bloqueada por `listen EPERM`; el proxy no responde al intentar acceder al registro npm. No se solicitaron permisos que dejen una espera indefinida ni se eludieron restricciones.

El workflow nuevo `mayorista-isolated.yml` corre en PR con un runner estándar Ubuntu del repositorio público, sin secretos, sin token persistente de checkout, sin acceso a Supabase/Vercel y sin despliegues. Instala herramientas aisladas con scripts de instalación deshabilitados, chequea TypeScript, genera la demo y ejecuta unitarias y Chromium real. Guarda evidencia y lockfile de esa ejecución como artifact. Los resultados deben leerse después de ejecutarse; preparar YAML no acredita pruebas aprobadas.

Se corrigieron las rutas absolutas del ejecutor de navegador para que su evidencia se escriba en `tests/artifacts/` dentro del checkout, y se permite elegir Chrome mediante `CHROMIUM_PATH`. No se cambia el comportamiento de las pruebas para declarar éxitos falsos.

## Pendientes de cierre

- Regresión adicional de Compras pendiente por un fallo fuera del módulo; TypeScript, build SIGO y suite real Mayorista ya aprobaron en CI (ver evidencia).
- Auth real en ambiente aislado, pertenencia por empresa, repositorio transaccional y RLS ejecutada.
- Cifrado integrado, revocación y recuperación en dispositivos comerciales.
- Conectar administración/rendiciones a persistencia autenticada conforme al organigrama; la administración actual y las rendiciones nuevas son demo local.
- Dos dispositivos, GPS físico, instalación Android, modo avión y cierre/reinicio físico.
- Destino HTTPS de demo autorizado: no crear ni reactivar recursos ni quitar SSO sin aprobación.

La tarea permanece abierta. El PR se entrega como borrador, sin merge. No se promete URL operativa ni finalización mientras falten estos puntos.


## Evidencia posterior de CI

PR borrador: https://github.com/telmoaguirre33-byte/SIGO/pull/72

Commit de código verificado: `cc9543f4a87666246aafda922c42ff649613b483`.
Workflow Mayorista: https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38285568991

- TypeScript aislado: aprobado.
- Generación aislada: aprobada.
- 77 pruebas unitarias: 17 base + 18 seguridad + 7 administración + 8 recuperación + 13 acceso/PWA + 8 HTTP/auth + 6 rendiciones.
- 23 ensayos aprobados en Chromium real: 100 pedidos, identidades locales separadas, UUID y contenido estable, cierre/reapertura, borradores/visitas, recarga offline, reintentos, dos pestañas, cierre durante envío, conflictos, transacción abortada y guardado desde UI.
- 7 controles RLS aprobados sobre PostgreSQL 17 efímero local: vendedor/empresa, recepción propia, rechazo de otra empresa, unicidad, rechazo de escalamiento de rol, administración por empresa y revocación.
- El schema propuesto se aplicó únicamente dentro de una transacción rollback del contenedor CI. `auth.uid/auth.jwt` se simularon para probar RLS; no es una prueba de JWT/Supabase real.
- Build SIGO y `verify:critical`: workflow aprobado, https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38285569012
- El workflow adicional de Compras sigue fallando: `verify-guardar-compra-ia.mjs`, comparación `150 !== null`, https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38285569034 . No se cambió ese script ni sus funciones de negocio. No declarar todos los checks del PR aprobados.

Artifact con capturas, resultados JSON, evidencia RLS y lockfile:
https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38285568991/artifacts/11763187129

SHA256 del ZIP: `b1586c8562a96e124e16295feda1c1f8860dc9793933b46a903295fcab091fd1`.
Expiración informada del artifact: 2026-10-19. Los logs del workflow y este informe conservan la referencia a la ejecución. El lockfile generado se recuperó del log público del mismo job y se incorpora para usar `npm ci` reproducible.

## Límites de los nuevos componentes

`api/test-project-auth.mjs` consulta `auth/v1/user` del proyecto de prueba aprobado y exige comprobar sesión activa y membresía vigente mediante adaptadores. Está desactivado y no tiene URL/ref/clave reales configuradas. Las ocho pruebas HTTP/auth usan un fetch simulado y tokens ficticios; no acreditan login real.

`api/http-handler.mjs` prepara POST JSON, origen HTTPS exacto, bearer, rate limiter obligatorio, límite de cuerpo 256 KiB, errores sin datos internos y no-store. No está montado en SIGO ni publicado. Sigue pendiente el repositorio transaccional real y la conexión UI/API/configuración por empresa en un ambiente autorizado.

Las rendiciones guardan registros demo con centavos, validación de vendedor/empresa y revisión administrativa local. No registran cobros en SIGO, ni alteran cuentas corrientes, ventas, stock o facturación. La pantalla de administración conserva la etiqueta de demo; su actor administrativo es ficticio.

Diff completo del PR inspeccionado: 58 archivos a esta etapa. Fuera de Mayorista solo están el workflow aislado nuevo y cuatro líneas agregadas a ModulosControlPanel. El preset y todo el código administrativo anterior mantienen el hash verificado. No se modificó main ni se realizó merge.

## Estado de entrega

No hay enlace HTTPS Android operativo verificado. La demo existente sigue pausada; no se creó proyecto ni se reactivó hosting o se quitó SSO. El acceso/costo del scope y la activación de una preview del proyecto existente requieren autorización. No se ofrece un enlace a localhost o un artifact como si fuera la app instalada.

La guía Android existente sigue vigente para GPS, instalación, modo avión y cierre físico. Chromium headless no demuestra esos ensayos físicos ni dos dispositivos. La tarea #71 permanece abierta y el PR sigue en borrador.
