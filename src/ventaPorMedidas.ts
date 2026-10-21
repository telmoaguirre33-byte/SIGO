/** Motor independiente de cantidades y unidades comerciales.
 * No altera Caja ni los datos persistidos hasta integrar y validar la migración.
 */
export const UNIDADES_VENTA = {
  unidad: { nombre: "Unidad", decimales: 0 },
  kg: { nombre: "Kilogramo", decimales: 3 },
  g: { nombre: "Gramo", decimales: 0 },
  l: { nombre: "Litro", decimales: 3 },
  ml: { nombre: "Mililitro", decimales: 0 },
  m: { nombre: "Metro", decimales: 3 },
  cm: { nombre: "Centímetro", decimales: 1 },
  m2: { nombre: "Metro cuadrado", decimales: 3 },
  m3: { nombre: "Metro cúbico", decimales: 3 },
  docena: { nombre: "Docena", decimales: 0 },
  caja: { nombre: "Caja", decimales: 0 },
  bolsa: { nombre: "Bolsa", decimales: 0 },
  paquete: { nombre: "Paquete", decimales: 0 },
  rollo: { nombre: "Rollo", decimales: 0 },
  bandeja: { nombre: "Bandeja", decimales: 0 },
  atado: { nombre: "Atado", decimales: 0 },
} as const;

export type UnidadVenta = keyof typeof UNIDADES_VENTA;
export const RUBROS_VENTA = [
  "Carnicería", "Verdulería", "Heladería", "Naturista", "Panadería",
  "Fiambrería", "Ferretería", "Corralón", "Pinturería", "Mercería",
  "Pet Shop", "Limpieza", "Almacén", "Granja", "Bulonería",
  "Electricidad", "Sanitarios", "Forrajería", "Cotillón", "Otros",
] as const;

export function cantidadPorMedida(entrada: string | number, unidad: UnidadVenta): number {
  const texto = String(entrada).trim().replace(",", ".");
  if (!/^(?:\d+)(?:\.\d+)?$/.test(texto)) throw new Error("CANTIDAD_INVALIDA");
  const cantidad = Number(texto);
  const decimales = UNIDADES_VENTA[unidad].decimales;
  if (!Number.isFinite(cantidad) || cantidad <= 0 || Math.round(cantidad * 10 ** decimales) / 10 ** decimales !== cantidad) {
    throw new Error("CANTIDAD_INVALIDA");
  }
  return cantidad;
}

export function convertirMedida(cantidad: number, origen: UnidadVenta, destino: UnidadVenta): number {
  const factores: Partial<Record<UnidadVenta, number>> = { kg: 1000, g: 1, l: 1000, ml: 1, m: 100, cm: 1 };
  const grupos: Partial<Record<UnidadVenta, string>> = { kg: "masa", g: "masa", l: "volumen", ml: "volumen", m: "longitud", cm: "longitud" };
  if (origen === destino) return cantidad;
  if (!grupos[origen] || grupos[origen] !== grupos[destino]) throw new Error("UNIDADES_INCOMPATIBLES");
  return cantidad * factores[origen]! / factores[destino]!;
}

export function subtotalMedida(cantidad: number, precioPorUnidad: number): number {
  if (!Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precioPorUnidad) || precioPorUnidad < 0) {
    throw new Error("IMPORTE_INVALIDO");
  }
  return Math.round((cantidad * precioPorUnidad + Number.EPSILON) * 100) / 100;
}

/** Consolida cantidades en la unidad base del producto sin perder milésimas.
 * No reemplaza la validación transaccional de stock en Supabase.
 */
export function consolidarCantidadMedida(
  cantidades: readonly number[],
  unidad: UnidadVenta,
  stockDisponible: number,
): number {
  const factor = 10 ** UNIDADES_VENTA[unidad].decimales;
  if (!Number.isFinite(stockDisponible) || stockDisponible < 0) throw new Error("STOCK_INVALIDO");
  const enteros = cantidades.map((cantidad) => {
    if (!Number.isFinite(cantidad) || cantidad <= 0 || Math.round(cantidad * factor) !== cantidad * factor) {
      throw new Error("CANTIDAD_INVALIDA");
    }
    return Math.round(cantidad * factor);
  });
  const total = enteros.reduce((suma, cantidad) => suma + cantidad, 0);
  if (!Number.isSafeInteger(total) || total > Math.round(stockDisponible * factor)) throw new Error("STOCK_INSUFICIENTE");
  return total / factor;
}
