# Revisión de migraciones PR78 — sólo preparación

Fecha: 2026-10-20. HEAD de aplicación revisado `a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b`. Root ejecutó únicamente lecturas de catálogos en COMERCIAL, guardadas en `../evidence/`; esta subrevisión no abrió conexiones remotas. No hubo escritura productiva, filas comerciales, cambios en `main` ni deploy. Archivos de esta subrevisión escritos exclusivamente dentro de este directorio. Los tests nuevos corresponden a la preparación posterior a a1d; el commit futuro de integración los identificará.

## Resultado y evidencia

Las 20 fuentes del inventario pasan SHA-256 y el ensamblado produce 21 versiones. Los 21 hashes coinciden con `SIGO-QA-INTEGRACION-PREPARACION/mayorista-pending-QA.json` **para el rol de referencia QA** `sigo_qa_mayorista_backend`. La v21 interpola el rol; su hash no se reutiliza para otro rol. `package-hashes.review.json` conserva hashes sin SQL ejecutable. `head-source-verification.json` verifica instalador, generador de grants e inventario contra blobs GitHub del HEAD aprobado; las dos copias locales .mjs sólo difieren en un salto de línea final. Los snapshots exactos están en `head/`.

El inventario contiene comentarios históricos `sourceHead=d85bb6aa...`, `productionStatus=blocked_pending_versioned_conversion...` y política de transacciones por grupo. El comportamiento vigente está en `commercial-migrations.mjs`: ya compila 21 y usa una única transacción. Esos textos históricos no son una aprobación ni invalidan la comprobación de bytes; requieren leer la implementación y evidencia actual. No se modificaron.

CI PostgreSQL 17 del [run 39361275339](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/39361275339) es evidencia reutilizada de instalación/rollback/repetición/drift en el fixture sintético anterior. La ejecución de QA integración con 21 hashes/RLS es otro destino; no habilita ni adopta producción. El ensayo nuevo usa un fixture generado de las definiciones productivas exportadas sin datos; su ejecución PostgreSQL en CI sigue pendiente al redactar esta revisión.

## Contrato exacto y bloqueos de compatibilidad

Root ejecutó `preflight-catalogo.sql` con BEGIN READ ONLY en COMERCIAL (PostgreSQL 17.6), sin invocar RPC ni leer tablas comerciales. Resultado exacto en `../evidence/catalogo-productivo.SOLO-ESQUEMA.json`: **114/114 columnas** con tipo compatible; **7/7 firmas/retornos** presentes; **0 columnas NOT NULL omitidas sin default** en las formas de INSERT revisadas; 92 constraints, 46 índices públicos y 11 triggers. No existen esquemas Mayorista, ledger ni tablas de activación/fuente; una función Matriz existente de listado de módulos no colisiona con las creadas por el paquete. Runtime y migrador futuros permanecieron NULL en el preflight: no se verificaron roles productivos elegidos.

Las exportaciones posteriores añadieron TODAS las columnas y cuerpos de función, más dependencias, enums y secuencia como texto. El fixture combinado incluye **23 tablas, 264 columnas, 21 funciones reales, 15 triggers, 112 constraints, 82 índices y 3 enums**, sin filas. El guard ARCA devuelve NEW si venta_id es NULL, por lo que acepta estructuralmente la reserva NC. Productos tiene costos default 0 y guard coalesce, además de cálculo real de margen. No se encontró incompatibilidad DDL demostrada en PK/FK/CHECK/índices revisados; resta probar comportamiento en el ensayo nuevo. `external-symbols.review.json` es comprobación lexical auxiliar.

Requisitos que exceden el guard mínimo del instalador:

