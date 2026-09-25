export type ProductoPrecioCompra = { precio_venta?: number | null; margen_porcentaje?: number | null; costo_actual?: number | null; costo_ultima_compra?: number | null };
export type ModoPrecioCompra = "margen" | "precio";

export function numeroCompra(value: string | number | undefined | null): number {
  if (value == null || String(value).trim() === "") return NaN;
  const text = String(value).trim().replace(/\s/g, "");
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return NaN;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

export function redondearPrecioCompra(value: number): number {
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : NaN;
}

export function resolverPrecioCompra(
  costo: number,
  producto: ProductoPrecioCompra | undefined,
  margenEditado?: string,
  precioEditado?: string,
  modo: ModoPrecioCompra = "margen",
): { margen: number; precio: number } {
  if (modo === "precio" && precioEditado !== undefined) {
    const precio = numeroCompra(precioEditado);
    return { precio, margen: costo > 0 && Number.isFinite(precio) ? (precio / costo - 1) * 100 : NaN };
  }
  const costoAnterior = Number(producto?.costo_actual ?? producto?.costo_ultima_compra ?? 0);
  const precioAnterior = Number(producto?.precio_venta ?? 0);
  const margenBase = producto?.margen_porcentaje != null ? Number(producto.margen_porcentaje)
    : costoAnterior > 0 && precioAnterior > 0 ? (precioAnterior / costoAnterior - 1) * 100 : NaN;
  const margen = margenEditado !== undefined ? numeroCompra(margenEditado) : margenBase;
  return { margen, precio: costo > 0 ? redondearPrecioCompra(costo * (1 + margen / 100)) : NaN };
}

export function textoNumeroCompra(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}
