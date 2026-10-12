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

- Resultado de TypeScript y suite real en CI; regresión del build principal SIGO y diff del PR.
- Auth real en ambiente aislado, pertenencia por empresa, repositorio transaccional y RLS ejecutada.
- Cifrado integrado, revocación y recuperación en dispositivos comerciales.
- Completar administración/rendición conforme al organigrama; la administración actual es demo local.
- Dos dispositivos, GPS físico, instalación Android, modo avión y cierre/reinicio físico.
- Destino HTTPS de demo autorizado: no crear ni reactivar recursos ni quitar SSO sin aprobación.

La tarea permanece abierta. El PR se entrega como borrador, sin merge. No se promete URL operativa ni finalización mientras falten estos puntos.
