# Preparación de activación exclusiva de lapizcito5 · NO EJECUTADA

Referencia de producto: `telmoaguirre33-byte/SIGO` en `a1d36afc1ab4ddbfc04a08ed587142c9f76a9c9b` (PR #78). Producción vigente informada por el coordinador: `d9a5a9dddb3910ba5a0c53e96c79caa0f6da71d9`, `www.sigo-gestion.com`. Este directorio prepara configuración; no publica código, no instala esquema y no contiene credenciales.

`reviewedBaseHead` identifica esa base de revisión. El `head` del release que incluya el guard aún no existe en esta preparación y queda nulo; después de integrar y verificar debe ser su SHA exacto de 40 caracteres, coherente con Railway y las evidencias. No reutilizar ni falsear el SHA base como SHA del release nuevo.

## Cambio mínimo por empresa

1. El coordinador verificó por metadata comercial el UUID REAL de lapizcito5, activa: `8728d172-7c1b-4de3-88ae-c20fc19c1fce`. Quedó consignado en el manifiesto sin aprobar activación. No seleccionar por coincidencia parcial del nombre ni reutilizar IDs QA.
2. Si el tipo canónico es Minorista o no existe una fila, cambiarlo a **Mixto**, preservando Minorista. Si ya es Mixto, conservarlo. La intención de coexistencia también recomienda Mixto si el estado previo fuese Mayorista; requerir revisión de ese caso antes de mutar.
3. El flag Mayorista de lapizcito5 ya está TRUE según metadata comercial: conservarlo. Hay dos flags TRUE adicionales que se preservan y 23 FALSE. Guardar Mixto cuando ya es Mixto NO vuelve a habilitar el módulo: `declarar_tipo_negocio_sigo` conserva el override posterior de Matriz; por eso la operación de Matriz se considera separada y sólo se requiere si el flag estuviese apagado.
4. Configurar `sigo_mayorista_destinos` sólo para ese UUID con un origen operativo comercial real y aprobado, URLs `/portal.html` y `/secure.html`. Mantener intacto `sigo_mayorista_destino_predeterminado`.
5. No escribir licencias, suscripciones, `empresa_usuarios`, permisos, otros módulos, stock, productos, ventas, caja ni ARCA. No insertar usuarios, membresías o fixtures. La primera sesión comercial válida genera la identidad nativa y vínculo canónico según los guards existentes; no se prepara ese estado con seeds.

## Bloqueos antes de una ejecución futura

- El HEAD correcto lee `leer_tipo_negocio_sigo` y rechaza Minorista; la copia local parcial de `company-config.ts` era anterior y no es evidencia de un defecto del HEAD.
- **El baseline a1d36a no tenía allowlist de empresas para su runtime comercial.** Este candidato incorpora la corrección indispensable, sin desplegarla: exige `allowedCompanyIds` en el perfil revisado vinculado por SHA256 y rechaza login/SSO/tokens/pedidos de empresas excluidas antes de escrituras o bootstrap. Junto al destino por empresa, es el control de este rollout; no cambia globalmente flags, tipos, permisos o RPC.
- Declarar Mayorista/Mixto puede encender un flag; **declarar tipo no equivale a habilitar el runtime** con esta propuesta. No se prometen restricciones adicionales sobre RPC Supabase directas. Sólo IDs con autorización expresa se incorporan al perfil: las dos flags TRUE previas se preservan pero no se convierten automáticamente en excepciones runtime. El código no contiene nombres o IDs comerciales en frontend.
- No habilitar mientras falten origen/backend comercial existente autorizado, integración/revisión del guard, perfil comercial aprobado, TLS/CA, rol runtime sin SUPERUSER/BYPASSRLS, migraciones/binding/ledger reconciliados y readiness del mismo HEAD. La metadata comercial PostgreSQL 17.6 confirma que aún no existen tipo/destinos/mayorista/ledger. `/health` no acredita readiness ni aceptación funcional. Si falta esquema, detener; estos scripts no lo instalan.
- Fuente única: SIGO/Auth y tablas comerciales en el mismo Supabase comercial. No copiar información del QA, no apuntar producción al Supabase de integración, no usar un espejo Railway de stock/ventas/caja. Si existe una fuente no `sigo` o una revocación administrativa, conciliar; no sobrescribirla.
- Las habilitaciones previas distintas de lapizcito5 deben tener evidencia de autorización; preservarlas mediante comparación del snapshot. Una habilitación inexplicada bloquea la operación, no se desactiva masivamente.

## Artefactos

- `activation-manifest.NO-ACTIVAR.json`: IDs de objetivo y dos flags previos verificados; SHA de release/destinos aún pendientes. No habilita nada ni infiere autorización de excepciones por sus flags TRUE.
- `perfil-comercial.NO-ACTIVAR.json`: perfil concreto no aprobado, lista sólo con lapizcito5 y Auth comercial público verificado; infraestructura/secretos pendientes quedan nulos. No incluye automáticamente las dos empresas con flags previos TRUE.
- `preflight-metadata.SOLO-LECTURA.sql`: inventario y snapshot de configuración exclusivamente. Parámetro psql `empresa_id` obligatorio; usar el ID ya resuelto. No lista clientes, usuarios, emails, ventas ni productos.
- `activate-lapizcito5.NO-EJECUTAR.sql`: plantilla transaccional que aborta sin plan, actor válido, snapshot idéntico y evidencia del guard de exclusividad. Termina con **ROLLBACK**. No es una migración ni un ejecutor remoto.
- `rollback-lapizcito5.NO-EJECUTAR.sql`: compensación limitada al mismo UUID, restaura presencia/ausencia y valores de las tres filas capturadas; exige snapshot posterior exacto y conserva auditoría. También termina con **ROLLBACK**. Requiere operador con DML autorizado y sesión atribuible, no elevación de grants.
- `variables.NO-APLICAR.json`: contratos públicos/privados y exclusiones QA sin valores secretos.
- `HEAD-SOURCES.json`: SHA de blobs de los archivos exactos consultados en GitHub.

## Uso futuro, sólo tras autorización concreta

Capturar el preflight desde el destino comercial ya verificado; conservar el JSON `snapshot` intacto. Completar manifiesto/plan y revisar origen, actor, IDs autorizados y evidencia de exclusividad. La plantilla recibe el JSON revisado desde `current_setting('sigo.prep.activation_plan',true)`; no lo carga por sí sola ni obtiene conexiones. No insertar JWTs ni impersonar usuarios en estos archivos. Se exige `auth.uid()` real/atribuible y Superadmin de Matriz. Una consola sin esa identidad falla cerrada.

Ensayar la transacción conservando ROLLBACK, guardar `ACTIVATION_AFTER` y revisar que cambian sólo las tres filas objetivo y los eventos de auditoría. Para ejecución real futura hace falta preparar y revisar una copia concreta con COMMIT y autorización; estos originales permanecen sin ejecutar. Conservar snapshot anterior/posterior fuera de logs públicos. El rollback no borra historia, no borra operación comercial realizada después, no revoca licencias y no modifica deploys. Si hay drift, detener y conciliar en vez de forzar.

El `expectedAfter` definitivo debe provenir de la ejecución efectivamente confirmada y de su estado posterior verificado; el snapshot de un ensayo ROLLBACK tiene otros timestamps y no sirve para compensar una ejecución posterior. Los snapshots protegidos cubren configuración, no acreditan ausencia de efectos de RPC/triggers desplegados: comparar previamente sus definiciones y triggers con las versiones aprobadas. Los locks son breves sobre configuración y pueden bloquear DML Matriz de otras empresas; usar una ventana sin cambios de configuración. Un timeout/deadlock revierte la transacción.

Este agente no consultó datos remotos ni ejecutó escrituras SQL, instalaciones, deploys, merge, push, commits, infraestructura, Android o P0. Sólo recibió metadata comercial del coordinador. La documentación Supabase por HTTP no fue accesible en este executor (proxy local no disponible); no se implementó ninguna función o esquema Supabase nuevo. La corrección de JavaScript y pruebas con dobles está incorporada en el commit candidato.
