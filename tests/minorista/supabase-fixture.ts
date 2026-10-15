// Catálogo en memoria. EAN/nombres contrastados por SELECT con COMERCIAL;
// UUID/empresa/precio/stock son ficticios. Ninguna llamada alcanza una base real.
const empresa_id = "00000000-0000-4000-8000-000000000001";
const base = { empresa_id, codigo_interno: null, descripcion: null, marca: "QA", categoria: "Librería",
  proveedor: null, costo_actual: 10, costo_ultima_compra: 10, precio_venta: 100, margen_ganancia: 90,
  margen_porcentaje: 900, stock_actual: 100, stock_minimo: 1, stock_maximo: 200 };
export const catalog = [
  { ...base, id: "00000000-0000-4000-8000-000000000011", nombre: "PINTURA TELA BLANCO", codigo_barras: "7790413400018" },
  { ...base, id: "00000000-0000-4000-8000-000000000012", nombre: "COMPAS PIZZINI", codigo_barras: "7793198500065" },
  { ...base, id: "00000000-0000-4000-8000-000000000013", nombre: "CÓDIGO CON CEROS", codigo_barras: "000012340009", codigo_interno: "QA-A001" },
];
export const state = { calls: [] as any[], pending: [] as (() => void)[], delay: false, confirmations: [] as any[], fiscalEvents: [] as any[],
  sales: [] as any[], items: [] as any[], receipts: [] as any[], fiscalRequests: [] as any[],
  release() { this.pending.shift()?.(); } };

function response(data: any) { return { data, error: null }; }
function query(data: any) {
  let filtered = [...data];
  const result: any = {};
  result.eq = (key: string, value: any) => { filtered = filtered.filter((r: any) => r[key] === value); return result; };
  result.in = (key: string, values: any[]) => { filtered = filtered.filter((r: any) => values.includes(r[key])); return result; };
  result.limit = (n: number) => { filtered = filtered.slice(0, n); return result; };
  result.order = (key: string, opts: any = {}) => { filtered.sort((a: any, b: any) => (String(a[key]) > String(b[key]) ? 1 : -1) * (opts.ascending === false ? -1 : 1)); return result; };
  for (const key of ["select", "range", "gte", "lte", "is"]) result[key] = () => result;
  result.maybeSingle = result.single = () => Promise.resolve(response(filtered[0] ?? null));
  result.then = (yes: any, no: any) => Promise.resolve(response(filtered)).then(yes, no);
  for (const key of ["insert", "update", "upsert", "delete"]) result[key] = () => { throw new Error("REAL_WRITES_FORBIDDEN_IN_TEST"); };
  return result;
}
export const supabase: any = {
  rpc(name: string, params: any) {
    state.calls.push({ name, ...params });
    if (name === "buscar_producto_codigo_sigo") {
      const data = catalog.filter((p) => p.empresa_id === params.p_empresa_id &&
        (p.codigo_barras === params.p_codigo || p.codigo_interno === params.p_codigo ||
          (p.id === catalog[0].id && params.p_codigo === "9912345678901")));
      return state.delay ? new Promise((resolve) => state.pending.push(() => resolve(response(data)))) : Promise.resolve(response(data));
    }
    if (name === "listar_productos_sigo") return query(catalog);
    if (name === "confirmar_venta_sigo_v2") {
      state.confirmations.push(params);
      return new Promise((resolve) => state.pending.push(() => {
        const id = "00000000-0000-4000-8000-000000000099";
        const items = params.p_items.map((i: any) => {
          const product = catalog.find((p) => p.id === i.producto_id)!;
          return { empresa_id, venta_id: id, producto_id: product.id, productos: { nombre: product.nombre }, cantidad: i.cantidad,
            precio_unitario: 100 * (1 - (params.p_descuento_pct || 0) / 100), subtotal: i.cantidad * 100 * (1 - (params.p_descuento_pct || 0) / 100) };
        });
        state.items.push(...items);
        state.sales.push({ id, empresa_id, numero: 123, estado: "confirmada", anulada_at: null, cliente_id: null,
          medio_pago: params.p_medio_pago, created_at: "2026-10-15T12:30:00Z", total: items.reduce((n: number, i: any) => n + i.subtotal, 0) });
        resolve(response(id));
      }));
    }
    if (name.startsWith("listar_")) return Promise.resolve(response([]));
    throw new Error(`UNEXPECTED_RPC_IN_ISOLATED_TEST:${name}`);
  },
  auth: { getSession: async () => ({ data: { session: { access_token: "isolated-fixture-token" } }, error: null }) },
  from(table: string) {
    const data: Record<string, any[]> = { productos: catalog, ventas_sigo: state.sales, venta_items_sigo: state.items,
      arca_comprobantes: state.receipts, empresas: [{ id: empresa_id, nombre: "QA AISLADA", razon_social: "COMERCIO QA" }],
      configuracion_ticket_sigo: [{ empresa_id, nombre_negocio: "COMERCIO QA", direccion: "Calle QA 123" }],
      arca_config: [{ empresa_id, ambiente: "produccion", activo: true, ultima_prueba_ok: true }],
      arca_puntos_venta: [{ empresa_id, ambiente: "produccion", activo: true, numero: 1 }] };
    return query(data[table] || []);
  },
};
