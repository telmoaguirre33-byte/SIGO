/** Decimal arithmetic keeps exact multiples from jumping up because of binary floats. */
export const PASOS_REDONDEO = [0, 1, 10, 50, 100, 500] as const;

function fraccionDecimal(valor: number): [bigint, bigint] {
  const [mantisa, exponente = "0"] = String(valor).toLowerCase().split("e");
  const [entero, decimales = ""] = mantisa.split(".");
  const escala = decimales.length - Number(exponente);
  const numerador = BigInt(entero + decimales);
  return escala >= 0
    ? [numerador, 10n ** BigInt(escala)]
    : [numerador * 10n ** BigInt(-escala), 1n];
}

export function calcularPrecioConMargen(costo: number, margen: number, paso: number): number | null {
  if (!Number.isFinite(costo) || costo <= 0 || !Number.isFinite(margen) || margen < 0 || margen > 10000
    || !(PASOS_REDONDEO as readonly number[]).includes(paso)) return null;
  const [c, cd] = fraccionDecimal(costo);
  const [m, md] = fraccionDecimal(margen);
  const numerador = c * (100n * md + m);
  const denominador = cd * 100n * md;
  // Currency is persisted with two decimals. Upward rounding is applied to the
  // unrounded decimal result, matching PostgreSQL numeric/ceil exactly.
  const centavos = paso > 0
    ? ((numerador + denominador * BigInt(paso) - 1n) / (denominador * BigInt(paso))) * BigInt(paso) * 100n
    : (numerador * 200n + denominador) / (2n * denominador);
  if (centavos <= 0n || centavos > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(centavos) / 100;
}

/** No cost or additional markup is used when rounding an existing sale price. */
export function redondearPrecioVenta(precio: number, paso: number): number | null {
  return calcularPrecioConMargen(precio, 0, paso);
}
