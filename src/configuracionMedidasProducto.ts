import { UNIDADES_VENTA, type UnidadVenta } from "./ventaPorMedidas";

/** Configuración de venta por medidas, opt-in por producto.
 * Los productos históricos continúan como unidades.
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
  if (!(config.unidadStock in UNIDADES_VENTA) || !(config.unidadVenta in UNIDADES_VENTA)) {
    throw new Error("UNIDAD_INVALIDA");
  }
  if (!Number.isFinite(config.unidadesStockPorUnidadVenta) || config.unidadesStockPorUnidadVenta <= 0) {
    throw new Error("EQUIVALENCIA_INVALIDA");
  }
  return config;
}

export function stockRequeridoPorVenta(cantidad: number, config: ConfiguracionMedidaProducto): number {
  validarConfiguracionMedida(config);
  if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error("CANTIDAD_INVALIDA");
  const resultado = cantidad * config.unidadesStockPorUnidadVenta;
  if (!Number.isFinite(resultado) || resultado <= 0) throw new Error("STOCK_INVALIDO");
  return resultado;
}
