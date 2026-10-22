/** Cantidades en la única unidad base de cada producto. No conecta hardware. */
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

/** Nunca interpreta una unidad ausente/desconocida como una pieza. */
export function normalizarUnidadVenta(entrada: unknown): UnidadVenta | null {
  if (typeof entrada !== "string") return null;
  const unidad = entrada.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UNIDADES_VENTA, unidad) ? unidad as UnidadVenta : null;
}

function factorUnidad(unidad: UnidadVenta): number {
  if (!Object.prototype.hasOwnProperty.call(UNIDADES_VENTA, unidad)) throw new Error("UNIDAD_INVALIDA");
  return 10 ** UNIDADES_VENTA[unidad].decimales;
}

export function pasoCantidadMedida(unidad: UnidadVenta): number {
  return 1 / factorUnidad(unidad);
}

/** Lleva una cantidad a enteros sin redondear precisión comercial no permitida. */
export function cantidadEscaladaMedida(cantidad: number, unidad: UnidadVenta, permitirCero = false): number {
  const escalada = cantidad * factorUnidad(unidad);
  const entero = Math.round(escalada);
  // Sólo tolera el ruido IEEE-754 de sumas como 0,1 + 0,2.
  const tolerancia = Math.max(1e-8, Math.abs(escalada) * Number.EPSILON * 4);
  if (!Number.isFinite(cantidad) || cantidad < 0 || (!permitirCero && cantidad === 0)
    || !Number.isSafeInteger(entero) || (!permitirCero && entero <= 0)
    || Math.abs(escalada - entero) > tolerancia) throw new Error("CANTIDAD_INVALIDA");
  return entero;
}

export function cantidadPorMedida(entrada: string | number, unidad: UnidadVenta): number {
  const factor = factorUnidad(unidad);
  if (typeof entrada === "number") return cantidadEscaladaMedida(entrada, unidad) / factor;
  const texto = entrada.trim().replace(",", ".");
  if (!/^(?:\d+)(?:\.\d+)?$/.test(texto)) throw new Error("CANTIDAD_INVALIDA");
  const fraccion = (texto.split(".")[1] ?? "").replace(/0+$/, "");
  if (fraccion.length > UNIDADES_VENTA[unidad].decimales) throw new Error("CANTIDAD_INVALIDA");
  return cantidadEscaladaMedida(Number(texto), unidad) / factor;
}

/** Única comodidad de captura: gramos enteros para un producto cuyo stock y precio siguen en kg. */
export function cantidadManualMedida(entrada: string, unidadBase: UnidadVenta, unidadEntrada: UnidadVenta = unidadBase): number {
  if (unidadBase === "kg" && unidadEntrada === "g") return cantidadPorMedida(entrada, "g") / 1000;
  if (unidadEntrada !== unidadBase) throw new Error("UNIDADES_INCOMPATIBLES");
  return cantidadPorMedida(entrada, unidadBase);
}

/** Utilidad aislada: la venta manual no realiza conversiones entre unidades. */
export function convertirMedida(cantidad: number, origen: UnidadVenta, destino: UnidadVenta): number {
  if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error("CANTIDAD_INVALIDA");
  factorUnidad(origen); factorUnidad(destino);
  const factores: Partial<Record<UnidadVenta, number>> = { kg: 1000, g: 1, l: 1000, ml: 1, m: 100, cm: 1 };
  const grupos: Partial<Record<UnidadVenta, string>> = { kg: "masa", g: "masa", l: "volumen", ml: "volumen", m: "longitud", cm: "longitud" };
  if (origen === destino) return cantidad;
  if (!grupos[origen] || grupos[origen] !== grupos[destino]) throw new Error("UNIDADES_INCOMPATIBLES");
  return cantidad * factores[origen]! / factores[destino]!;
}

export function subtotalMedida(cantidad: number, precioPorUnidad: number): number {
  const bruto = cantidad * precioPorUnidad;
  const resultado = Math.round((bruto + Math.abs(bruto) * Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precioPorUnidad) || precioPorUnidad < 0 || !Number.isFinite(resultado)) {
    throw new Error("IMPORTE_INVALIDO");
  }
  return resultado;
}

/** Replica SQL: oferta redondeada por unidad, luego descuento global redondeado por unidad. */
export function precioUnitarioConDescuentosMedida(precio: number, descuentoOferta = 0, descuentoVenta = 0): number {
  if (!Number.isFinite(precio) || precio <= 0 || !Number.isFinite(descuentoOferta) || descuentoOferta < 0 || descuentoOferta > 99.99
    || !Number.isFinite(descuentoVenta) || descuentoVenta < 0 || descuentoVenta > 99.99) throw new Error("IMPORTE_INVALIDO");
  const conOferta = descuentoOferta > 0 ? subtotalMedida(1, precio * (1 - descuentoOferta / 100)) : precio;
  return subtotalMedida(1, conOferta * (1 - descuentoVenta / 100));
}

/** Consolida en enteros; no reemplaza la validación transaccional de stock. */
export function consolidarCantidadMedida(cantidades: readonly number[], unidad: UnidadVenta, stockDisponible: number): number {
  let stock: number;
  try { stock = cantidadEscaladaMedida(stockDisponible, "kg", true); }
  catch { throw new Error("STOCK_INVALIDO"); }
  // El legado puede contener stock fraccional aun en piezas. No lo redondeamos ni
  // reinterpretamos: sólo la nueva cantidad vendida debe respetar su unidad.
  const total = cantidades.reduce((suma, cantidad) => {
    cantidadEscaladaMedida(cantidad, unidad);
    return suma + cantidadEscaladaMedida(cantidad, "kg");
  }, 0);
  if (!Number.isSafeInteger(total)) throw new Error("CANTIDAD_INVALIDA");
  if (total > stock) throw new Error("STOCK_INSUFICIENTE");
  return total / 1000;
}

export function stockRestanteMedida(stock: number, cantidades: readonly number[], unidad: UnidadVenta): number {
  const total = consolidarCantidadMedida(cantidades, unidad, stock);
  return (cantidadEscaladaMedida(stock, "kg", true) - cantidadEscaladaMedida(total, "kg", true)) / 1000;
}

/** NULL histórico se muestra sin unidad; nunca se consulta la unidad actual del producto. */
export function formatoCantidadMedida(cantidad: number, unidadSnapshot: unknown): string {
  const unidad = normalizarUnidadVenta(unidadSnapshot);
  const texto = Number(cantidad).toLocaleString("es-AR", { maximumFractionDigits: unidad ? UNIDADES_VENTA[unidad].decimales : 3 });
  return unidad ? `${texto} ${unidad}` : texto;
}

/** El stock legado puede tener fracciones incluso en productos que se venden enteros. */
export function formatoStockMedida(stock: number, unidadSnapshot: unknown): string {
  const unidad = normalizarUnidadVenta(unidadSnapshot);
  const texto = Number(stock).toLocaleString("es-AR", { maximumFractionDigits: 3 });
  return unidad ? `${texto} ${unidad}` : texto;
}
