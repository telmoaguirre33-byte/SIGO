# Restauración aislada y validación

Preparado, no ejecutado. El destino de un ensayo con datos reales es un entorno de recuperación **existente**, privado, separado de producción y de QA. No importar dumps en MAYORISTA-QA, `xcapcnczxljxwxzigtvs`, namespaces P0, previews compartidas o teléfonos de vendedores. Un namespace diferente dentro de la base activa no constituye aislamiento completo de Supabase/Auth/Storage.

## Preparación del destino

1. El custodio identifica proyecto/host/base/rol exactos y comprueba por dos vías que no son `pafnbxfgpedbvpimjmun`, producción ni QA. Registra capacidad existente, región, versiones y permisos de restore, sin crear proyecto/branch/volumen ni habilitar un add-on. Si no hay destino existente adecuado o el proveedor sólo ofrece restore sobre origen/nuevo proyecto con costos, esta etapa queda pendiente de la dependencia externa.
2. Antes de cargar datos o arrancar procesos, cerrar acceso público y salida externa del entorno. Deshabilitar correo/SMS, ARCA, cobros, webhooks, cron, `pg_net`, wrappers y consumidores de colas; revisar funciones/triggers que puedan emitir efectos al restaurar o iniciar. No permitir sesiones/dispositivos productivos sobre la copia. Mantener las identidades reales copiadas en cuarentena. Los controles de salida deben existir antes de la copia; apagar tareas después no evita una ejecución inicial.
3. Comparar versiones PostgreSQL/Auth/Storage, extensiones disponibles, collations y permisos administrados. No reemplazar objetos administrados de `auth`, `storage` o `realtime` con los fixtures CI. No reutilizar llaves/issuer de producción para autenticar pruebas en otro destino.
4. Recuperar artefactos por el canal privado, comprobar acceso independiente, descifrado y checksums antes de abrirlos. Registrar tiempos UTC de recuperación, lectura, restore, validación y decisión de reabrir.

Supabase documenta que “Restore to a new project” crea otro proyecto facturable y copia principalmente la base, con componentes que requieren reconfiguración. No se usa esa función dentro de este alcance. [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project).

## Ejecución futura del ensayo

**Vía del proveedor:** seleccionar un backup existente o timestamp efectivamente recuperable del proyecto COMERCIAL; registrar job, origen, destino y punto de corte. La operación sólo es admisible en el destino aislado ya previsto por el custodio. No usar `restore_project` genérico como sustituto de elegir un backup ni restaurar sobre producción para conseguir evidencia.

