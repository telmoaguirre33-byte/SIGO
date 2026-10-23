# Mayorista QA: configuración, puente administrativo y evidencia
Fecha: 2026-10-13. Rama feat/mayorista-distribuidora-offline-20261012, PR #72. Continuación de 902bdc3, sin reconstruir funcionalidades existentes.

## Acciones ejecutadas
- PostgreSQL QA confirmado SUCCESS: proyecto b9a7da94-1d87-46fe-b4da-c7e241ebe185, entorno qa 2addc3e9-f088-42df-a72c-c233fd4308cb, base 9120b029-d20c-4073-a9cc-003953f60817. Una instancia y un volumen, sin proxies ni nuevas bases.
- API existente 9053689a-0e32-4f3c-b5da-3c01e480a9c6: raíz de build /, Dockerfile src/modules/mayorista/backend/Dockerfile, arranque absoluto /app/src/modules/mayorista/backend/server.mjs, healthcheck /health y tres reintentos.
- Se configuró DATABASE_URL mediante referencia privada al servicio Postgres, identificador de la base, presupuesto 15, origen QA y puerto 8080. No se leyó ni publicó la contraseña.
- Dominio del servicio existente: https://mayorista-api-qa-qa.up.railway.app. Que el dominio exista no acredita disponibilidad de la API.
- Predeploy preparado: prepare-or-check-qa.mjs. Comprueba el marcador de proyecto/entorno, evita reinstalar sobre una base instalada, exige autorización explícita para instalación inicial y deja al instalador transaccional rechazar bases ajenas/no vacías.
- Diagnóstico de arranque/predeploy con nombres de variables faltantes y códigos públicos. Nunca vuelca errores crudos, DSN, clave privada o filas.
- Bootstrap permite UUID públicos explícitos y conserva el generador aleatorio por defecto.
- Puente CLI obtiene exclusivamente root.crt/server.crt por SSH administrativo, verifica firma de CA/cadena/hostname/vigencia, usa stdin para secretos y conserva credenciales iniciales en archivo privado local fuera del repositorio.
- Se verificó el formato de comandos y JSON de Railway CLI v5.23.3 contra su fuente oficial. El conector OAuth no expone SSH/SQL ni valores secretos.

No se cambiaron los límites de recursos: el intento quedó interrumpido y el read-back no confirmó aplicación. API conserva CPU 0.25 y memoria 500 MB. PostgreSQL conserva límites de plataforma; el consumo observado fue aproximadamente 73 MB y 0.0002 CPU. Estos datos no garantizan un tope de facturación. No se modificó el límite compartido del workspace ni se activó MAYORISTA_BUDGET_VERIFIED desde el conector.

## Código y pruebas
- c8a9651: arranque, diagnóstico, instalador verificable y puente CLI.
- f996b7e: formato CLI real y diagnóstico de predeploy.
- [CI final f996b7e](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38379129882) y [Build SIGO final](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38379129902) aprobados.
- [CI c8a9651](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38377788194) aprobado.
- [Build SIGO c8a9651](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/38377788162) aprobado.
- CI ejecutó 15 controles nuevos: diagnóstico sin secretos, UUID, certificados X509, presupuesto, secretos por stdin, preservación de bootstrap y predeploy idempotente/rechazo de base ajena. La orquestación CLI se prueba con comandos/HTTP simulados; no se presenta como ejecución real de ese comando.
- También pasaron los controles existentes: 81 API/PostgreSQL efímero, 45 Chromium/IndexedDB, TypeScript, compilación e imagen Docker.
- Railway compiló realmente la imagen c8a9651, incluyendo tsc y build: despliegue 5f2eda85-839a-4375-929f-73625196bf1c, digest sha256:b20e5d719d5fd8c8cd0103a9e76f2bfa1d5243833d697f4545811734aac5700c. Falló posteriormente en PRE_DEPLOY_COMMAND con MAYORISTA_QA_SCHEMA_BLOCKED; no está ONLINE.
- El archivo raíz railway.toml pertenece a otro servicio. Se inspeccionó para distinguir configuraciones; no se modificó. El nuevo log demuestra uso del Dockerfile Mayorista. Seleccionar un archivo legacy alternativo mediante MCP fue rechazado por deprecación; no se hizo esa migración.
- Compras conserva su fallo anterior, sin cambios en ese módulo/workflow.

## Única acción manual para destrabar
Desde una copia actualizada de esta rama en tu equipo, ejecutar:
```bash
npx --yes --package=@railway/cli@5.23.3 node src/modules/mayorista/railway/provision-qa-cli.mjs --budget-confirmed
```
Requiere Node 20 o superior. Usar --budget-confirmed únicamente si el costo total QA queda dentro del máximo autorizado US$15/mes; el flag confirma esa revisión, no configura un límite de cobro en Railway. Si hace falta OAuth, el mismo comando abre el login de Railway en tu equipo. No enviar contraseñas/tokens/claves por chat.

El comando enlaza una carpeta temporal exclusivamente al proyecto QA, obtiene certificados públicos, crea secretos de servidor y usuario de gerencia ficticio QA, configura variables sin exponerlas en argv, dispara el despliegue existente y espera SUCCESS. Después comprueba HTTPS, health, manifest, cuatro PNG, login, rol/empresa, catálogo administrativo y logout. Retira el password bootstrap del servicio y desactiva la autorización de instalación inicial tras la verificación exitosa. No crea proyectos, bases, servicios, réplicas ni proxies.

Conservar el archivo privado de credenciales generado; el programa solo informa su ruta. No compartirlo ni incluirlo en Git. Si hay un bootstrap previo, aborta antes de modificar usuarios; no repetir para forzar un resultado. Ante error conserva el archivo para recuperar la misma identidad.

## Estado y pruebas pendientes
El entorno de ejecución de Codex falló al iniciar; los conectores permitieron conservar y probar código mediante GitHub Actions. Aún no se ejecutó el puente CLI contra Railway, no se aplicaron las migraciones QA y no se verificó TLS PostgreSQL real. No hay credenciales de gerencia entregadas ni acceso operativo certificado.

Una vez ONLINE, las entradas previstas son /secure.html para SIGO Vendedor (S negra sobre blanco) y /portal.html para administración/armador/chofer. El runtime comparte el origen entre shell y API; no necesita usar el origen protegido de Vercel para WebAPK. No declarar instalación Android física por validar únicamente manifest/PNG.

Faltan pruebas integrales contra QA persistente, aislamiento con dos empresas reales de prueba, dos teléfonos Android, GPS/lector/impresora físicos y restauración de respaldo. La comercialización sigue pendiente de esas aceptaciones. No hubo merge ni cambios productivos.
