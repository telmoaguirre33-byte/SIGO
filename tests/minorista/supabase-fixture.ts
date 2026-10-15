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
  release() { this.pending.shift()?.(); } };

function response(data: any) { return { data, error: null }; }
function query(data: any) {
  const result: any = {};
  for (const key of ["select", "eq", "in", "order", "limit", "range", "gte", "lte", "is"]) result[key] = () => result;
  result.maybeSingle = result.single = () => Promise.resolve(response(null));
  result.then = (yes: any, no: any) => Promise.resolve(response(data)).then(yes, no);
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
      return new Promise((resolve) => state.pending.push(() => resolve(response("00000000-0000-4000-8000-000000000099"))));
    }
    if (name.startsWith("listar_")) return Promise.resolve(response([]));
    throw new Error(`UNEXPECTED_RPC_IN_ISOLATED_TEST:${name}`);
  },
  from(table: string) { return query(table === "productos" ? catalog : []); },
};
