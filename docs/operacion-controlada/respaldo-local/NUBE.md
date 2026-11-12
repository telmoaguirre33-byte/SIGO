# SIGO #122 — operador privado mediante Actions

La reparación sigue en PR #122, sin cambios de código de aplicación. Esta rama operativa usa el GitHub Actions estándar Ubuntu del mismo repositorio público: no contrata servicios, crea proyectos, inicia sandboxes Vercel ni usa runners grandes/pagos. No requiere computadora o terminal del propietario.

## Lo comprobado

- Conexión real a COMERCIAL desde Actions: TLS `verify-full`, identidad de proyecto/usuario y transacción READ ONLY comprobadas. Se reutiliza la credencial existente del repositorio, sin devolverla a Codex ni cambiarla.
- La CA de Supabase se obtuvo de la URL pública que utiliza el dashboard oficial: `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`. Su SHA-256 de archivo es `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`; fingerprint X509 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, vigente hasta 2031. Se agrega al trust store del cliente sin omitir hostname/cadena.
- La imagen exacta `supabase/postgres:17.6.1.166` se pudo descargar y ejecutar en Actions. Captura/cifrado/restore y los dos SQL exactos pasaron sobre datos sintéticos con las extensiones usadas por el proyecto.
- La prueba en copia verifica owner/admin/seller/warehouse, empresa ajena con datos, deny explícito, no miembro, máscaras de costos/precio/stock y rollback de las transacciones locales. Después compara todas las filas originales. No publica identidades, nombres ni importes del catálogo.
- Se verificó también localmente que la clave privada conservada en el entorno puede descifrar una frase sintética protegida con la clave pública destinataria. La clave privada no fue transferida a Vercel/GitHub.

Evidencia: [conexión real y destino pendiente](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/43283755166), [imagen/restore/SQL/roles sintéticos](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/43283760929). No equivalen a un respaldo comercial recuperado.

## Única configuración pendiente desde móvil

En [New repository secret](https://github.com/telmoaguirre33-byte/SIGO/settings/secrets/actions/new):

- **Name:** `SIGO_BACKUP_STORAGE_KEY`.
- **Secret:** valor existente de `service_role` de **COMERCIAL**, desde [Supabase → Settings → API Keys → Legacy API Keys](https://supabase.com/dashboard/project/pafnbxfgpedbvpimjmun/settings/api). No anon/publishable, no contraseña de PostgreSQL, no clave de otra aplicación. No crear ni rotar claves.
- Guardar solamente en el formulario privado; confirmar “guardado” sin enviar el valor.

El token de cuenta anterior devuelve HTTP 401 y no es utilizable; no se modifica ese secreto para evitar efectos sobre otros workflows. No se vuelve a solicitar una URL DB: la conexión PostgreSQL ya funciona.

El valor nuevo sólo se proporciona al paso privado del operador. El job de ensayo sintético no recibe credenciales productivas. La integración no puede administrar secretos del repositorio y no intenta sortear ese permiso.

## Operación del controlador

El workflow existente `.github/workflows/supabase-production.yml` se reemplaza **sólo en esta rama**, con `workflow_dispatch` manual y guardas de repositorio/ref. La definición de main sigue intacta.

```bash
gh workflow run supabase-production.yml --repo telmoaguirre33-byte/SIGO --ref ops/122-respaldo-local -f action=prepare
gh workflow run supabase-production.yml --repo telmoaguirre33-byte/SIGO --ref ops/122-respaldo-local -f action=capture
```

`prepare` sólo comprueba conexión y metadatos del destino privado. `exercise` ejecuta el ensayo sintético sin credenciales. `capture` se bloquea antes de leer tablas comerciales si los requisitos privados no están aprobados.

## Persistencia y restauración

1. Usar snapshot exportado READ ONLY, `pg_dump` custom y roles sin contraseñas, reutilizando `respaldo.py`. Se conserva el alcance/limitaciones de [LEEME](./LEEME.md).
2. Generar una frase aleatoria independiente para cifrar; la frase se protege además con la clave pública destinataria. No poner frases, URI, claves o archivos en logs, commits, artifacts ni cachés de Actions.
3. Antes de restaurar, conservar el archive cifrado y la frase envuelta en el **bucket privado ya existente** del mismo proyecto, bajo `_sigo_operaciones_respaldo_122/<run-attempt-nonce>/`. No se crean buckets, cambian límites/policies ni se sobrescriben certificados u objetos existentes. Se trata de objetos operativos nuevos, no de cambios comerciales/SQL productivo.
4. Respetar MIME y tamaño existentes; usar fragmentos de ciphertext (o envolturas JSON de ciphertext si el bucket sólo permite JSON). Reintentos acotados, sin upsert, y lectura/SHA-256 posterior de cada objeto. La frase envuelta se conserva antes del archivo mayor. El índice permite recomponer exactamente ambos archivos; sólo una copia completa verificada habilita el gate.
5. El archivo cifrado continúa en Storage después de finalizar el runner. La clave privada destinataria queda separada, en almacenamiento privado del entorno Codex, fuera de repositorios y del runner. Su fingerprint público está fijado en el código. No prometer otra custodia o retención de clave distinta de la efectivamente disponible.
6. Descifrar/verificar ese mismo contenido y restaurar en un contenedor nuevo sin red/puertos, sin montar credenciales de origen. Comparar datos, esquema/funciones/ACL, roles/membresías, RLS, extensiones, large objects y secuencias.
7. Aplicar los dos candidatos exactos únicamente en esa copia, con sus hashes/guardas y pruebas de roles. Las alteraciones temporales de permisos para las pruebas se revierten y se comparan nuevamente todas las filas. El contenedor/volumen de copia se elimina al terminar.
8. Conservar `verified-report.json` en el mismo prefijo privado y emitir únicamente estado/hashes/tiempos técnicos sin filas ni secretos. Si hay error, no afirmar que el backup está recuperado. No subir un artifact para solucionar errores de Storage.

Para recuperar posteriormente, un operador autorizado obtiene del prefijo privado `encrypted-index.json`, todos los fragmentos y la frase envuelta; valida hashes, recompone los `.gpg`, descifra la frase con la clave privada separada y usa `respaldo.py verificar` sobre el archive. Debe obtener los archivos antes de iniciar cualquier recuperación integral de la base. No se restaura una base completa sobre ventas nuevas; preferir recuperación web/RPC compatible para esta incidencia.

Esto respalda PostgreSQL, no todos los servicios Supabase: objetos físicos previos de Storage, passwords LOGIN y secretos/configuración externos requieren su cobertura propia. El bucket no se vuelve público. Sólo se escriben objetos nuevos del respaldo cifrado cuando se ejecuta capture; prepare/exercise no escriben producción.

## Publicación

Todavía no se capturó/verificó un archive real. Cuando pase: revisar el informe real y el alcance minorista, confirmar hashes/versión/recuperación y solicitar autorización específica de los SQL y despliegue. Orden DB verificada → aplicación compatible → comprobación del cliente sin ventas/CAE de prueba. No aplicar SQL, RLS ni publicar mediante este workflow. No cerrar #121 antes de verificar el cliente.
