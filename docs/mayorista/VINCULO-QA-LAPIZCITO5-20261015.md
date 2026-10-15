# Vínculo de sesión SIGO a Mayorista QA — PR #72

## Diagnóstico

`lapizcito5` (`8728d172-7c1b-4de3-88ae-c20fc19c1fce`) tiene el módulo habilitado en la fuente SIGO compartida. El Preview comparte el proyecto Supabase de producción; allí no están instaladas `obtener_acceso_mayorista_sigo`, cotización, ficha ni tablas de destino/fuente propuestas. Railway QA carecía de origen SIGO y verificador Auth. Configurar solamente una URL no completa ese contrato.

No se instala nada en esa fuente compartida. No se cambia DATABASE_URL de Railway ni las variables Supabase del Preview. No se copian clientes, productos, ventas, saldos, facturas ni stock reales.

## Aislamiento operativo

- Backend y PostgreSQL existentes: proyecto MAYORISTA-QA `b9a7da94-1d87-46fe-b4da-c7e241ebe185`, entorno qa `2addc3e9-f088-42df-a72c-c233fd4308cb`, servicio API `9053689a-0e32-4f3c-b5da-3c01e480a9c6` y PostgreSQL `9120b029-d20c-4073-a9cc-003953f60817`.
- Se reutilizan el backend, modelos, SQL/RLS y fuentes comerciales canónicas de la aceptación QA aprobada. El dataset interactivo tiene esquemas aislados dentro de la MISMA base; no reutiliza ni modifica la evidencia de aceptación de ningún HEAD.
- Empresa operativa QA `30000000-0000-4000-8000-000000000001`, en un namespace derivado del hash del identificador de origen y Auth. Binding explícito con el identificador SIGO real; nunca se confunden ambos en pedidos/asientos.
- Inicialización con datos sintéticos de las plantillas QA verificadas. Cuentas y sesiones de fixtures quedan desactivadas antes de admitir sesiones reales. El marcador de inicialización impide reinicializar o sobrescribir datos humanos en reinicios. Un namespace parcial se rechaza para revisión, sin reset automático.
- Ingreso: token SIGO verificado por Auth, luego `mis_empresas_sigo` y `listar_modulos_empresa_sigo`, exclusivamente lecturas bajo la sesión del usuario. Solo la empresa configurada y sus administradores/propietarios pueden vincularse; rol derivado del servidor, no del cuerpo HTTP.
- La identidad se asocia a usuarios/perfiles privados QA y membresía canónica QA. Todas las operaciones comerciales del portal usan la conexión SQL QA del servicio. Ninguna RPC comercial se dirige a Supabase compartido.
- Sesión SIGO solo en memoria del backend: nunca DB, logs, URLs ni almacenamiento del navegador. Cada solicitud revalida identidad/rol/flag; solicitudes concurrentes comparten únicamente la verificación que está en curso. Reiniciar exige nuevo ingreso desde SIGO, conservando datos de negocio QA.
- El frontend exige que `/me` autenticado confirme el binding entre ambos identificadores. Fuera del opt-in QA se conserva el contrato anterior estricto.
- Modo QA descarta el transporte comercial/fiscal del host SIGO. No hay emisión ARCA externa desde este vínculo. La aceptación fiscal continúa siendo simulada, sin credenciales productivas.

## Configuración acotada

Vercel: exclusivamente target `preview`, rama `feat/mayorista-distribuidora-offline-20261012`, proyecto existente `prj_NSo8ryyNV55nOoJVkAQt1u2AR99V`:

```
VITE_MAYORISTA_QA_MODE=isolated
VITE_MAYORISTA_QA_EMPRESA_ID=8728d172-7c1b-4de3-88ae-c20fc19c1fce
VITE_MAYORISTA_QA_API_ORIGIN=https://mayorista-api-qa-qa.up.railway.app
```

Railway, únicamente servicio API en qa; preparar todo junto al HEAD verificado:

```
MAYORISTA_INTERACTIVE_QA=true
MAYORISTA_QA_SIGO_EMPRESA_ID=8728d172-7c1b-4de3-88ae-c20fc19c1fce
MAYORISTA_SIGO_ORIGIN=<origen exacto del nuevo Preview READY>
MAYORISTA_SIGO_AUTH_URL=<origen Auth SIGO confirmado>
MAYORISTA_SIGO_AUTH_ANON_KEY=<clave pública del mismo proyecto; fuera del repo>
```

Se usa la clave pública únicamente para las tres lecturas autorizadas. No se necesita service_role, contraseña de un cliente, credenciales PostgreSQL productivas ni certificado ARCA.

## Verificación y reversión

Pruebas CI: PostgreSQL real para bootstrap idempotente/reinicio, cuentas fixture desactivadas, login firmado, otra empresa, cambio de rol/flag, membresía sin duplicados y endpoints de las páginas. Chromium valida identidad de origen distinta de la empresa QA, diez páginas funcionales y un alta persistente de vendedor solo en QA. El verificador remoto está simulado en CI; la comprobación de la sesión real requiere el nuevo ingreso Android del usuario.

Tras SUCCESS: health/readiness deben corresponder al SHA desplegado y anunciar `interactiveQa.enabled=true`. El Preview debe ser READY con el mismo HEAD y las variables limitadas a su rama. Entrar normalmente a SIGO, seleccionar lapizcito5 y abrir Mayorista: debe aparecer `QA AISLADO`, con datos sintéticos persistentes, sin mensaje de conexión pendiente.

Reversión sin borrar datos: desactivar `MAYORISTA_INTERACTIVE_QA` y retirar las tres variables de Preview de esta rama; aplicar solo al QA existente. Los esquemas y auditoría se conservan. No se cambia el flag de lapizcito5, su membresía, sus datos comerciales, main ni producción. No merge ni infraestructura adicional.
