import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260913224500_venta_sin_cliente_efectivo_segura.sql';
const source = fs.readFileSync(migrationPath, 'utf8');

const required = [
  "if p_medio_pago = 'cuenta_corriente' then",
  'if v_cliente.limite_credito is not null',
  "raise exception 'ACCOUNT_CURRENT_REQUIRES_CLIENT'",
  "insert into public.caja_movimientos_sigo",
  "values (p_empresa_id, v_venta_id, 'ingreso', p_medio_pago, v_total",
  'IDEMPOTENCY_CONFLICT',
];

for (const token of required) {
  if (!source.includes(token)) {
    throw new Error(`Sale no-client safety regression: missing ${token}`);
  }
}

const unsafeLegacy = /if\s+p_medio_pago\s*=\s*'cuenta_corriente'\s+and\s+v_cliente\.limite_credito/is;
if (unsafeLegacy.test(source)) {
  throw new Error('Sale no-client safety regression: unassigned v_cliente can be dereferenced in a boolean expression');
}

const outerGuard = source.indexOf("if p_medio_pago = 'cuenta_corriente' then");
const clientRead = source.indexOf('if v_cliente.limite_credito is not null', outerGuard);
if (outerGuard < 0 || clientRead < outerGuard) {
  throw new Error('Sale no-client safety regression: credit-limit read is not nested under cuenta_corriente control flow');
}

console.log('SIGO_SALE_NO_CLIENT_SAFETY_OK');
