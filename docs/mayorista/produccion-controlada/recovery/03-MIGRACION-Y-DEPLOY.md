# Recuperación de migración y deployment sin pérdida

Preparado, no ejecutado. El alcance se limita a Mayorista y al piloto autorizado; no cambia otros módulos, empresas, licencias o permisos Minoristas. La aplicación de producción indicada es `d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`; no se ha acreditado una imagen Mayorista anterior compatible. El candidato de publicación es `a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b`.

## Preparación que evita un rollback destructivo

Fijar imagen/digest, SHA, perfil/hash, rol migrador y runtime, inventario y 21 hashes efectivos, respaldo y punto recuperable, estado previo de flags/destinos y procedimiento de cierre de escrituras. Mantener secretos de migración fuera del runtime. No ejecutar fuentes QA/NO_APLICAR, seeds/reset/accept, ni un `db push` general como recuperación. El instalador público requiere aprobación/perfil/TLS/destino explícitos y se invoca fuera del arranque del servidor.

El núcleo inspeccionado usa una transacción para las 21 versiones, binding y ledger, `lock_timeout=5s`, `statement_timeout=120s` y advisory lock transaccional. El timeout de statement es por sentencia, no un límite total de toda la instalación. Si falla antes de confirmación intenta `ROLLBACK`. [Código local: commercial-migrations.mjs, líneas 20–50](../../PR78-BACKEND-LINK/src/modules/mayorista/backend/commercial-migrations.mjs).

## Decisión según el punto del fallo

| Situación observada | Acción segura |
| --- | --- |
| Rechazo antes de ejecutar DDL: perfil/TLS/destino, esquema canónico ausente o Mayorista sin ledger | Detener, preservar diagnóstico y resolver la causa sobre el destino correcto. No adoptar/borrar un esquema preexistente ni fabricar ledger |
| Error PostgreSQL durante la transacción y rollback confirmado | Conservar error, hashes y snapshot previo; comprobar que no quedaron cambios; corregir la causa antes de repetir el paquete revisado |
| Lock/statement timeout | Detener y revisar contención/carga/compatibilidad. No matar sesiones ni aumentar timeouts a ciegas |
| Desconexión, timeout del cliente o error al enviar/recibir `COMMIT` | Tratar el resultado como **incierto**. No asumir rollback: el servidor pudo confirmar aunque la respuesta se perdiera |
| Confirmación del COMMIT, sin operaciones nuevas | Mantener tablas/ledger; desactivar acceso del piloto; volver sólo a aplicación compatible comprobada o corregir hacia adelante |
| Operaciones nuevas confirmadas o comandos con respuesta perdida | Conservar UUID/colas y conciliar antes de repetir. Corregir hacia adelante; nunca sobrescribir con un backup anterior |

## Resolver un COMMIT incierto

1. Registrar hora UTC, identidad no secreta del destino, perfil/hash, paquete/hashes, error y correlación del proceso. Conservar logs privados sin tokens ni SQL con datos.
2. Confirmar con el operador que la transacción/conexión anterior terminó. Una lectura que todavía no ve el ledger puede ocurrir mientras esa transacción sigue abierta; esa ausencia sola no prueba rollback.
3. En conexión de diagnóstico de sólo lectura al **mismo destino**, ejecutar primero la comprobación de existencia y luego binding/ledger sólo si existen. La plantilla [diagnostico-commit.SOLO-LECTURA.sql](diagnostico-commit.SOLO-LECTURA.sql) sólo lee metadata de release y catálogos, con timeout y transacción de lectura; no abre una conexión por sí misma. Invocarla con `psql -X --no-password --dbname='service=sigo_migration_diagnostic_source' --file=diagnostico-commit.SOLO-LECTURA.sql`, usando archivo de servicio/passfile privados ya revisados y rol existente con lectura suficiente. `-X` evita configuración de inicio local. Si faltan permisos, detener el diagnóstico; no elevar al runtime.
4. Comparar con el estado previo y los 21 hashes regenerados para el rol runtime aprobado. Ledger completo idéntico y binding correcto permiten reconocer instalación previa; no lanzar DDL para resolver el error de red. Ausencia esperada tras transacción terminada permite planificar una repetición después del diagnóstico. Estado parcial, binding distinto, hashes distintos o Mayorista sin ledger requieren conciliación y mantienen el bloqueo.
5. Verificar esquema/owners/grants/RLS además del ledger. El no-op del instalador comprueba ledger y binding; no detecta integralmente cambios manuales fuera de ese historial. No editar `source_hash`, `release_binding` o numeración para forzar readiness.

