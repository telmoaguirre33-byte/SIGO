import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

let sequence = 0;
async function moduloConRpc(rpc, archivo = "productos", extras = "") {
  const key = `__medidas_test_${++sequence}`;
  globalThis[key] = { rpc(...args) {
    let range;
    const request = {
      order() { return request; },
      range(from, to) { range = [from, to]; return request; },
      then(resolve, reject) { return Promise.resolve().then(() => rpc(...args, range)).then(resolve, reject); },
    };
    return request;
  }, from() { throw new Error("No se esperaba acceso directo a tablas"); } };
  let source = await readFile(new URL(`../src/${archivo}.ts`, import.meta.url), "utf8");
  source = source.replace('import { supabase } from "./supabase";', `const supabase = globalThis[${JSON.stringify(key)}];`)
    .replaceAll('from "./ventaPorMedidas"', `from ${JSON.stringify(new URL("../src/ventaPorMedidas.ts", import.meta.url).href)}`)
    .replace('import { listarProductosSigo } from "./productos";', 'const listarProductosSigo = async () => [];');
  const js = stripTypeScriptTypes(source + extras, { mode: "transform" });
  const result = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  delete globalThis[key];
  return result;
}
const input = { empresaId: "empresa-1", nombre: "Queso", precioVenta: 123.45, stockActual: 1.5, unidadMedida: "kg" };
const producto = { id: "producto-1", empresa_id: "empresa-1", nombre: "Queso", activo: true, costo_actual: 0, costo_ultima_compra: 0, precio_venta: 123.45, stock_actual: 1.5 };

test("catálogo nunca transforma unidad desconocida o error RPC en unidad", async () => {
  for (const respuesta of [
    { data: [{ producto_id: producto.id, unidad_medida: "desconocida" }], error: null },
    { data: [], error: null },
    { data: null, error: { message: "Falló la conexión" } },
  ]) {
    const { listarProductosSigo } = await moduloConRpc(async (nombre) => nombre === "listar_productos_sigo" ? { data: [producto], error: null } : respuesta);
    assert.equal((await listarProductosSigo("empresa-1"))[0].unidad_medida, null);
  }
});

test("alta producto+unidad usa una sola escritura atómica y verifica unidad", async () => {
  const llamadas = [];
  const { guardarProductoSigo } = await moduloConRpc(async (nombre, params) => {
    llamadas.push({ nombre, params });
    if (nombre === "guardar_producto_medida_sigo") return { data: producto.id, error: null };
    if (nombre === "verificar_producto_guardado_sigo") return { data: [producto], error: null };
    if (nombre === "listar_unidades_producto_sigo") return { data: [{ producto_id: producto.id, unidad_medida: "kg" }], error: null };
    throw new Error(`RPC no permitida: ${nombre}`);
  });
  assert.equal(await guardarProductoSigo(input), producto.id);
  assert.equal(llamadas[0].params.p_unidad_medida, "kg");
  assert.equal(llamadas[0].params.p_stock_actual, 1.5);
  assert.deepEqual(llamadas.map((x) => x.nombre), ["guardar_producto_medida_sigo", "verificar_producto_guardado_sigo", "listar_unidades_producto_sigo"]);
});

test("wrapper ausente no cae al guardado antiguo ni a unidad separada", async () => {
  const llamadas = [];
  const { guardarProductoSigo } = await moduloConRpc(async (nombre) => {
    llamadas.push(nombre);
    return { data: null, error: { code: "PGRST202", message: "Could not find guardar_producto_medida_sigo" } };
  });
  await assert.rejects(guardarProductoSigo(input), /No se guardó el producto/);
  assert.deepEqual(llamadas, ["guardar_producto_medida_sigo"]);
});

