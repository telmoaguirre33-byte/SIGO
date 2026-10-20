# Recuperación de SIGO / Mayorista — PR #78

Preparación documental del 2026-10-20. Producción al iniciar: `d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`; última actualización concurrente verificada al cerrar: `aa104b572bc1af9d4b97054c702b444c693721a5` (`dpl_5wiuaSNWuATzwz4i7KsD3fg1S9V7`). Revalidar el punto de rollback al autorizar publicación. Candidato indicado: `a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b`. Supabase COMERCIAL: `pafnbxfgpedbvpimjmun`.

**Estado: recuperación del proveedor no acreditada.** No se consultaron filas comerciales, descargaron backups, restauraron bases, ejecutaron migraciones ni cambiaron servicios. No se crearon recursos, costos, commits o publicaciones. Este directorio contiene procedimientos y una plantilla de evidencia; no autoriza su ejecución futura.

## Contenido

- [Backup lógico, canal seguro y cobertura](01-BACKUP-LOGICO-Y-COBERTURA.md).
- [Restauración aislada y validación](02-RESTORE-AISLADO-Y-VALIDACION.md).
- [Recuperación de migración y deployment](03-MIGRACION-Y-DEPLOY.md).
- [Única dependencia externa: constancia integral del proveedor](04-DEPENDENCIA-PROVEEDOR.md).
- [Registro de evidencia pendiente](evidencia-recuperacion.NO-ACREDITADA.json).
- [Diagnóstico preparado de binding/ledger](diagnostico-commit.SOLO-LECTURA.sql), sin ejecución remota.
- [Fuentes oficiales y trazabilidad local](FUENTES-Y-TRAZABILIDAD.md).

## Qué puede afirmarse

| Evidencia examinada | Conclusión permitida | Límite |
| --- | --- | --- |
| Catálogo de herramientas Supabase disponible en esta sesión | No expone listado de backups, punto PITR ni restore por backup/timestamp | No demuestra que el proyecto carezca de backups |
| `restore_project(project_id)` presente en el catálogo | Existe una acción genérica de restauración de proyecto | Su firma no selecciona backup/punto; no se ejecutó ni acredita recuperación de datos |
| Documentación oficial de backups, CLI y Management API | Permite preparar el procedimiento y determinar la evidencia que falta | No acredita plan, retención, backups o permisos de COMERCIAL |
| Instalador y ensayo PostgreSQL local inspeccionados | El núcleo implementa transacción única y rechazos de ledger/binding | Una lectura de código no constituye un ensayo ejecutado ni evidencia de restauración Supabase |
| Documento histórico de cierre `EVIDENCIA-CIERRE-2519719c.json` | Declara ensayo CI para un cierre anterior | No corresponde por sí solo al SHA candidato de PR #78 ni prueba backup del proveedor |

`archive_mode=on`, un proceso de archivado, `walg_enabled=true`, `pitr_enabled=true`, persistencia de disco, un deploy `SUCCESS`, health o readiness no prueban que exista un punto recuperable utilizable. Un backup listado como `COMPLETED` acredita disponibilidad declarada por el proveedor; la restauración y conciliación acreditan que se pudo recuperar ese punto.

La copia local revisada no contiene `.git`. Las referencias de código describen esos archivos; la vinculación con el SHA candidato requiere la verificación de procedencia del paquete principal. Los documentos históricos citan otros SHA y no fueron reetiquetados como evidencia de PR #78.

## Cierre requerido

El operador debe entregar **una constancia integral** para el proyecto real con punto recuperable, cobertura y omisiones, custodia, restauración aislada observada, conciliación y RPO/RTO medidos. Su especificación está en [04-DEPENDENCIA-PROVEEDOR.md](04-DEPENDENCIA-PROVEEDOR.md). Hasta entonces, `backupDisponible`, `restoreEnsayado` y RPO/RTO permanecen sin acreditar; no se convierten en PASS por preparar este paquete. Este registro no reemplaza la Matriz oficial del piloto.