## Recuperar el deployment

1. Detener nuevos envíos y trabajos Mayoristas del piloto mediante controles **de servidor** autorizados y comprobar rechazo efectivo. Preservar una captura privada del estado previo. Ocultar una pantalla no bloquea API ni tareas. No desactivar otros módulos/empresas ni tocar stock, caja o deudas para apagar el módulo.
2. Si la aplicación falló antes de habilitar el piloto, dejarlo cerrado y mantener la aplicación de producción previa si sigue funcionando. Inspeccionar HEAD/imagen, perfil/binding, conexión/TLS, Auth/CORS, health/readiness y logs antes de otro deployment.
3. Recuperar sólo una imagen cuya compatibilidad con el esquema confirmado esté probada. Un `SUCCESS` anterior no prueba compatibilidad, y el SHA actual de SIGO no demuestra que exista un backend Mayorista comercial previo. Si no hay imagen compatible, mantener el módulo cerrado y preparar una corrección hacia adelante.
4. No borrar tablas, funciones, auditoría o ledger, no reaplicar migraciones base SIGO, no hacer down destructiva y no usar `reset/seed`. Las funciones y tablas compartidas deben compararse antes de cualquier cambio; no revertir permisos Minoristas como atajo.
5. Preservar IndexedDB, perfil, origen PWA, llaves y comandos pendientes de cada dispositivo. No limpiar caché/almacén ni cambiar el origen para simular recuperación. Los dos pedidos Android reservados quedan fuera del ensayo y no se sincronizan.
6. Tras recuperar, comprobar seguridad por rol/empresa, rechazo sin sesión/expirada/revocada, Minorista, salud y conciliación antes de reabrir exclusivamente el piloto.

## Operaciones del intervalo: compensar con el circuito autorizado

Conservar un registro privado por UUID/comando y resultado: pedido → carga/entrega → venta → stock → cuenta corriente o caja → cobranza/rendición → devolución/nota de crédito → documento fiscal. Incluir respuestas perdidas y acciones externas pendientes. No suponer que “no llegó respuesta” significa que no se vendió/cobró.

- Consultar el resultado del comando por el mecanismo previsto y reintentar el **mismo UUID con el mismo contenido** para obtener su resultado idempotente. No regenerar UUID, reeditar el payload consumido o reenviar manualmente una venta/cobro/factura.
- Una operación confirmada se corrige mediante devolución, anulación, ajuste, rendición o nota de crédito que corresponda, con permisos/auditoría y revisión de efectos en stock, caja, cuenta corriente y ARCA. No aplicar SQL ad hoc que borre movimientos ni sumar compensaciones sin el circuito revisado.
- Si un sistema externo aceptó un cobro/CAE y la base perdió su respuesta, conciliar primero con ese sistema. No repetir emisión/cargo por inferencia. El backup de PostgreSQL no revierte efectos externos.
- Una restauración al corte anterior se realiza primero aislada para investigar y recuperar evidencia; no se usa como rollback rutinario de la base activa. Cualquier recuperación destructiva de producción queda fuera de este paquete y exige una decisión de incidente con conciliación explícita de toda operación posterior al corte.

## Qué prueba CI

El ensayo local inspeccionado provoca un fallo en versión 21 después de ejecutar las primeras 20, espera rollback de los schemas nuevos y compara empresas/productos/clientes de fixture. También verifica instalación, repetición, RLS y rechazo de hashes/ledger parcial. Usa PostgreSQL 17 local con Auth/objetos simplificados y llama al núcleo transaccional directamente. No valida el wrapper completo de aprobación/TLS, todas las relaciones del esquema productivo, recuperación del proveedor, volumen real, RPO/RTO o conciliación comercial. Un resultado PASS debe vincularse al SHA/run/artifact exacto antes de citarlo para PR #78.

Readiness valida un subconjunto de referencias, rol, RLS, binding y ledger y devuelve `productionAcceptance:false`. No equivale a prueba comercial completa, backup ni recuperación del servicio. [commercial-runtime.mjs:33](../../PR78-BACKEND-LINK/src/modules/mayorista/backend/commercial-runtime.mjs), [ensayo PostgreSQL](../../PR78-BACKEND-LINK/src/modules/mayorista/tests/commercial-migrations-postgres.mjs).
