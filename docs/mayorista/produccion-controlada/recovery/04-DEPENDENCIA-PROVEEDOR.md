# Única dependencia externa pendiente

**Entregable: constancia integral de recuperabilidad de Supabase COMERCIAL `pafnbxfgpedbvpimjmun`, emitida por su custodio/proveedor y con referencias privadas verificables.** No se solicita una contraseña, token o dump en el chat. Este entregable no se cumplió en esta preparación.

## Evidencia mínima del mismo entregable

1. Identidad del proyecto, custodio y fecha UTC; plan y mecanismo efectivamente habilitados, sin inferir disponibilidad sólo del plan o la configuración. Listado real de backups/puntos recuperables, ID/tipo/estado/fecha del elegido, ventana earliest/latest cuando corresponda, retención vigente y método de acceso. Confirmar que el punto precede a la futura migración/publicación y revalidar su vigencia en esa ventana.
2. Cobertura y exclusiones firmadas: PostgreSQL canónico SIGO y Mayorista, roles/grants y passwords propias, Auth/identidades/sesiones/configuración/llaves, archivos y configuración Storage, extensiones/tareas, runtime/frontend y secretos externos. Para cada pieza omitida, referencia privada de su mecanismo adicional de recuperación.
3. Custodia independiente y acceso/descifrado comprobados; hashes de artefactos lógicos si existen o identificador/job/registro del proveedor si el backup físico no es descargable. No inventar checksum de un archivo al que nadie tuvo acceso.
4. Ensayo observado desde ese punto/backup hacia un destino de recuperación **existente y aislado**, separado de producción y QA, con origen/destino, job/horarios/logs, controles de salida y resultado. Sin crear infraestructura o generar gastos en este trabajo. Un ensayo sintético puede adjuntarse como complemento, pero no acredita restauración del backup de COMERCIAL.
5. Conciliación contra el corte y validación de seguridad/datos/Auth/Storage/runtime conforme [02-RESTORE-AISLADO-Y-VALIDACION.md](02-RESTORE-AISLADO-Y-VALIDACION.md); omisiones y fallos visibles. RPO/RTO objetivos acordados y observados medidos, con etapas/condiciones y aceptación del custodio técnico y responsable comercial.

El operador puede obtener el listado desde [Database > Backups de COMERCIAL](https://supabase.com/dashboard/project/pafnbxfgpedbvpimjmun/database/backups/scheduled) o, con su acceso privado ya previsto, mediante la ruta **GET** `/v1/projects/pafnbxfgpedbvpimjmun/database/backups`. La referencia oficial indica scope OAuth `database:read` y permiso fino `backups_read`; la respuesta documenta `backups` con `id`, `status`, `is_physical_backup`, `inserted_at`, además de configuración y ventana física. Esta ruta no está expuesta por las herramientas Supabase de esta sesión y **no fue llamada**. [Management API: List all backups](https://supabase.com/docs/reference/api/v1-list-all-backups).

No se propone emitir un PAT nuevo, extraer credenciales del conector ni usar una acción de restore para descubrir si hay backup. Una captura redactada o exportación del listado acredita metadata del proveedor; el ensayo y la conciliación siguen siendo partes distintas del entregable.

## Si el proveedor no puede completarlo dentro del alcance

Registrar causa exacta: por ejemplo, no hay backup accesible en la retención, no existe destino aislado ya disponible, falta cobertura Storage/llaves, o el proveedor sólo permite crear proyecto facturable/restaurar sobre el origen. Mantener `NO_ACREDITADO` para las partes pendientes y la condición de publicación correspondiente. No convertirlo en PASS por tener WAL/PITR configurado, un snapshot Railway, CI exitoso, un documento o un hash.

La función oficial “Restore to a new project” crea un proyecto con costos propios; habilitar PITR también es un add-on facturable. No se invocó ninguna de ellas, ni se solicitó cotización/confirmación de costo. Si ésa es la única salida, la constancia permanece incompleta y el paquete entrega la dependencia precisa para una decisión posterior. [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project), [PITR usage](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery).
