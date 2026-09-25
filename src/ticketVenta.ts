import { supabase } from "./supabase";

export type ConfigTicket = { empresa_id: string; nombre_negocio: string; direccion: string; logo_data_url: string | null };

export async function leerConfigTicket(empresaId: string): Promise<ConfigTicket | null> {
  const { data, error } = await supabase.from("configuracion_ticket_sigo")
    .select("empresa_id,nombre_negocio,direccion,logo_data_url").eq("empresa_id", empresaId).maybeSingle();
  if (error) throw error;
  return data as ConfigTicket | null;
}

export async function guardarConfigTicket(config: ConfigTicket): Promise<void> {
  const { error } = await supabase.from("configuracion_ticket_sigo").upsert(config, { onConflict: "empresa_id" });
  if (error) throw error;
}

export async function imprimirTicketVenta(empresaId: string, ventaId: string, formato: "58" | "80" | "a4" = "80"): Promise<void> {
  const popup = window.open("", "_blank", "width=420,height=680");
  if (!popup) throw new Error("Habilitá las ventanas emergentes para imprimir el ticket.");
  popup.document.title = "Preparando ticket…";
  const [{ data: venta, error: ventaError }, { data: items, error: itemsError }, config] = await Promise.all([
    supabase.from("ventas_sigo").select("id,numero,created_at,total,estado").eq("empresa_id",empresaId).eq("id",ventaId).single(),
    supabase.from("venta_items_sigo").select("cantidad,precio_unitario,subtotal,productos(nombre)").eq("empresa_id",empresaId).eq("venta_id",ventaId),
    leerConfigTicket(empresaId),
  ]);
  if (ventaError || itemsError || !venta || venta.estado !== "confirmada") { popup.close(); throw new Error("Sólo se puede imprimir una venta confirmada."); }
  const doc = popup.document;
  doc.title = `Ticket de venta ${venta.numero ?? venta.id.slice(0, 8)}`;
  const style = doc.createElement("style");
  style.textContent = `@page{size:${formato === "a4" ? "A4" : formato + "mm auto"};margin:${formato === "a4" ? "12mm" : "3mm"}} body{font:14px Arial,sans-serif;width:${formato === "a4" ? "180mm" : formato === "58" ? "50mm" : "72mm"};max-width:100%;margin:10px auto;color:#111}h2{text-align:center;font-size:18px}p{text-align:center}table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px dashed #aaa}td:last-child{text-align:right}hr{border:0;border-top:1px dashed #555}.logo{max-width:45mm;max-height:28mm;display:block;margin:0 auto}@media print{button{display:none}body{margin:0}}`;
  doc.head.appendChild(style);
  const add = (tag: string, content: string, parent: HTMLElement = doc.body) => { const el=doc.createElement(tag);el.textContent=content;parent.appendChild(el);return el; };
  if (config?.logo_data_url?.startsWith("data:image/")) { const logo=doc.createElement("img");logo.src=config.logo_data_url;logo.className="logo";logo.alt="Logo del comercio";doc.body.appendChild(logo); }
  add("h2",config?.nombre_negocio || "Comercio");
  if(config?.direccion)add("p",config.direccion);
  add("hr",""); add("p",`Ticket de venta Nº ${venta.numero ?? venta.id.slice(0, 8).toUpperCase()}`);
  add("p",new Date(venta.created_at).toLocaleString("es-AR"));
  const tabla=doc.createElement("table"); doc.body.appendChild(tabla);
  for(const item of items??[]) {const fila=doc.createElement("tr");const producto=Array.isArray(item.productos)?item.productos[0]:item.productos;add("td",`${item.cantidad} × ${producto?.nombre??"Artículo"}`,fila);add("td",`$ ${Number(item.subtotal).toLocaleString("es-AR",{minimumFractionDigits:2})}`,fila);tabla.appendChild(fila);}
  add("hr",""); add("h2",`Total $ ${Number(venta.total).toLocaleString("es-AR",{minimumFractionDigits:2})}`);
  add("p","COMPROBANTE NO FISCAL · No válido como factura.");
  const boton=add("button","Imprimir");boton.onclick=()=>popup.print();
  popup.focus();
}