**Vía lógica adicional:** revisar el catálogo y SQL completo en privado; clasificar objetos propios frente a administrados, owners, roles propios, grants/default privileges, RLS, extensiones y datos de Auth. Construir el orden/selección de restore específico del destino. Un restore crudo de todos los internals Supabase puede fallar o interferir con servicios; no se entrega aquí un comando universal de importación. La guía oficial usa roles → esquema → datos y requiere revisar compatibilidad, triggers y privilegios en el destino. [Backup and Restore using CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

Para un destino que permita `pg_restore`, la operación aprobada debe fijar servicio de destino explícito, lista de objetos revisada, `--exit-on-error` y política transaccional apropiada; para SQL usar `psql -X` con `ON_ERROR_STOP=1`. No aplicar `--clean`, `--create`, `CASCADE`, importaciones parciales, `--no-owner`, `--no-acl`, bypass o desactivación general de triggers como remedio automático. Reconciliar los privilegios por defecto del destino antes y después: pueden ampliar permisos aun si el dump contenía ACL restringidas. Cada excepción necesita justificación y evidencia; un exit code cero no basta.

Las passwords de roles propios se recuperan/rotan por el mecanismo privado previsto y se actualizan en el servicio de recuperación. No imprimirlas en SQL de evidencia. Auth debe reconfigurarse según el destino y comprobar rechazo de tokens productivos en la copia; recuperar `auth.users` no garantiza continuidad de sesiones ni configuración OAuth/SMTP/URLs. [Restore platform to self-hosted: cobertura y Auth](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

Storage requiere recuperar por separado sus bytes y configuración, y conciliar referencias, tamaños y checksum de contenido. No adjudicar al restore de PostgreSQL la recuperación de archivos ausentes.

## Binding y runtime en otro destino

Un backup puede contener `mayorista_private.release_binding` del origen. El runtime exige que ese binding coincida con perfil/proyecto/entorno; copiarlo no autoriza un nuevo destino. No falsificar variables `RAILWAY_*`, reutilizar perfil productivo, reescribir hashes o ejecutar instalación para ocultar ese rechazo. La validación de base puede realizarse con el servicio apagado. Una prueba funcional en destino distinto necesita un procedimiento de recuperación de binding/perfil revisado y compatible; el candidato inspeccionado no aporta una utilidad genérica de reubicación. Si no está resuelto, declarar esa parte pendiente y no informar RTO de aplicación.

## Validación requerida y criterio de aceptación

| Control | Evidencia privada y resultado exigido |
| --- | --- |
| Identidad y corte | Ref/host/base origen y destino; backup/job o archive hash; UTC y punto recuperado; correspondencia con snapshot de referencia |
| Integridad física/lógica | Código de salida, logs revisados, cero errores sin explicar; catálogo completo, tablas/particiones/constraints/índices y extensiones conciliados; secuencias compatibles con claves existentes sin retroceder valores consumidos |
| Seguridad | Owners, grants/default privileges y membresías; policies y RLS; funciones privilegiadas/search_path; runtime efectivo sin SUPERUSER/BYPASSRLS ni membresías privilegiadas |
| Estado de release | Binding original documentado; 21 versiones/hashes correspondientes al rol y paquete aprobado si ya estaban instaladas; si el corte es anterior, ausencia esperada documentada |
| Auth y Storage | Cobertura real de identidades/sesiones y configuración; rechazo de credenciales incorrectas/expiradas/revocadas; referencias y checksum de archivos conciliados |
| Operaciones canónicas | Cantidades, UUID/versiones/estados, líneas/importes de pedidos/entregas/ventas; stock/presentaciones; caja por medio; deuda/cobranzas/rendiciones; devoluciones/notas de crédito y auditoría contra el mismo corte |
| Funcionalidad | Health/readiness de imagen compatible y perfil propio; cinco roles, empresa ajena, catálogo/pedido/reporte; idempotencia de UUID y rechazo de UUID con contenido diferente |
| Continuidad | Regresión Minorista, pendientes locales preservados y plan de conciliación posterior al corte |

Los controles sobre datos reales los ejecuta el custodio en el entorno privado. Este paquete no solicita ni contiene esos datos. Comparar contra una huella privada obtenida del mismo snapshot o durante una ventana quiescente documentada; un `count(*)` actual de producción puede haber cambiado y no demuestra diferencia respecto del backup. Una huella de filas sin protección también puede revelar datos: custodiarla junto al backup.

Usar cuentas de ensayo ya autorizadas y aisladas para pruebas funcionales, nunca credenciales de clientes reales, los dos pedidos Android ni SQL que reconstruya `auth.users/auth.sessions`. Si no existe un flujo de Auth de ensayo válido, dejar la etapa funcional pendiente. Los ensayos sintéticos independientes prueban comportamiento, pero no sustituyen la conciliación de lo restaurado ni la recuperación de identidades reales.

## RPO/RTO sin cifras inventadas

- Acordar antes del ensayo los objetivos de negocio, responsable y retención; quedan sin valor hasta acuerdo documentado.
- Registrar último commit de referencia y último commit efectivamente recuperado, no sólo fecha de un archivo. RPO observado = diferencia temporal entre esos dos puntos; enumerar operaciones del intervalo y componentes no cubiertos. Si sólo hay timestamps de creación de filas o de archivos sin prueba de commits/corte, dejar la medida pendiente o declarar su precisión limitada. La granularidad PITR no implica automáticamente ese RPO.
- Registrar tiempo de decisión/acceso/descifrado/restore/validación y, sólo si se ensayó, recuperación de runtime y reapertura. El RTO aislado medido no garantiza el RTO productivo: indicar etapas omitidas, volumen, herramientas y condiciones.
- Cerrar con veredicto por cobertura, conciliación, límites, aceptación técnica/comercial y evidencia privada. Luego conservar o eliminar la copia según la retención autorizada, sin borrar el último backup recuperable.
