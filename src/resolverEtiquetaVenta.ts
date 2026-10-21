import { decodificarEtiquetaVariable, type FormatoEtiquetaVariable } from "./etiquetasPesoVariable";
import type { BarcodeProduct } from "./barcode";

/** Resolver etiquetas únicamente contra un catálogo PLU explícito por empresa.
 * No convertir etiquetas con importe en cantidad sin verificar el precio de venta.
 */
export function resolverEtiquetaVenta(
  codigo: string,
  formato: FormatoEtiquetaVariable,
  productosPorPlu: ReadonlyMap<string, BarcodeProduct>,
): { producto: BarcodeProduct; cantidad: number } {
  const etiqueta = decodificarEtiquetaVariable(codigo, formato);
  const producto = productosPorPlu.get(etiqueta.plu);
  if (!producto) throw new Error("ETIQUETA_PLU_DESCONOCIDO");
  const precio = Number(producto.precio_venta);
  if (!Number.isFinite(precio) || precio <= 0) throw new Error("ETIQUETA_PRECIO_INVALIDO");
  if (etiqueta.tipo === "importe") {
    // No inferir gramos dividiendo un importe redondeado por el precio.
    // Requiere una operación explícita de precio variable en servidor.
    throw new Error("ETIQUETA_IMPORTE_REQUIERE_SERVIDOR");
  }
  const cantidad = etiqueta.tipo === "unidad" ? 1 : etiqueta.cantidadOImporte;
  if (!Number.isFinite(cantidad) || cantidad <= 0 || Math.round(cantidad * 1000) / 1000 !== cantidad) {
    throw new Error("ETIQUETA_CANTIDAD_INVALIDA");
  }
  if (producto.stock_actual == null || cantidad > Number(producto.stock_actual)) throw new Error("ETIQUETA_STOCK_INSUFICIENTE");
  return { producto, cantidad };
}
