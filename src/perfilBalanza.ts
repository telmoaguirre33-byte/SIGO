import { decodificarEtiquetaVariable, type FormatoEtiquetaVariable } from './etiquetasPesoVariable';
import { isLegacyDuplicateProduct, type BarcodeProduct } from './barcode';
import type { UnidadVenta } from './ventaPorMedidas';
export type PerfilBalanza = { version: 1; empresaId: string; habilitado: boolean; formato: FormatoEtiquetaVariable; productos: Array<{ plu: string; productoId: string }> };
export function validarPerfilBalanza(p: PerfilBalanza, empresaId: string): PerfilBalanza {
  if (!p || p.version !== 1 || !empresaId || p.empresaId !== empresaId || typeof p.habilitado !== 'boolean') throw new Error('Perfil de balanza de otra empresa o inválido.');
  const f = p.formato;
  if (!f || !/^\d{2}$/.test(f.prefijo) || !Number.isInteger(f.longitudPlu) || f.longitudPlu < 1 || f.longitudPlu > 8 || !['peso','unidad','importe'].includes(f.tipo) || ![1,10,100,1000].includes(f.divisor)) throw new Error('Formato de etiqueta inválido.');
  if (f.tipo === 'unidad' && f.divisor !== 1) throw new Error('Las unidades deben ser enteras.');
  if (!Array.isArray(p.productos) || !p.productos.length || p.productos.length > 5000) throw new Error('Vinculá al menos un PLU.');
  const vistos = new Set<string>();
  for (const x of p.productos) {
    if (!x || typeof x.plu !== 'string' || !new RegExp(`^\\d{${f.longitudPlu}}$`).test(x.plu) || typeof x.productoId !== 'string' || !x.productoId || vistos.has(x.plu)) throw new Error('PLU inválido o repetido. Conservá sus ceros iniciales.');
    vistos.add(x.plu);
  }
  return p;
}
/** Sólo formatos contiguos: prefijo + PLU + valor + dígito EAN13. No checksum interno. */
export function resolverLecturaBalanza(codigo: string, perfil: PerfilBalanza | null, empresaId: string, catalogo: readonly BarcodeProduct[], unidades: Readonly<Record<string, UnidadVenta | null>>) {
  if (!perfil || !perfil.habilitado) return null;
  validarPerfilBalanza(perfil, empresaId);
  if (!codigo.startsWith(perfil.formato.prefijo)) return null;
  const etiqueta = decodificarEtiquetaVariable(codigo, perfil.formato);
  if (etiqueta.tipo === 'importe') throw new Error('Esta etiqueta contiene importe, no peso. Ingresá el peso manualmente; SIGO no lo deduce del precio.');
  const vinculo = perfil.productos.find(x => x.plu === etiqueta.plu);
  const productos = vinculo ? catalogo.filter(p => p.id === vinculo.productoId && p.empresa_id === empresaId) : [];
  if (productos.length !== 1 || isLegacyDuplicateProduct(productos[0])) throw new Error('PLU sin producto único verificado en esta empresa.');
  const producto = productos[0];
  if (unidades[producto.id] !== (etiqueta.tipo === 'peso' ? 'kg' : 'unidad')) throw new Error('La unidad del producto no coincide con la etiqueta.');
  const cantidad = etiqueta.cantidadOImporte;
  if (!Number.isFinite(cantidad) || cantidad <= 0 || (etiqueta.tipo === 'unidad' && !Number.isInteger(cantidad)) || Math.abs(cantidad * 1000 - Math.round(cantidad * 1000)) > 1e-7) throw new Error('Cantidad de etiqueta inválida.');
  if (!Number.isFinite(Number(producto.precio_venta)) || Number(producto.precio_venta) <= 0) throw new Error('Producto sin precio válido.');
  if (producto.stock_actual == null || !Number.isFinite(Number(producto.stock_actual)) || Number(producto.stock_actual) < cantidad) throw new Error('Stock insuficiente para la etiqueta.');
  return { producto, cantidad };
}
