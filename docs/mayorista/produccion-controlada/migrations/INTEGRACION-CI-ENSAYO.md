# Integración mínima del ensayo preparado

Fuente de aplicación/exports: PR78 `a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b`. Los archivos nuevos deben quedar bajo el commit único de preparación que coordina root. No se hizo commit ni push desde esta subrevisión.

Copiar al checkout revisado:

- `production-schema-fixture.mjs`, `production-schema-fixture-unit.mjs` y `production-schema-compatibility-postgres.mjs` → `src/modules/mayorista/tests/`.
- `production-schema.fixture.json` → `src/modules/mayorista/tests/fixtures/production-schema.fixture.json`.

El JSON contiene únicamente metadata de esquema/ACL y definiciones de funciones. Se eliminaron projectRef y envoltorios identificadores de proveedor al combinar. No contiene filas, emails, IDs de clientes, tokens, credenciales ni URLs de destino. Los comentarios existentes de las funciones describen reglas genéricas y no identifican cuentas privadas.

En `.github/workflows/mayorista-isolated.yml`, después de instalar dependencias backend y del bootstrap PostgreSQL/roles existente, agregar en el mismo job de PostgreSQL 17:

```yaml
- name: Schema-only production fixture checks
  run: node src/modules/mayorista/tests/production-schema-fixture-unit.mjs . src/modules/mayorista/tests/fixtures/production-schema.fixture.json
- name: Production schema compatibility with synthetic data
  run: node src/modules/mayorista/tests/production-schema-compatibility-postgres.mjs --repo . --schema src/modules/mayorista/tests/fixtures/production-schema.fixture.json --out src/modules/mayorista/tests/artifacts/production-schema-compatibility.json
```

Incluir `src/modules/mayorista/tests/artifacts/production-schema-compatibility.json` en el upload existente con `if: always()`. No crear otro servicio ni modificar credenciales/conexión del job: runner usa exclusivamente `127.0.0.1:55471/mayorista_qa`, usuario de CI `postgres`, sin tomar URLs de entorno. Verifica dirección/base/usuario antes de crear sus schemas aleatorios y rol temporal; limpieza sólo de esos recursos propios. No llama instalador público productivo ni relaja sus guards de perfil/TLS.

Validación local ya realizada: `node --check` del runner/helper y PASS de unit del builder con metadata completa. PostgreSQL del nuevo runner aprobó en el run 39421303759 del candidato a486e906; validar los estados del commit final de reconciliación antes de entregar. El rol de ensayo limitado no representa la futura cuenta runtime productiva, que sigue sin crear/configurar.

El fixture versionado es la entrada reproducible del ensayo. El helper comprueba metadata sin filas, rechaza divergencias y dependencias faltantes y conserva las definiciones revisadas; la secuencia se almacena como bigint en texto para no redondearla. No abre conexiones.