test("unidad incorrecta postguardado es resultado incierto, no éxito ni segunda escritura", async () => {
  const llamadas = [];
  const modulo = await moduloConRpc(async (nombre) => {
    llamadas.push(nombre);
    if (nombre === "guardar_producto_medida_sigo") return { data: producto.id, error: null };
    if (nombre === "verificar_producto_guardado_sigo") return { data: [producto], error: null };
    return { data: [{ producto_id: producto.id, unidad_medida: "unidad" }], error: null };
  });
  await assert.rejects(modulo.guardarProductoSigo(input), (err) => err instanceof modulo.ProductoGuardadoSinVerificarError && err.productoId === producto.id && /No repitas el alta/.test(err.message));
  assert.equal(llamadas.filter((x) => x.startsWith("guardar")).length, 1);
});

test("edición de precio sin unidad explícita conserva unidad del producto", async () => {
  const llamadas = [];
  const { guardarProductoSigo } = await moduloConRpc(async (nombre, params) => {
    llamadas.push({ nombre, params });
    if (nombre === "guardar_producto_medida_sigo") return { data: producto.id, error: null };
    if (nombre === "verificar_producto_guardado_sigo") return { data: [producto], error: null };
    return { data: [{ producto_id: producto.id, unidad_medida: "kg" }], error: null };
  });
  await guardarProductoSigo({ empresaId: "empresa-1", productoId: producto.id, nombre: "Queso", precioVenta: 200 });
  assert.equal(llamadas[0].params.p_unidad_medida, null);
  assert.equal(llamadas[0].params.p_stock_actual, null);
});

test("stock inválido se rechaza antes de cualquier escritura", async () => {
  const { guardarProductoSigo } = await moduloConRpc(() => { throw new Error("No debe escribir"); });
  await assert.rejects(guardarProductoSigo({ ...input, stockActual: 0.0001 }), /precisión/);
});

test("venta consolida duplicados en enteros y preserva exactamente milésimas", async () => {
  const { consolidarItemsVenta } = await moduloConRpc(() => {}, "ventas", "\nexport { consolidarItemsVenta };\n");
  assert.deepEqual(consolidarItemsVenta([{ productoId: "p", cantidad: 0.1 }, { productoId: "p", cantidad: 0.2 }]), [{ productoId: "p", cantidad: 0.3 }]);
  assert.throws(() => consolidarItemsVenta([{ productoId: "p", cantidad: 0.0001 }]), /tres decimales/);
  assert.throws(() => consolidarItemsVenta([{ productoId: "p", cantidad: Number.MAX_SAFE_INTEGER }]), /tres decimales/);
});

test("catálogo y unidades paginan más de 1000 productos sin omitir el peso", async () => {
  const catalogo = Array.from({ length: 1001 }, (_, i) => ({ ...producto, id: `p-${i}` }));
  const rangos = [];
  const { listarProductosSigo } = await moduloConRpc(async (nombre, params, range) => {
    rangos.push([nombre, ...range]);
    const source = nombre === "listar_productos_sigo" ? catalogo : catalogo.map((p) => ({ producto_id: p.id, unidad_medida: "kg" }));
    return { data: source.slice(range[0], range[1] + 1), error: null };
  });
  const cargados = await listarProductosSigo("empresa-1");
  assert.equal(cargados.length, 1001);
  assert.equal(cargados[1000].unidad_medida, "kg");
  assert.equal(rangos.length, 4);
});

test("excepción de transporte durante escritura bloquea reenvío optimista", async () => {
  let escrituras = 0;
  const modulo = await moduloConRpc(async () => { escrituras++; throw new Error("Failed to fetch"); });
  await assert.rejects(modulo.guardarProductoSigo(input), (err) => err instanceof modulo.ProductoGuardadoSinVerificarError && /No repitas el alta/.test(err.message));
  assert.equal(escrituras, 1);
});

test("carrito preserva unidad esperada y rechaza consolidación incompatible", async () => {
  const { consolidarItemsVenta } = await moduloConRpc(() => {}, "ventas", "\nexport { consolidarItemsVenta };\n");
  assert.deepEqual(consolidarItemsVenta([{ productoId: "p", cantidad: 0.1, unidadMedida: "kg" }, { productoId: "p", cantidad: 0.2, unidadMedida: "kg" }]), [{ productoId: "p", cantidad: 0.3, unidadMedida: "kg" }]);
  assert.throws(() => consolidarItemsVenta([{ productoId: "p", cantidad: 1, unidadMedida: "kg" }, { productoId: "p", cantidad: 1, unidadMedida: "g" }]), /unidades diferentes/);
  assert.throws(() => consolidarItemsVenta([{ productoId: "p", cantidad: 0.5, unidadMedida: "unidad" }]), /precisión/);
  assert.throws(() => consolidarItemsVenta([{ productoId: "p", cantidad: 1, unidadMedida: "KG" }]), /unidad.*válida/);
});

