# Preparación de publicación — NO autoriza publicar

Revisión del PR #72 completo frente a main `d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`. HEAD funcional aprobado: `d85bb6aa484ceef1849578b71489818793e2feb9`. Comparación GitHub: 148 commits por delante, 0 por detrás; main es el merge-base. No se necesitó reconciliación, rebase ni merge. Revalidar estas condiciones justo antes de una futura publicación: este resultado no cubre cambios posteriores.

El conjunto revisado tiene 280 archivos. Fuera de Mayorista/documentación se agregan su workflow y dos endpoints fiscales; cambian cinco puntos de integración SIGO y `vercel.json`. Se revisaron sus parches: Matriz agrega destino; Configuración agrega tipo/acceso; registro guarda preferencia y llama RPC autorizada; root retoma esa preferencia; main monta launcher; Vercel limita las funciones nuevas a 60 s en gru1. No cambia el código de ventas/compras/stock Minorista ni funciones ARCA existentes. El registro y configuración sí tienen controles nuevos visibles: no se afirma identidad visual absoluta del registro.

## Decisión piloto: NO-GO para clientes comerciales

GO únicamente para continuar aceptación sintética en QA. Los siguientes son bloqueos de código/preparación y externos; no se deben presentar como si sólo faltara Android:

1. **Runtime productivo inexistente:** `backend/railway-runtime.mjs` y `railway/database-policy.mjs` admiten sólo IDs, base, CA, presupuesto e issuer del QA. `server.mjs` llama `assertInstalledQA`, activa `interactiveQa` y usa readiness basado en evidencia sintética. No basta cambiar variables o quitar guards. Preparar una política/entrypoint productiva separada, con target explícito, mínimo privilegio y pruebas, antes de publicar. Este trabajo no desactiva los guards ni crea ese entorno.
2. **Topología de fuente canónica no resuelta:** `sigo-bridge.mjs`, `shared-source.mjs` y las RPC SQL consultan tablas SIGO, `auth.sessions` y tablas operativas en la misma conexión. QA funciona con un namespace y datos sintéticos preparados. Railway QA no se convierte en producción ni se copian datos reales para simular esa convivencia. Elegir y autorizar conexión/topología sobre infraestructura existente, validar JWT/roles/TLS/pool y transacciones reales. El esquema `auth` y sus funciones existentes jamás se reemplazan.
3. **Migraciones productivas no ejecutables todavía:** el inventario contiene 20 fuentes ordenadas y sus hashes. Son plantillas QA con CREATE/ALTER no reentrantes y algunas terminan en ROLLBACK. Necesitan conversión versionada y ensayo sobre esquema representativo real, sin fixtures que sustituyan permisos. No están listas para `db push`. No se creó historial de migración ni se aplicó DDL.
4. **Ingreso inicial vendedor fuera de QA:** la rama no-QA muestra Empresa como campo requerido; el login espera UUID. El selector amistoso actual está restringido al origen QA. Falta validar/proveer el vínculo de empresa al primer acceso comercial sin UUID manual, junto a provisión/recuperación privada de cuentas. No hay un flujo de alta comercial acreditado por esa pantalla QA.
5. **Aceptación publicada/rendimiento/restauración:** faltan health/readiness directos, cinco roles publicados y conciliación final del HEAD, p95 Railway con muestras suficientes, prueba de restauración autorizada del proveedor y aceptación física. Fallo de proxy del ejecutor no equivale a fallo del servicio, pero tampoco acredita estas pruebas.
6. **Suscripción y fiscal:** estados comerciales son preparación, no enforcement de vencimiento/suspensión/cobro. El trial del alta SIGO se conserva; preferencia `user_metadata` no autoriza roles, módulos ni licencia. Definir política de piloto gratuito/manual y alcance fiscal. Endpoints Mayorista admiten sólo homologación; sin facturación legal propia aprobada no vender un piloto que la requiera. No se habilitan cobros ni ARCA productiva.

## Migraciones: artefactos, orden y condiciones

`inventario-migraciones.json` fija cada ruta, SHA-256 y orden. Es inventario de revisión, **no un instalador**. `preflight-lectura.sql` y `postflight-lectura.sql` son consultas preparadas de sólo lectura, no ejecutadas contra producción. Devuelven metadata, no filas comerciales ni secretos.

Orden lógico de dependencias para una futura conversión revisada:

