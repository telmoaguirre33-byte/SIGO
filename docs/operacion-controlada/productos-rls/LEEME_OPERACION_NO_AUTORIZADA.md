# Propuesta de operación controlada RLS de productos

Estado: preparada localmente, NO aplicada ni autorizada en producción. No está en supabase/migrations y no participa de despliegues automáticos.

## Alcance y límite

La lógica funcional es la misma del candidato sintético probado: retira las cuatro políticas permisivas y privilegios directos de PUBLIC/anon/authenticated; authenticated recibe únicamente SELECT de las 15 columnas inventariadas, bajo products.read de su empresa. Sin INSERT/UPDATE/DELETE/TRUNCATE directos. Owner/postgres y service_role conservan sus privilegios; las RPC SECURITY DEFINER mantienen el acceso como propietarias.

Esto elimina el acceso anónimo y cruzado entre empresas para consumidores ordinarios, pero no implementa masking intratenant: un miembro con products.read aún puede leer los costos, el stock y el precio concedidos. Tampoco corrige compras/detalle_compras legacy. Son riesgos pendientes, no garantías del parche.

Los consumidores directos de Minorista inspeccionados justifican las 15 columnas. No se inspeccionaron ni autorizaron cambios a Mayorista o integraciones externas. Confirmar su compatibilidad es un requisito para aplicar en una tabla compartida. Se necesita autorización expresa para RLS/ACL antes de ejecutar.

## Secuencia propuesta, no ejecutada

1. Confirmar alcance/autorización productiva específica, compatibilidad de consumidores y pruebas finales del artefacto exacto.
2. Ejecutar 01_PREFLIGHT_METADATA_READ_ONLY.sql, conservar resultado y cotejar snapshot_baseline.json. Cualquier drift detiene la operación.
3. Revisar que no haya trabajo concurrente sobre productos. Ejecutar 02_APLICAR_PRODUCTOS_RLS_NO_AUTORIZADO.sql completo con cliente fail-fast. Usa una única transacción, lock limitado a 5 segundos y statement_timeout 30 segundos; valida snapshot exacto de policies/ACL/owner/RLS/helper, aplica y comprueba privilegios efectivos antes de COMMIT.
4. Si hay error, hacer ROLLBACK y revisar; no omitir guardas ni continuar parcialmente. No hay autorización para probes mutantes en producción.
5. Verificación posterior solo por metadatos y smoke autorizado de lectura en sesión propia, sin consultas cross-tenant reales ni mutaciones comerciales.

## Rollback

03_ROLLBACK_SNAPSHOT_RIESGO_NO_AUTORIZADO.sql restaura exactamente el snapshot de políticas y grants revisado, únicamente si sigue presente el estado de este parche. Revoca primero los nuevos grants por columna. No revierte filas ni toca otras tablas. Aborta ante cambios posteriores.

PELIGRO: restaurar el snapshot reabre el acceso anon/cross-tenant y TRUNCATE previo. No es un rollback inocuo; exige decisión y autorización explícita. Preferir reparar hacia adelante cuando sea viable. El archivo no es permiso para ejecutarlo.

## Diferencia respecto del candidato sintético

Se quitó el marcador de entorno artificial, no las salvaguardas. Se agregaron guardas exactas de policies/ACL/owner/RLS/versión/helper, lock/timeout y postcondiciones efectivas. La lógica tenant/columnas no cambió. Estos wrappers exactos fueron validados en PostgreSQL 17.6 aislado: APPLY, suite completa de compatibilidad/RPC y ROLLBACK pasan. El rollback restauró las cuatro policies y ACL previas y retiró los 15 grants por columna. La evidencia reproducible se entrega separadamente del repositorio. Esta prueba no constituye autorización productiva.

El preflight de catálogo por medidas es independiente de este cambio. La compatibilidad de stock fraccional legado se resuelve en el flujo manual sin redondear ni convertir datos; RLS no modifica el catálogo.