test("RPC recibe unidad esperada y conflicto concurrente se explica sin confirmar", async () => {
  let enviada;
  const { confirmarVentaSigo } = await moduloConRpc(async (nombre, params) => {
    assert.equal(nombre, "confirmar_venta_sigo_v2");
    enviada = params.p_items;
    return { data: null, error: { message: "SALE_UNIT_MISMATCH" } };
  }, "ventas");
  await assert.rejects(confirmarVentaSigo({ empresaId: "empresa-1", medioPago: "efectivo", idempotencyKey: "operacion-1", items: [{ productoId: "p", cantidad: 0.75, unidadMedida: "kg" }] }), /Cambió la unidad.*No se confirmó/);
  assert.deepEqual(enviada, [{ producto_id: "p", cantidad: 0.75, unidad_medida: "kg" }]);
});

test("frontend envía stock legado fraccional sin redondeo para validación transaccional", async () => {
  let guardado;
  const { guardarProductoSigo } = await moduloConRpc(async (nombre, params) => {
    if (nombre === "guardar_producto_medida_sigo") { guardado = params; return { data: producto.id, error: null }; }
    if (nombre === "verificar_producto_guardado_sigo") return { data: [producto], error: null };
    return { data: [{ producto_id: producto.id, unidad_medida: "unidad" }], error: null };
  });
  await guardarProductoSigo({ ...input, productoId: producto.id, unidadMedida: "unidad" });
  assert.equal(guardado.p_stock_actual, 1.5);
  assert.equal(guardado.p_unidad_medida, "unidad");
});

test("altas nuevas por unidad no admiten stock inicial fraccional", async () => {
  let llamadas = 0;
  const { guardarProductoSigo } = await moduloConRpc(() => { llamadas++; throw new Error("No debe escribir"); });
  await assert.rejects(guardarProductoSigo({ ...input, unidadMedida: "unidad" }), /precisión/);
  await assert.rejects(guardarProductoSigo({ ...input, unidadMedida: undefined }), /precisión/);
  assert.equal(llamadas, 0);
});

test("descuento con precisión excesiva se rechaza antes de cualquier RPC", async () => {
  let llamadas = 0;
  const { confirmarVentaSigo } = await moduloConRpc(async () => { llamadas++; throw new Error("No debe llamar al servidor"); }, "ventas");
  for (const descuentoPct of [0.004, Number.NaN, Number.POSITIVE_INFINITY, -1, 100]) {
    await assert.rejects(confirmarVentaSigo({ empresaId: "empresa-1", items: [{ productoId: "p", cantidad: 1 }], medioPago: "efectivo", descuentoPct }), /hasta dos decimales/);
  }
  assert.equal(llamadas, 0);
});

test("rechazo transaccional se distingue de resultado incierto sin liberar conflictos idempotentes", async () => {
  for (const [error, definitivo] of [
    [{ code: "P0001", message: "INSUFFICIENT_STOCK: Producto" }, true],
    [{ code: "P0001", message: "SALE_UNIT_MISMATCH" }, true],
    [{ code: "P0001", message: "IDEMPOTENCY_CONFLICT" }, false],
    [{ code: "08006", message: "Connection lost" }, false],
    [{ message: "INSUFFICIENT_STOCK" }, false],
  ]) {
    const api = await moduloConRpc(async () => ({ data: null, error }), "ventas");
    await assert.rejects(api.confirmarVentaSigo({ empresaId: "empresa-1", items: [{ productoId: "p", cantidad: 1, unidadMedida: "unidad" }], medioPago: "efectivo", idempotencyKey: "retry-key" }), e => (e instanceof api.VentaRechazadaSinCambiosError) === definitivo);
  }
});
