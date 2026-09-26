import { supabase } from "./supabase";

export type OfertaProducto = {
  id: string;
  empresa_id: string;
  producto_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  descuento_porcentaje: number;
};

export type OfertaGuardar = Pick<OfertaProducto, "producto_id" | "fecha_inicio" | "fecha_fin" | "descuento_porcentaje">;

export async function listarOfertasProductos(empresaId: string): Promise<OfertaProducto[]> {
  const resultado: OfertaProducto[] = [];
  const pagina = 1000;
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await supabase.from("ofertas_productos_sigo")
      .select("id,empresa_id,producto_id,fecha_inicio,fecha_fin,descuento_porcentaje")
      .eq("empresa_id", empresaId)
      .order("fecha_inicio", { ascending: false })
      .order("id", { ascending: true })
      .range(desde, desde + pagina - 1);
    if (error) throw new Error(error.message);
    resultado.push(...((data ?? []) as OfertaProducto[]));
    if ((data ?? []).length < pagina) break;
  }
  return resultado;
}

export async function guardarOfertasProductos(empresaId: string, ofertas: OfertaGuardar[]): Promise<void> {
  const { error } = await supabase.rpc("guardar_ofertas_productos_sigo", {
    p_empresa_id: empresaId,
    p_ofertas: ofertas,
  });
  if (error) throw new Error(error.message);
}

export function hoyArgentina(): string {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

export function precioConOferta(precioBase: number, descuento: number): number {
  return Math.round((precioBase * (1 - descuento / 100) + Number.EPSILON) * 100) / 100;
}

export function ofertaVigente(ofertas: OfertaProducto[], productoId: string, fecha = hoyArgentina()): OfertaProducto | undefined {
  return ofertas.find((oferta) => oferta.producto_id === productoId && oferta.fecha_inicio <= fecha && oferta.fecha_fin >= fecha);
}
