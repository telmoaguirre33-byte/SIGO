import { cantidadPorMedida, normalizarUnidadVenta, type UnidadVenta } from "./ventaPorMedidas";

/** Configuración de venta por medidas, opt-in por producto.
 * El valor por defecto es sólo para altas por pieza, nunca para datos desconocidos.
 * Este módulo no escribe en Supabase ni habilita cobros fraccionarios por sí solo.
 */
export type ConfiguracionMedidaProducto = {
  productoId: string;
  unidadStock: UnidadVenta;
  unidadVenta: UnidadVenta;
  unidadesStockPorUnidadVenta: number;
};

export function configuracionPorDefecto(productoId: string): ConfiguracionMedidaProducto {
  return { productoId, unidadStock: "unidad", unidadVenta: "unidad", unidadesStockPorUnidadVenta: 1 };
}

export function validarConfiguracionMedida(config: ConfiguracionMedidaProducto): ConfiguracionMedidaProducto {
  if (!config.productoId.trim()) throw new Error("PRODUCTO_REQUERIDO");
  if (normalizarUnidadVenta(config.unidadStock) !== config.unidadStock || normalizarUnidadVenta(config.unidadVenta) !== config.unidadVenta) {
    throw new Error("UNIDAD_INVALIDA");
  }
  if (!Number.isFinite(config.unidadesStockPorUnidadVenta) || config.unidadesStockPorUnidadVenta <= 0) {
    throw new Error("EQUIVALENCIA_INVALIDA");
  }
  if (config.unidadStock !== config.unidadVenta || config.unidadesStockPorUnidadVenta !== 1) {
    throw new Error("CONVERSION_NO_HABILITADA");
  }
  return config;
}

export function stockRequeridoPorVenta(cantidad: number, config: ConfiguracionMedidaProducto): number {
  validarConfiguracionMedida(config);
  cantidadPorMedida(cantidad, config.unidadVenta);
  const resultado = cantidad * config.unidadesStockPorUnidadVenta;
  if (!Number.isFinite(resultado) || resultado <= 0) throw new Error("STOCK_INVALIDO");
  return resultado;
}
