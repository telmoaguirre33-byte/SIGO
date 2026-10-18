# Integración modular SIGO Gestión

## Procedencia y estrategia

- Base main: `d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`.
- Mayorista funcional Railway QA: `2519719cc0ffc328553c0b32e8f3bd10a4d214a3`.
- Árbol preparado PR #72: `33255fb68b8cfb4e3f71726b1cfd03f2ce517d36`.
- Comparación inicial: main es ancestro; 158 commits Mayorista, cero commits main pendientes, sin conflictos. Se conserva el historial original en PR #72.
- Rama final: `integration/sigo-unificado-mayorista-20261018-p72`. Un commit de integración con padre main y árbol preparado revisado, más cambios acotados descritos aquí. No se fusiona PR #72 ni se actualiza main.

## Comportamiento

SIGO conserva sus pantallas originales. Launcher Mayorista añade accesos al menú existente y monta el workspace operativo dentro de SIGO. App Vendedor es una interfaz del mismo módulo y API, no otra base comercial.

Minorista: sin menú Mayorista, incluso si quedó un flag administrativo habilitado. Mayorista/Mixto: requiere tipo canónico, flag habilitado y rol owner/admin para la integración gerencial. Personal conserva sus permisos operativos existentes. Tipo, módulo y suscripción no se infieren entre sí. Una renovación/login no escribe activaciones. Matriz puede apagar el módulo sin cambiar el tipo.

El tipo se lee mediante `leer_tipo_negocio_sigo` solamente cuando el flag está activo. Errores o tipo desconocido cierran el acceso. No se cambia autenticación, backend ni permisos SQL.

La fuente comercial compartida existente reutiliza productos, clientes, precios, ventas, Caja, cuenta corriente, ARCA y stock de SIGO. Tablas Mayorista guardan pedidos, asignaciones y logística; no reemplazan esos dominios. La entrega y sus reintentos conservan su identidad transaccional. Homologación/WSFE de CI es simulada, nunca ARCA productiva.

## Verificación y límites

- `unified-company-policy.mjs`: tres tipos, flags, aislamiento, errores y cancelación.
- `unified-ui.mjs`, desde `operational-ui.mjs`: entrada completa `src/main.tsx`, AuthGate, Root, selector de empresas, pantallas y launchers originales. Tres empresas distintas en los esquemas efímeros PostgreSQL del CI existente. Auth/PostgREST son transportes de prueba; los RPC de tipo/configuración ejecutan SQL real con rol authenticated. Las lecturas nativas usan filas canónicas y membresía verificada, no acreditan por sí mismas políticas RLS de todos los dominios. Las pruebas RLS/API independientes mantienen esa cobertura.
- Chromium conserva menú nativo, verifica productos aislados y abre Mayorista integrado con SSO para Mayorista/Mixto. No introduce rutas de prueba en el producto publicado.
- Suite operacional existente acredita pedido, picking, carga, entrega, venta, cobranza, rendición, factura simulada, stock y saldos sin duplicación sobre PostgreSQL efímero.
- Build SIGO + `verify:critical`, build Matriz y suite Mayorista deben pasar en el HEAD integrado. Compra IA conserva su fallo independiente.

Un resultado CI no equivale a tres accesos autenticados publicados. Para esa aceptación se necesitan tres empresas autorizadas y acceso seguro en el destino Preview; no se crean cuentas ni datos en producción. No declarar completada esa aceptación sin evidencia.

## Migraciones, configuración y reversión

Se conserva el paquete inmutable de 21 migraciones, su inventario/hashes, preflight y procedimiento de recuperación del árbol preparado. Esta integración no añade SQL ni modifica el esquema. Aplicación productiva permanece prohibida; antes debe validarse el preflight en el destino autorizado.

El origen exacto del nuevo Preview debe estar autorizado en CORS del runtime elegido y en Auth redirect URLs. Nunca abrir CORS indiscriminadamente ni usar la empresa sintética como destino comercial. El runtime QA actual permanece en HEAD 2519719c; no se redeploya. Si el nuevo Preview necesita autorización CORS, agrupar y preparar un único cambio QA para aprobación, sin aplicarlo.

Los controles comerciales existentes excluyen QA, PRUEBA P0, fixtures, credenciales y aceptación mediante opt-in exclusivo QA. Los módulos de prueba se ejecutan desde CI; no se añaden rutas frontend de bypass.

Rollback de esta integración: volver al deployment frontend anterior conocido; desactivar el flag por empresa mediante Matriz si corresponde. No borrar datos ni revertir ventas/stock mediante SQL destructivo. Recuperación de migración y backup del proveedor siguen el paquete preparado; no se ejecutan en producción durante este trabajo.

Quedan reservados los dos pedidos Android, IndexedDB y toda la evidencia persistente QA. No se sincronizan, modifican ni resembran.