- Tablas canónicas en la **misma base**: Auth real (`users`, `sessions`), empresas/usuarios/módulos, productos/clientes, ventas/items, movimientos de clientes/Caja, ofertas, devoluciones/items y `arca_comprobantes` para el flujo fiscal. El paquete no crea Auth ni esos maestros. Algunos lectores protegen ramas opcionales con `to_regclass`, pero eso no hace opcionales las funciones fiscales ni las devoluciones del circuito completo.
- Firmas: `auth.uid() → uuid`, `auth.jwt() → jsonb`, `public.es_superadmin_sigo() → boolean`, `public.tiene_permiso_empresa(uuid,text) → boolean`, `public.registrar_cobro_cliente_sigo_v2(uuid,uuid,numeric,text,text) → uuid`, `public.registrar_devolucion_sigo(uuid,uuid,jsonb,text,text,boolean) → uuid`. Se usa `pg_catalog.gen_random_uuid()` con `search_path=''`.
- Referencias nuevas usan IDs canónicos: PK/UNIQUE de `empresas.id`, `productos.id`, `clientes_sigo.id`, `ventas_sigo.id`, `cliente_movimientos_sigo.id`, `devoluciones_sigo.id`, `auth.users.id`. `ON CONFLICT` exige `sigo_modulos_catalogo(clave)` y `sigo_empresa_modulos(empresa_id,modulo_clave)` únicos.
- Revisar defaults/constraints de INSERT que omiten IDs, estado y fechas. Venta acepta efectivo/transferencia/cuenta_corriente; cuenta acepta debe/haber; Caja ingreso; devolución parcial/total y anulación de venta. Notas de crédito omiten `arca_comprobantes.venta_id` y usan `resultado='reservado'/'A'`, `request_id='mayorista_nc:<uuid>'`; no basta encontrar la tabla. Triggers existentes podrían añadir efectos de stock/saldos además de los explícitos del paquete.
- Roles `anon`/`authenticated` observados sin SUPERUSER/BYPASSRLS. El executor productivo `postgres` es NOSUPERUSER, BYPASSRLS y tiene ADMIN OPTION sobre authenticated; esto describe el lector observado, no designa migrador futuro. Debe elegirse migrador distinto del runtime y con CREATE SCHEMA/DDL en public, capacidad de FK/trigger sobre tablas ajenas y grant de authenticated. Las funciones SECURITY DEFINER quedan del migrador. El runtime productivo todavía no existe/configura; el ensayo sólo crea un rol CI NOSUPERUSER/NOBYPASSRLS y revisa su identidad efectiva.
- Esquema Mayorista previo sin ledger: `UNMANAGED_SCHEMA_REQUIRES_RECONCILIATION`. No adoptar QA, borrar esquemas ni inventar historial. El instalador chequea cuatro marcadores sin ledger; el preflight también debe encontrar objetos parciales/funciones de nombres coincidentes no cubiertos por esos cuatro marcadores.
- Ledger/hash idénticos **no prueban ausencia de drift manual de objetos**. Instalador valida el ledger, no calcula fingerprints de las definiciones. Readiness revisa algunas referencias y RLS/FORCE de tablas operativas, no compara todas las columnas, políticas, funciones, triggers o ACL. Por eso se conserva inventario de definiciones/fingerprints aparte.

Las columnas marca/codigo_interno/codigo_barras se proyectan de forma opcional vía JSON en algún lector, pero `importar_fila` las usa directamente: son requeridas para la superficie completa. El directorio usa metadata de usuario sólo como nombre visible; permisos usan membresía canónica, no metadata editable.

## Qué cambia en Minorista

Al instalar se agrega la fila de catálogo `mayorista_distribuidora` con `ON CONFLICT DO NOTHING` (005:24–26); si existe, sus datos quedan intactos. No se activa ninguna empresa ni se siembran usuarios/pedidos/productos/saldos. Se instala trigger AFTER INSERT/UPDATE `sigo_mayorista_auditar_flag` sobre `public.sigo_empresa_modulos` (005:64): sólo audita la clave Mayorista, pero es una dependencia nueva en una tabla compartida.

Ninguna función canónica Minorista (`registrar_devolucion_sigo`, `registrar_cobro_cliente_sigo_v2`, `confirmar_venta_sigo`, `tiene_permiso_empresa`, `es_superadmin_sigo`) se reemplaza. Renombres/reemplazos del paquete afectan funciones Mayorista creadas por versiones previas: catálogo v17, acceso v19, lector base/métricas v20.

Después de activar y operar, se comparten stock y contabilidad. No afirmar que Minorista queda aislado de esos movimientos:

