import { supabase } from "./supabase";

export type RankingProductoSigo = { productoId: string; nombre: string; unidades: number; importe: number };
type VentaRow = { id?: string | null };
type ItemRow = { producto_id?: string | null; cantidad?: number | string | null; subtotal?: number | string | null; productos?: { nombre?: string | null } | Array<{ nombre?: string | null }> | null };

export async function cargarRankingProductosSigo(empresaId: string, desde: string, hasta: string): Promise<RankingProductoSigo[]> {
  if (!empresaId) throw new Error("Seleccioná una empresa activa.");
  const inicio = new Date(`${desde}T00:00:00`);
  const fin = new Date(`${hasta}T23:59:59.999`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime()) || inicio > fin) throw new Error("Rango de fechas inválido.");

  const ventas: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("ventas_sigo").select("id").eq("empresa_id", empresaId).eq("estado", "confirmada")
      .gte("created_at", inicio.toISOString()).lte("created_at", fin.toISOString()).range(offset, offset + 999);
    if (error) throw error;
    const lote = (data ?? []) as VentaRow[];
    for (const v of lote) if (v.id) ventas.push(v.id);
    if (lote.length < 1000) break;
  }
  if (!ventas.length) return [];

  const acumulado = new Map<string, RankingProductoSigo>();
  for (let i = 0; i < ventas.length; i += 200) {
    const { data, error } = await supabase.from("venta_items_sigo")
      .select("producto_id,cantidad,subtotal,productos(nombre)").eq("empresa_id", empresaId).in("venta_id", ventas.slice(i, i + 200));
    if (error) throw error;
    for (const item of (data ?? []) as ItemRow[]) {
      const id = String(item.producto_id ?? "");
      if (!id) continue;
      const rel = Array.isArray(item.productos) ? item.productos[0] : item.productos;
      const actual = acumulado.get(id) ?? { productoId: id, nombre: String(rel?.nombre ?? "Producto sin nombre"), unidades: 0, importe: 0 };
      actual.unidades += Number(item.cantidad ?? 0) || 0;
      actual.importe += Number(item.subtotal ?? 0) || 0;
      acumulado.set(id, actual);
    }
  }
  return Array.from(acumulado.values());
}
