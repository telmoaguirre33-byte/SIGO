# Venta manual por medidas: entrega independiente

## Alcance

Candidato separado desde main `69f5ab52315df2c5d27e5b37d62066c201acaa29`. Reutiliza V4 y las pruebas aprobadas de venta manual, sin las reparaciones fiscales del PR96. No modifica PR88/PR96 ni otros productos o módulos de negocio.

- Productos: unidad canónica y precisión explícita; creación/edición atómica. Un producto nuevo por kg puede tener stock inicial válido. Un cambio semántico de unidad con stock o historial se bloquea, sin conversiones ni backfills.
- Caja: seleccionar un medible abre captura vacía; kg admite entrada visible g/kg, total y equivalente en vivo. Enter confirma, Esc cancela sin añadir; editar conserva la misma línea. No se añade 1 kg por defecto.
- F9/F10 conservan cobro y ticket común. Mientras existe editor incompleto o cobro incierto, F9–F12 no ejecutan otra operación. F11 mantiene el evento fiscal existente de main y F12 su ticket común. No se incorpora el nuevo flujo fiscal, snapshot de comprobantes, servidor privilegiado, flags, hardening ni configuración ARCA.
- El intento de cobro se guarda por empresa con clave y payload antes del RPC. Ante respuesta perdida y recarga, se recupera el mismo intento y exige reintento explícito, sin cobrar, imprimir ni emitir fiscal automáticamente.
- Servidor: valida cantidad finita y escala antes de convertir/agrupar, descuento de hasta dos decimales, unidad esperada y huella canónica. Agrupación, stock, caja y devoluciones usan importes persistidos. Devoluciones parciales conservan exactamente el subtotal histórico y los centavos; el reintento concurrente usa la misma operación.

Las unidades discretas/g/ml usan enteros, cm un decimal y kg/l/m/m2/m3 hasta tres. Stock legado fraccionario de productos discretos se conserva: vender 1 desde 10,5 deja 9,5, sin redondear ni aceptar una cantidad nueva fraccionaria. Editar otros atributos conserva stocks/límites legados sin regularizarlos automáticamente.

Los módulos puros de etiquetas permanecen sin activación: no se configura ningún prefijo/PLU, precio codificado, scanner especial, balanza ni hardware.

## Única migración funcional nueva

`supabase/migrations/20261022024847_manual_medidas_atomicas.sql`

SHA-256: `d525682cf0ac327221a389f4668748b40d6fd81e0a31b70c79e5b05a59312c21`

Sustituye, para esta entrega independiente, la propuesta no aplicada del PR88 `20261021_venta_medidas_rpc.sql`. No se incluye aquella versión ni se borra ninguna migración histórica de main. El snapshot de unidad de ventas nuevas es nullable para compatibilidad: no se inventan unidades ni huellas de devoluciones históricas ausentes.

No ejecutar `supabase db push --include-all`. El workflow productivo pasa a preflight **solo lectura**, sin aplicar, reparar historial ni cambiar Auth. Véase [procedimiento y bloqueos](MIGRACIONES_PREFLIGHT_SOLO_LECTURA.md). Las discrepancias históricas siguen siendo un bloqueo visible, no un fallo ocultado ni un permiso para reejecutar SQL histórico.

## Seguridad y activación pendientes

Publicar un PR, compilar o aprobar tests no habilita producción. Se requieren autorización concreta, backup/recuperación verificable, revisión del desacuerdo del historial, mecanismo selectivo revisado y aplicación explícita de V4. No desplegar la interfaz nueva contra una base sin sus RPC.

El acceso directo legado a productos requiere el cambio separado de [RLS de productos](productos-rls/LEEME_OPERACION_NO_AUTORIZADA.md), fuera de migrations y nunca autoaplicado por CI. Su candidato probado limita empresa/permiso y evita escrituras directas; no implementa masking completo de costo/stock dentro de la empresa. Conserva lecturas activas existentes. Otros accesos legados, incluido compras, no están resueltos por esta entrega. El rollback RLS reabre permisos amplios y exige autorización expresa.

La emisión fiscal y las pruebas físicas/homologación real continúan independientes. Conservar el contrato main no certifica que su flujo fiscal esté operativo.

## Validación y comandos

Ejecutar pruebas **después** del build, ya que los scripts existentes transforman fuentes:

```sh
npm ci --no-audit --no-fund
npm run build
npm run test:manual-medidas
node --test scripts/test-production-migration-gate.mjs
npm run test:admin-notifications
npm run verify:critical
npx playwright install --with-deps chromium
node scripts/test-venta-medidas-browser.mjs
```

Las pruebas de interfaz y cobro usan servicios simulados, origen `.invalid` y bloqueo de red ajena al fixture. No utilizan COMERCIAL, impresora ni ARCA real. El browser cubre selección/cancelación, 750 g, equivalencia kg, Enter repetido, edición, guard F9–F12, F9/F10 después del editor y los contratos F11/F12 main. Los 14 casos React/JSDOM de recuperación cubren por separado respuesta perdida, recarga y reintento seguro. La corrida real del candidato independiente debe verificarse en CI; un éxito del PR96 no la sustituye.

El SQL V4 inalterado ya pasó PostgreSQL 17.6 sintético: 196 pasos/781 aserciones, seis escenarios de concurrencia real, y pruebas de RLS separado. No se vuelven a declarar aplicadas en producción. Las huellas de build y las mutaciones deterministas se registran en la entrega técnica; no publicar automáticamente archivos transformados ajenos al alcance.

## Reversión

Antes de activar, conservar commit frontend anterior, definiciones/grants de funciones reemplazadas y plan de recuperación autorizado. Si hay que retirar la interfaz, revertir el commit frontend no debe borrar ventas, snapshots ni columnas nuevas. No existe un down SQL automático seguro que deshaga datos comerciales; la reversión de funciones y permisos requiere una intervención revisada y coordinada con ventas concurrentes. Nunca borrar o reescribir historial de migraciones para simular rollback.