| Flujo | Cambios canónicos |
|---|---|
| Entrega (`006:119–130`) | INSERT venta/items, resta stock, debe/saldo CC o ingreso Caja contado. |
| Cobro admin (`006:168`) | RPC canónica `registrar_cobro_cliente_sigo_v2`. |
| Cobro delegado (`008:59–61`) | INSERT haber, resta saldo cliente e INSERT ingreso Caja directamente. |
| Devolución (`008:78–130`) | RPC canónica; gerencia puede autorizar crédito/saldo a favor, devolver stock e incluso anular venta. |
| Clasificación (`008:130,154`) | Ajusta stock según vendible/averiada/revisión. |
| NC (`010:37,50`) | Reserva y confirma en `arca_comprobantes` canónico. |
| Importación (`launch-schema-qa.sql:61,75,84`) | Alta de cliente/producto faltante; apertura de stock sólo si cero y sin movimientos/pedidos. |

## Atomicidad, idempotencia y recuperación

`prepareCommercialMigrations(role)` valida SHA-256 de cada fuente, retira envoltorios BEGIN/ROLLBACK, endurece `search_path=public` a vacío, evita creación duplicada de esquema privado y rechaza scaffolding Auth/roles. No ejecutar plantillas NO_APLICAR, `schema-package` QA ni `db push` indiscriminado.

`installCommercialMigrations` exige perfil aprobado y hash SHA-256 del texto exacto, acción `install-commercial-schema`, migrador separado y pool host/puerto/base/usuario/TLS-CA/hostname acordes. El núcleo usa BEGIN, `lock_timeout=5s`, `statement_timeout=120s`, advisory xact lock y valida base/current_user antes del DDL. Se aplican todas las versiones y binding/ledger en el mismo COMMIT; error provoca ROLLBACK. No hace seed ni corre al arrancar. El timeout es por statement/llamada, no un plazo global de toda la instalación.

Ledger vacío nuevo instala; 21 versiones contiguas y hashes/binding exactos devuelve `reused=true`. Hash diferente, hueco, conteo parcial o binding distinto abortan. No es una herramienta de reconciliación ni recuperación de esquema semicompletado. `preflight-ledger-si-existe.sql` sólo lee historial técnico después de confirmar ambas tablas.

Los UUID de operaciones y huellas comerciales se controlan además con locks/PK/respuestas; varias RPC usan MD5 de JSONB para comparación de contenido. Son distintos del SHA-256 del paquete y no sustituyen el ledger. Preservar UUID y payload al reintentar; no generar UUID nuevo para ocultar un resultado incierto. Un timeout de conexión durante COMMIT requiere leer metadata/estado con el procedimiento autorizado antes de reintentar.

Antes de COMMIT: capturar error y hashes; ROLLBACK revierte DDL/grants/trigger/catálogo/binding/ledger juntos. Corregir causa entendida y repetir por el instalador, nunca saltar versión o editar hashes.

Después de COMMIT: apagar disponibilidad y/o flag por el flujo Matriz autorizado, conservar tablas/ledger/auditoría y volver a aplicación compatible o corregir hacia adelante. El trigger nuevo seguirá auditando cambios del flag. No DROP, down migration, resembrado ni restore viejo sobre ventas/cobros nuevos. El esquema, grants y funciones quedan instalados: recuperación de aplicación no equivale a desinstalarlos. Para corrupción/pérdida, restore probado en otro destino y reconciliación de movimientos posteriores según runbook de backup del responsable.

El ensayo nuevo se encuentra preparado en `production-schema-compatibility-postgres.mjs`, con fixture `production-schema.fixture.json` y builder `production-schema-fixture.mjs`; ver `INTEGRACION-CI-ENSAYO.md`. Pasaron sintaxis Node y prueba local del builder (cierre de dependencias, namespace aislado, orden FK, bigint exacto y rechazo de drift/datos). PostgreSQL nuevo queda pendiente de CI existente, sin infraestructura adicional. No confundir esos checks locales con el resultado PostgreSQL. La consulta del changelog Supabase se intentó y falló por conexión al proxy; esta revisión no implementa APIs ni altera producto Supabase.

## Resultado CI posterior a la preparación

El candidato `a486e906143ad3737f64e84489cf57b2713eb114` aprobó el [run 39421303759](https://github.com/telmoaguirre33-byte/SIGO/actions/runs/39421303759): nuevo ensayo del esquema productivo sin datos, 21 migraciones/rollback/replay/drift, operaciones sintéticas, RLS/API, Chromium, IndexedDB y Docker. El job 118622633658 y sus logs registran PASS; no es una ejecución en COMERCIAL ni un restore del proveedor. El commit posterior preserva los seis blobs de main 8e0f49d8 y requiere sus propios estados CI antes de la entrega.
