import type { ProductoSigo } from './productos';
import { formatoStockMedida } from './ventaPorMedidas';

export function motivoBloqueoBaja(producto: Pick<ProductoSigo, 'nombre' | 'stock_actual' | 'unidad_medida'>): string | null {
  if (producto.stock_actual == null || !Number.isFinite(Number(producto.stock_actual))) {
    return `${producto.nombre}: no se pudo verificar el stock. Actualizá el catálogo antes de solicitar la baja.`;
  }
  if (Number(producto.stock_actual) !== 0) {
    return `${producto.nombre}: no se dio de baja porque tiene ${formatoStockMedida(Number(producto.stock_actual), producto.unidad_medida)} de stock. Sigue activo. Si la carga inicial o la unidad son incorrectas, hay que revisar esa carga y corregirla de forma controlada; no pongas el stock en cero sólo para ocultar el producto.`;
  }
  return null;
}
