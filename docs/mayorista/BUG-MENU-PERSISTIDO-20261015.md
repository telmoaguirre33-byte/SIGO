# Menú Mayorista con flag persistido — PR #72

## Causa comprobada

Lectura sin modificaciones de la fuente SIGO: `lapizcito5` (`8728d172-7c1b-4de3-88ae-c20fc19c1fce`) está activa, tiene `sigo_empresa_modulos.habilitado=true` para `mayorista_distribuidora` y membresías activas `owner/admin`. Matriz consulta ese flag mediante `matriz_listar_mayorista_modulos_sigo`.

El launcher exigía `obtener_acceso_mayorista_sigo` y un destino disponible para mostrar el menú. La fuente real no tiene esa función ni las tablas propuestas de tipo/destinos. El catch silencioso convertía su ausencia en módulo oculto. Además, el launcher insertaba accesos solamente en la barra lateral/contexto, mientras el menú móvil real usa un drawer distinto.

## Corrección

- Launcher y Administración consultan `listar_modulos_empresa_sigo`, que lee el mismo flag y exige membresía autenticada del usuario. No se infiere habilitación desde licencia, tipo ni destinos.
- Se mantiene la separación entre módulo habilitado y conexión operativa disponible. Un destino ausente no oculta los accesos: cada ruta informa la conexión pendiente. Un destino válido abre el mismo workspace operativo implementado; no se agregan pantallas de demostración ni otro backend.
- Los diez accesos aparecen también dentro del drawer móvil real. Abrir una página cierra el drawer. Al volver a la sesión se refresca el flag; deshabilitar retira ambos menús y no borra datos.
- Solo `owner/admin` acceden a estas páginas administrativas. Los perfiles operativos mantienen permisos de servidor existentes. No se modifica el menú ni los permisos Minoristas.

## Regresión

La prueba Chromium usa el componente `MobileOperationsMenu` real, el launcher real, `tenant` real y las funciones SQL canónicas de listado de módulos y Matriz. El transporte Auth es el fixture aislado de CI; no hay credenciales de clientes.

Reproduce: flag activo por Matriz, administrador con nombre de escenario `lapizcito5 · fixture aislado`, RPC de destinos ausente (PGRST202), diez accesos visibles, navegación desde drawer a 390 × 844, diagnóstico por cada ruta y desactivación sin pérdida de datos. Conserva los casos Minorista, Mayorista con conexión, Mixto y override. Los controles unitarios cubren permisos, flag desactivado, error de lectura y destino de otra empresa.

No se acredita una sesión Supabase externa real del administrador: la observación real es SQL de solo lectura y la reproducción UI es aislada. La validación Android de `lapizcito5` debe hacerse en el nuevo Preview. Que el menú reconozca el flag no instala las funciones de conexión faltantes en la fuente compartida; ese bloqueo operativo queda visible y no se modifica producción para ocultarlo.

No migraciones, cambios Railway, producción, main ni merge en esta corrección. TypeScript, builds, PostgreSQL/Chromium y Preview deben consultarse en los checks del HEAD final de PR #72.