| Orden | Fuente | Función |
|---|---|---|
| 1–3 | SQL 002, 003, 004 | Esquema, RLS, pedidos, eventos y administración |
| 4–7 | cargas, visitas, inventario, cuentas | Operación/stock/cuentas propios |
| 8–10 | private-auth, roles, master | Identidad privada, cinco roles, maestros y asignaciones |
| 11–12 | collections, goals | Cobranzas y metas |
| 13 | SQL 005 | Tipo de negocio, módulo, destino y auditoría |
| 14 | SQL 006 | Fuente SIGO, entregas/ventas/cobros idempotentes |
| 15 | SQL 007 | Lectores compartidos y catálogo |
| 16 | SQL 008 | Operación comercial, devolución y permisos |
| 17 | SQL 009 | Precios y cotización |
| 18 | SQL 010 | Nota de crédito y conciliación fiscal |
| 19 | SQL 011 | Destino predeterminado controlado por Matriz |
| 20 | launch-schema-qa | Puesta en marcha/importaciones/suscripción, lectores optimizados |

Prerrequisitos existentes a inspeccionar: tablas/funciones reales de empresas, membresías, catálogo/flags (PR #73 ya integrado en la base), productos/precios/ofertas, clientes/saldos, ventas/items, caja, devoluciones, permisos y ARCA; columnas, firmas, constraints e índices. Los ensayos CI leen migraciones existentes `20260911043000_ventas_caja_operativas`, `20260911062000_clientes_cuenta_corriente`, `20260911112000_cobros_cuenta_corriente_caja`, `20260913205500_carrito_devoluciones_anulaciones`, `20260910021200_arca_config_segura`, `20260914003500_arca_cae_preflight_guards`; **no reaplicarlas** por aparecer aquí. Los fixtures crean tablas/funciones simplificadas: no prueban la compatibilidad integral con todo el esquema productivo.

Conversión futura: generar migraciones con el CLI Supabase vigente, sobre una copia/esquema de ensayo autorizado y sin nuevos recursos pagos. Mantener ledger de versiones+hash: misma versión/mismo hash no-op; mismo número/hash distinto aborta; estado parcial o schema drift aborta. Advisory lock, lock_timeout/statement_timeout revisados y transacciones por grupo. CREATE IF NOT EXISTS por sí solo no verifica columnas/policies/funciones existentes. Operaciones comerciales idempotentes no convierten automáticamente el DDL en idempotente.

Excluir SQL 001 de prueba, `schema-package.mjs` (crea auth/roles de fixture), namespaces de aceptación, seed/demo/reset de vendedores, scripts de aceptación mutante y binds al QA. Ningún build/predeploy productivo debe ejecutarlos. No incluir schema `auth`, usuarios sintéticos ni órdenes QA en backups de migración a producción.

## Revisión de seguridad y compatibilidad

- Mantener RLS por empresa, restricciones FK compuestas, actor y versión/journal; comprobar dos empresas y cinco roles con credenciales de ensayo, no sólo superusuario.
- Esquemas privados fuera de Data API; sin grants generales. Roles runtime sin SUPERUSER/BYPASSRLS; usuario de migración separado y no publicado. Validar propietarios de tablas/funciones y privilegios efectivos; RLS forzado no protege frente a un rol BYPASSRLS.
- SECURITY DEFINER existente es una frontera privilegiada: revisar guard de identidad/sesión/empresa/módulo, rol/permiso por operación, `EXECUTE` revocado a PUBLIC/anon y firmas autorizadas. SQL 005 usa `search_path=public`; demostrar que ningún rol no confiable pueda crear allí o endurecer las funciones en una migración revisada. Funciones nuevas usan normalmente search_path vacío y nombres cualificados. No conceder bypass para resolver errores.
- Verificar advisors Supabase y grants reales antes de habilitar. No se ejecutaron advisors ni consultas al proyecto productivo. No se pudo consultar changelog/docs remotas desde el proxy del ejecutor; verificar versión/CLI/docs antes de convertir o aplicar migraciones. No se implementó aquí una nueva integración Supabase basada en supuestos de versión.
- El token SIGO se valida contra Auth configurado por servidor; membresía/flag se leen de DB. Datos editables de usuario sólo representan preferencia de alta/nombre. Nunca sirven para autorización.
- El pool/transacción debe mantener SET LOCAL ROLE authenticated y claims verificados; comprobar revocación y expiración tanto de Auth SIGO como de sesión Mayorista. Sin secretos o tokens en URL/log/build/frontend.
- Mantener stock/ventas/caja/clientes SIGO como única fuente para empresas vinculadas; no activar fuente alternativa sobre una empresa con movimientos sin conciliación previa.
- Antes/después guardar inventario de esquemas/funciones, grants y métricas agregadas de empresa sintética, además de versiones de aplicación. Comparar Minorista y rechazos cross-tenant. No extraer datos comerciales al informe.

## Inventario de configuración (nombres, nunca valores secretos)

| Plataforma | Configuración requerida | Condición |
|---|---|---|
| Vercel SIGO | Variables Supabase públicas existentes `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` o publishable key | Conservar las de SIGO; ninguna service_role en VITE |
| Vercel servidor fiscal | `SUPABASE_URL`, `SUPABASE_ANON_KEY` o fallback público existente | No agregar secretos al cliente; homologación únicamente |
| Vercel Preview QA | `VITE_MAYORISTA_QA_MODE`, `VITE_MAYORISTA_QA_EMPRESA_ID`, `VITE_MAYORISTA_QA_API_ORIGIN` | No heredar en Production; Preview READY no valida esa configuración futura |
| Railway actual QA | `MAYORISTA_QA_ENABLED`, IDs Railway, `MAYORISTA_DATABASE_SERVICE_ID`, `DATABASE_URL`, `MAYORISTA_DB_CA_PEM`, `MAYORISTA_AUTH_PRIVATE_KEY`, presupuesto, `MAYORISTA_PUBLIC_ORIGIN` | Son restricciones QA, no plantilla para producción; valores no exportados |
| Integración actual | `MAYORISTA_SIGO_AUTH_URL`, `MAYORISTA_SIGO_AUTH_ANON_KEY`, `MAYORISTA_SIGO_ORIGIN`, `MAYORISTA_SIGO_PREVIEW_ORIGIN`, `MAYORISTA_SHARED_SOURCE_QA` | El runtime productivo debe distinguir configuración sin reutilizar el switch QA |
| Variables exclusivamente QA | `MAYORISTA_INTERACTIVE_QA`, `MAYORISTA_QA_SIGO_EMPRESA_ID`, familia `MAYORISTA_BOOTSTRAP_*`, resets/seeds/acceptance | Ausentes/desactivadas en cualquier publicación comercial |
| Supabase | Schema aprobado, RLS/ACL, Auth URL/redirects, auth.sessions, permisos, catálogo/flags/RPC, conexión TLS con pool acotado | Topología y rol runtime pendientes; no inventar DSN ni habilitar schema privado en Data API |
| Dominios/TLS/CORS | Origen SIGO y origen API definitivos, HTTPS válido, redirects Auth y origen PWA | No elegidos ni registrados; sin wildcard ni reflejar Origin. CORS actual acepta máximo 3 orígenes exactos |
| Empresa piloto | Tipo, flag, disponibilidad/destino aprobado, membresía/roles, fuente comercial, política comercial | Sin activación global ni copiar UUIDs/credenciales de QA |

Issuer/audience/llave de sesión, CA, rotación y recuperación deben definirse para el destino comercial. No reutilizar claves ni cuentas QA. Preservar siete días máximos offline y bloqueo al reconectar/vencer; revocación inmediata no es posible en un teléfono desconectado. El dominio PWA es parte del almacén: otro origen no hereda IndexedDB ni los dos pedidos del Android.

## Activación y onboarding comercial

Minorista sin registro de tipo se lee como minorista. Launcher no muestra Mayorista sin módulo confirmado; error RPC/red cae cerrado. Registrar tipo Mayorista/Mixto llama RPC con owner/admin y activa flag; no autoriza por preferencia local ni suscripción. Repetir la misma declaración no vuelve a habilitar un flag revocado por Matriz. Un cambio efectivo Mayorista→Mixto sí habilita nuevamente; revisar y documentar esa política con Matriz, no prometer un bloqueo irrevocable. Disponibilidad/destino son independientes del flag, y Matriz conserva override y auditoría.

Alta nueva: cuenta SIGO y empresa → trial SIGO existente → declaración comercial autorizada → destino y backend válidos → usuarios/roles/cuentas privadas → vendedor asignado → puesta en marcha reanudable → importación verificada → rutas/vehículos/listas/stock de apertura/objetivos → revisión final. Cada paso exige evidencia en contexto no-QA representativo. El asistente actual configura empresa ya autenticada; no crea infraestructura ni reemplaza alta SIGO. Registrar una empresa no prueba que pueda emitir pedidos desde el vendedor comercial.

## Textos y experiencia final

No quitar etiquetas QA del QA: evitan operar creyendo estar en producción. `qa-access.mjs` condiciona cuentas de prueba/PRUEBA P0 al origen QA exacto; el banner integrado depende de `qaAislado`. En futuro origen comercial deben estar ausentes, sin ocultar advertencias reales. Textos de simulación/homologación permanecen visibles mientras no haya emisión fiscal válida. El login comercial aún pide empresa/UUID: es bloqueo anterior, no un detalle cosmético. Mensajes comerciales de estado/errores y guías ya preparados; faltan revisión de datos de contacto/ayuda del piloto, dominio real y recorrido físico. No se sustituyen códigos técnicos por mensajes que oculten rechazo de permisos o crédito.

## Orden exacto de una publicación futura autorizada

1. Resolver bloqueos 1–6 y obtener GO de piloto con evidencia, condiciones de facturación y soporte acordadas. Cerrar lista de migraciones versionadas, target e imagen/SHA; aprobación de cambios concretos. Releer main y repetir integración si avanzó.
2. Verificar backup real, retención, cifrado, responsable, RPO/RTO acordados y restauración ensayada en destino autorizado. No restaurar encima de QA ni producción. Exportar definiciones/grants/config sin exponer secretos.
3. Mantener módulo/destino del piloto apagados. Ejecutar preflight sólo lectura en destino autorizado; comparar esquema/historial. Abortar si difiere de la copia ensayada. Revisar capacidad y permisos.
4. Aplicar grupos de migración revisados en el orden del inventario mediante ledger/hash, lock y transacciones. No ejecutar las fuentes QA directamente. Verificar cada COMMIT; ante fallo, rollback del grupo y detener. No limpiar datos ni reintentar DDL a ciegas.
5. Ejecutar postflight metadata, advisors y pruebas de RLS/roles en empresa sintética autorizada. Probar repetición del instalador: no-op por ledger; mismo UUID comercial con otro contenido debe rechazar.
6. Desplegar entrypoint productivo ya validado al destino existente autorizado, sin sembrar; health/readiness comprueban DB/config reales sin dependencia de P0 QA. Primero backend compatible, luego frontend SIGO sin variables QA. No hay tal entrypoint entregado en este HEAD.
7. Configurar origen HTTPS/CORS/Auth y destino piloto desde Matriz. Sin token en enlaces; comprobar rechazo de orígenes ajenos, sesión caducada/revocada y empresa ajena.
8. Ejecutar smoke sintético y regresión Minorista con módulo apagado. Activar sólo empresa piloto y probar onboarding+circuito completo+conciliación y exportación. No usar los dos pedidos reservados sin autorización expresa.
9. Observar ventana de operación acordada: errores/503/p95/recursos/pool/reintentos/stock/saldos. Registrar umbrales aprobados antes de activar: no hay SLO comercial consensuado, las mediciones CI no lo reemplazan.
10. Ampliar acceso únicamente con autorización posterior. Ni merge ni publicación se ejecutan durante esta preparación.

## Rollback y recuperación

- Antes de COMMIT: rollback transaccional del grupo. Conservar logs/hash y diagnosticar; nunca convertir un error en aprobación.
- Después de migración aditiva sin movimientos nuevos: desactivar módulo/disponibilidad de piloto y volver a aplicación anterior compatible. Conservar tablas/auditoría/ledger; no DROP ni revertir funciones compartidas sin comparar versiones.
- Con pedidos/ventas/cobros confirmados: detener nuevos envíos del piloto y conservar UUID/colas. No restaurar snapshot viejo sobre la base activa: borraría operaciones válidas. Conciliar y corregir hacia adelante; reintentar mismos UUID después de recuperación.
- Cambio de origen PWA/cifrado: conservar perfil y respaldo cifrado antes de migrar con consentimiento. No limpiar IndexedDB ni invalidar llaves para simular un rollback. Los dos pedidos Android quedan fuera del ensayo.
- Restore de proveedor es último recurso con autorización, ventana y punto de corte definidos, destino de restauración permitido y conciliación posterior. Persistencia PostgreSQL o SUCCESS no equivalen a backup recuperable.
- Revertir frontend/Matriz no revoca por sí solo tokens vigentes: deshabilitar módulo/destino y comprobar rechazo backend; revocar sesiones de ensayo si procede, sin afectar el teléfono reservado.

## Checklist

### Pre-publicación

- [ ] Main/HEAD/diff y CI del candidato final verificados; sin reemplazar cambios Minorista.
- [ ] Runtime/topología productivos implementados y validados sin guards QA retirados.
- [ ] Migraciones versionadas aprobadas, ledger/hashes y ensayo de instalación/repetición/drift/rollback.
- [ ] Advisors, RLS/roles y APIs reales con dos empresas; sin fixtures de permisos.
- [ ] Backup/restore ensayado; dominios/CORS/Auth/variables revisados sin secretos públicos.
- [ ] Alta comercial/vendedor sin UUID manual; trial y política piloto definidos.
- [ ] Fiscal/condiciones comerciales y soporte acordados; no cobros automáticos.
- [ ] Pruebas físicas del checklist existente terminadas antes del GO comercial.

### Publicación (requiere autorización futura)

- [ ] Snapshot/config/versiones y punto de corte registrados; módulo/destino apagados.
- [ ] Preflight → migraciones transaccionales → postflight/advisors.
- [ ] Backend real → frontend sin QA → health/readiness → smoke con módulo apagado.
- [ ] Activación explícita de una empresa piloto y cinco roles; fuente única confirmada.

### Post-publicación

- [ ] Minorista conserva navegación, venta/stock/caja/cuentas y permisos.
- [ ] Pedido/entrega/cobro/factura según alcance, conciliación exactamente una vez.
- [ ] Offline/edición/reintentos/revocación/aislamiento y exportación.
- [ ] Medir n/p50/p95/errores/recursos reales; revisar soporte e incidentes.

### Rollback

- [ ] Desactivar piloto y detener escrituras nuevas; conservar colas/evidencia.
- [ ] Volver a versión compatible, sin bajar DDL ni borrar movimientos.
- [ ] Conciliar y decidir corrección hacia adelante o restore autorizado.
- [ ] Verificar Minorista, roles, salud y recuperación antes de reabrir piloto.

## Matriz de disponibilidad para producción

| Función | Lista para producción | Física | Externo | Observación |
|---|---|---|---|---|
| Integración contra main | Sí para revisión | No | Main puede avanzar | Sin conflictos actuales, revisar de nuevo antes de publicar |
| Backend/topología real | No | No | Target/conexión autorizados | Runtime QA-only y fuente canónica en mismo pool |
| Migraciones | No; inventario preparado | No | Esquema/advisors/restore | 20 fuentes, no instalador productivo |
| Minorista sin Mayorista | Probado en CI | Recorrido piloto | Validación publicada | Fail-closed; integración/registro agrega controles |
| Activación Mayorista/Mixto/Matriz | Lógica probada | Recorrido roles | RPC/migración/destino reales | Flags separados de tipo y suscripción |
| Onboarding/importaciones/gerencia | Implementado y automatizado | Uso comercial | Runtime/migraciones | Alta y permisos reales aún por ensayar |
| Vendedor primer acceso comercial | No | Sí | Identidad/cuenta privada | Empresa UUID manual fuera de QA pendiente |
| Pedidos/offline/edición/idempotencia | Implementado y automatizado | Sí | Circuito publicado | Dos pedidos reservados intactos |
| Seguridad/roles/revocación | Probado en CI | Sí | Advisors/Auth/pool reales | No equivale a auditoría del proyecto productivo |
| Informes/XLSX | Implementado y automatizado | Excel cliente | Fuente real | Hasta 10.000 registros por archivo |
| Rendimiento | No acreditado en destino final | Android | HTTP/pool/infra | Mantener CI separado de Railway |
| Respaldo/recuperación | Local probado; proveedor pendiente | Otro perfil | Restore proveedor | No hay RPO/RTO acordados |
| Suscripción/trial | Preparación | No | Política piloto/pagos | Sin enforcement/cobros nuevos |
| Fiscal | Sólo simulación/homologación | Según piloto | Credenciales/alcance legal | ARCA productiva deshabilitada |
| Documentación de publicación | Sí | Checklist pendiente | Decisiones anteriores | Preparación no autoriza ni acredita despliegue |

No se modifica producción/main, no merge, no migraciones aplicadas, no servicios nuevos ni gastos. La prueba física postergada no impidió esta preparación; el NO-GO identifica también los bloqueos técnicos existentes y no los oculta como dependencias del usuario.
