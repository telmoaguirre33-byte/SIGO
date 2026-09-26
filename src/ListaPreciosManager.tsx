import { useMemo, useState } from "react";
import { supabase } from "./supabase";
import type { ProductoSigo } from "./productos";
import { descargarProductosExcel } from "./excelProductos";
import EtiquetasPrecios from "./EtiquetasPrecios";
import CarteleriaOfertas from "./CarteleriaOfertas";
import ProductosOferta from "./ProductosOferta";
import { calcularPrecioConMargen, redondearPrecioVenta } from "./redondeoPrecios";

type Props = {
  empresaId: string;
  productos: ProductoSigo[];
  puedeEditar: boolean;
  onUpdated: () => void | Promise<void>;
};
type BaseCosto = "actual" | "ultima_compra";
type Alcance = "filtrados" | "todos";
type Operacion = "redondeo" | "margen";

function dinero(valor: number | null | undefined) {
  if (valor == null || !Number.isFinite(Number(valor))) return "-";
  return `$ ${Number(valor).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}
function costoBase(producto: ProductoSigo, base: BaseCosto) {
  const actual = Number(producto.costo_actual ?? 0);
  const ultima = Number(producto.costo_ultima_compra ?? 0);
  if (base === "ultima_compra") return ultima > 0 ? ultima : actual > 0 ? actual : 0;
  return actual > 0 ? actual : ultima > 0 ? ultima : 0;
}
function precioConMargen(costo: number, margen: number, redondeo: number) {
  return calcularPrecioConMargen(costo, margen, redondeo);
}
function textoError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw.includes("FORBIDDEN")) return "Tu perfil no tiene permisos para realizar este ajuste de precios.";
  if (raw.includes("MARGIN_INVALID")) return "Ingresá un margen válido entre 0% y 10000%.";
  if (raw.includes("COST_BASE_INVALID")) return "La base de costo seleccionada no es válida.";
  if (raw.includes("ROUNDING_INVALID")) return "Seleccioná un redondeo de $1, $10, $50, $100 o $500.";
  if (raw.includes("PRICE_CHANGED_REFRESH") || raw.includes("PRODUCT_SCOPE_CHANGED")) return "La lista cambió desde que se mostró la vista previa. Actualizá la lista y revisá los nuevos precios antes de aplicar. No se guardó ningún cambio.";
  if (raw.includes("PRICE_SELECTION_INVALID")) return "La selección de productos no es válida. Actualizá la lista y volvé a intentar.";
  if (raw.includes("aplicar_margen_masivo_sigo") || raw.includes("redondear_precios_venta_sigo") || raw.includes("PGRST202")) return "La actualización todavía no está disponible en la base de datos. Actualizá la aplicación y volvé a intentar.";
  return raw || "No se pudo actualizar la lista de precios.";
}

export default function ListaPreciosManager({ empresaId, productos, puedeEditar, onUpdated }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [marca, setMarca] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [operacion, setOperacion] = useState<Operacion>("redondeo");
  const [margen, setMargen] = useState("30");
  const [base, setBase] = useState<BaseCosto>("actual");
  const [redondeo, setRedondeo] = useState("0");
  const [alcance, setAlcance] = useState<Alcance>("filtrados");
  const [aplicando, setAplicando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [productoIndividual, setProductoIndividual] = useState("");
  const [margenIndividual, setMargenIndividual] = useState("");
  // The products RPC deliberately returns null for protected cost/margin fields.
  // Never treat a masked cost as zero or grant additional permissions here.
  const costosDisponibles = productos.some((p) => p.costo_actual != null || p.costo_ultima_compra != null);
  const margenesDisponibles = productos.some((p) => p.margen_porcentaje != null || p.margen_ganancia != null);
  const puedeRecalcularMargen = puedeEditar && costosDisponibles && margenesDisponibles;
  const soloRedondeo = operacion === "redondeo";
  const categorias = useMemo(() => Array.from(new Set(productos.map((p) => p.categoria).filter((v): v is string => Boolean(v)))).sort(), [productos]);
  const marcas = useMemo(() => Array.from(new Set(productos.map((p) => p.marca).filter((v): v is string => Boolean(v)))).sort(), [productos]);
  const proveedores = useMemo(() => Array.from(new Set(productos.map((p) => p.proveedor).filter((v): v is string => Boolean(v)))).sort(), [productos]);
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      if (categoria && p.categoria !== categoria) return false;
      if (marca && p.marca !== marca) return false;
      if (proveedor && p.proveedor !== proveedor) return false;
      return !q || [p.nombre, p.codigo_interno, p.codigo_barras, p.categoria, p.marca, p.proveedor].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [productos, busqueda, categoria, marca, proveedor]);
  const objetivos = alcance === "todos" ? productos : filtrados;
  const margenNumero = margen.trim() ? Number(margen) : NaN;
  const redondeoNumero = Number(redondeo);
  const calculados = objetivos.map((p) => {
    const costo = costoBase(p, base);
    const precio = soloRedondeo
      ? redondearPrecioVenta(Number(p.precio_venta), redondeoNumero)
      : precioConMargen(costo, margenNumero, redondeoNumero);
    return { producto: p, costo, precio };
  });
  const vistaPrevia = calculados.slice(0, 8);
  const omitidos = calculados.filter((p) => p.precio == null).length;
  const cambios = calculados.filter((p) => p.precio != null && p.precio !== Number(p.producto.precio_venta)).length;

  async function aplicarMargen(ids: string[], margenAplicar: number) {
    if (!puedeRecalcularMargen) throw new Error("FORBIDDEN");
    if (!Number.isFinite(margenAplicar) || margenAplicar < 0 || margenAplicar > 10000) throw new Error("MARGIN_INVALID");
    const { data, error: rpcError } = await supabase.rpc("aplicar_margen_masivo_sigo", {
      p_empresa_id: empresaId, p_margen_porcentaje: margenAplicar,
      p_producto_ids: ids, p_base_costo: base, p_redondeo: redondeoNumero,
    });
    if (rpcError) throw new Error(rpcError.message);
    const fila = Array.isArray(data) ? data[0] : data;
    return { actualizados: Number(fila?.actualizados ?? 0), omitidos: Number(fila?.omitidos_sin_costo ?? 0) };
  }
  async function aplicarMasivo() {
    setMensaje(""); setError("");
    if (!puedeEditar || (!soloRedondeo && !puedeRecalcularMargen)) { setError("Tu perfil no puede realizar este ajuste."); return; }
    if (objetivos.length === 0) { setError("No hay productos dentro del alcance seleccionado."); return; }
    if (soloRedondeo && redondeoNumero <= 0) { setError("Seleccioná a cuánto querés redondear los precios."); return; }
    if (!soloRedondeo && (!Number.isFinite(margenNumero) || margenNumero < 0 || margenNumero > 10000)) { setError("Ingresá un margen válido entre 0% y 10000%."); return; }
    if (soloRedondeo && cambios === 0) { setMensaje("No hay precios para cambiar: ya están redondeados o no tienen un precio de venta válido."); return; }
    const textoAlcance = alcance === "todos" ? `todos los ${objetivos.length} productos visibles de la empresa` : `${objetivos.length} productos filtrados`;
    const texto = soloRedondeo
      ? `Se redondearán hacia arriba a múltiplos de ${dinero(redondeoNumero)} los precios de venta de ${textoAlcance}. ${cambios} precio(s) cambiarán. No se agregará margen ni se modificarán costos o stock.${omitidos ? ` Se omitirán ${omitidos} sin precio válido.` : ""} ¿Aplicar?`
      : `Se recalculará el precio de ${textoAlcance} con un recargo del ${margenNumero}% sobre el costo${redondeoNumero > 0 ? ` y redondeo hacia arriba a ${dinero(redondeoNumero)}` : ""}. ¿Continuar?`;
    if (!window.confirm(texto)) return;
    setAplicando(true);
    let guardado = false;
    try {
      let resultadoTexto: string;
      if (soloRedondeo) {
        const { data, error: rpcError } = await supabase.rpc("redondear_precios_venta_sigo", {
          p_empresa_id: empresaId, p_redondeo: redondeoNumero,
          p_precios_esperados: objetivos.map((p) => ({ id: p.id, precio: p.precio_venta == null ? null : Number(p.precio_venta) })),
        });
        if (rpcError) throw new Error(rpcError.message);
        const fila = Array.isArray(data) ? data[0] : data;
        if (!fila) throw new Error("No se recibió la confirmación del guardado. Actualizá la lista antes de repetir.");
        resultadoTexto = `Redondeo guardado: ${Number(fila.actualizados)} precio(s) modificados · ${Number(fila.sin_cambios)} ya estaban redondeados${Number(fila.omitidos_sin_precio) ? ` · ${Number(fila.omitidos_sin_precio)} sin precio válido, omitidos` : ""}.`;
      } else {
        const resultado = await aplicarMargen(objetivos.map((p) => p.id), margenNumero);
        resultadoTexto = `Actualización terminada: ${resultado.actualizados} producto(s) modificados${resultado.omitidos ? ` · ${resultado.omitidos} omitidos por no tener costo válido` : ""}.`;
      }
      guardado = true;
      setMensaje(resultadoTexto);
      await onUpdated();
    } catch (err) {
      setError(guardado ? "Los cambios se guardaron, pero no se pudo refrescar la lista. Usá Actualizar para ver los precios guardados; no repitas la operación." : textoError(err));
    } finally { setAplicando(false); }
  }
  async function aplicarIndividual() {
    setMensaje(""); setError("");
    const valor = margenIndividual.trim() ? Number(margenIndividual) : NaN;
    if (!productoIndividual) { setError("Seleccioná el producto que querés corregir individualmente."); return; }
    if (!Number.isFinite(valor) || valor < 0 || valor > 10000) { setError("Ingresá un margen individual válido."); return; }
    setAplicando(true);
    try {
      const resultado = await aplicarMargen([productoIndividual], valor);
      await onUpdated();
      setMensaje(resultado.actualizados === 1 ? "Margen individual actualizado." : "El producto no se modificó porque no tiene un costo válido.");
    } catch (err) { setError(textoError(err)); } finally { setAplicando(false); }
  }
  const individual = productos.find((p) => p.id === productoIndividual) ?? null;
  const costoIndividual = individual ? costoBase(individual, base) : 0;
  const precioIndividual = individual && margenIndividual.trim()
    ? precioConMargen(costoIndividual, Number(margenIndividual), redondeoNumero)
    : null;

  // Lista de precios de venta en modo consulta: keep the existing seller guard.
  if (!puedeEditar) {
    return <div className="panel" aria-label="Lista de precios de venta en modo consulta">
      <div className="page-header"><div><h3>Lista de precios</h3><p>Consulta de productos y precios de venta. Tu perfil no puede modificar precios ni márgenes.</p></div></div>
      <div className="form-group"><label htmlFor="precio-buscar-consulta">Buscar producto</label><input id="precio-buscar-consulta" type="search" autoComplete="off" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Producto, código o marca" /></div>
      <div className="table-wrapper" style={{ marginTop: 16 }}><table className="products-table"><thead><tr><th>Producto</th><th>Precio de venta</th></tr></thead><tbody>{filtrados.map((p) => <tr key={p.id}><td><strong>{p.nombre}</strong><small>{p.codigo_barras || p.codigo_interno || p.marca || ""}</small></td><td><strong>{dinero(p.precio_venta)}</strong></td></tr>)}</tbody></table>{filtrados.length === 0 && <div className="table-empty">No hay productos que coincidan con la búsqueda.</div>}</div>
      <p className="barcode-help">Modo consulta · {filtrados.length.toLocaleString("es-AR")} producto{filtrados.length === 1 ? "" : "s"} visible{filtrados.length === 1 ? "" : "s"}.</p>
    </div>;
  }
  return <><ProductosOferta empresaId={empresaId} productos={productos} /><div className="panel" aria-label="Lista de precios de venta">
    <div className="page-header"><div><h3>Lista de precios de venta</h3><p>Redondeá precios de venta sin agregar margen, o recalculalos desde el costo.</p></div><button className="admin-button" type="button" disabled={productos.length === 0 || aplicando} onClick={() => descargarProductosExcel(productos)}>Exportar Excel</button></div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}><EtiquetasPrecios productos={filtrados} /><CarteleriaOfertas productos={filtrados} /></div>
    <fieldset disabled={aplicando} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="form-grid">
        <div className="form-group form-span-2"><label htmlFor="precio-buscar">Buscar dentro de la lista</label><input id="precio-buscar" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Producto, código, marca o proveedor" /></div>
        <div className="form-group"><label htmlFor="precio-categoria">Categoría</label><select id="precio-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Todas</option>{categorias.map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
        <div className="form-group"><label htmlFor="precio-marca">Marca</label><select id="precio-marca" value={marca} onChange={(e) => setMarca(e.target.value)}><option value="">Todas</option>{marcas.map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
        <div className="form-group"><label htmlFor="precio-proveedor">Proveedor</label><select id="precio-proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)}><option value="">Todos</option>{proveedores.map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
        <div className="form-group"><label htmlFor="precio-operacion">Qué querés hacer</label><select id="precio-operacion" value={operacion} onChange={(e) => { setOperacion(e.target.value as Operacion); setMensaje(""); setError(""); }}><option value="redondeo">Solo redondear el precio de venta actual</option><option value="margen" disabled={!puedeRecalcularMargen}>Recalcular con margen sobre el costo</option></select></div>
        {!soloRedondeo && <><div className="form-group"><label htmlFor="precio-margen">Margen / recargo %</label><input id="precio-margen" type="number" min="0" max="10000" step="0.01" inputMode="decimal" value={margen} onChange={(e) => setMargen(e.target.value)} /></div><div className="form-group"><label htmlFor="precio-base">Base de cálculo</label><select id="precio-base" value={base} onChange={(e) => setBase(e.target.value as BaseCosto)}><option value="actual">Costo actual</option><option value="ultima_compra">Costo de última compra</option></select></div></>}
        <div className="form-group"><label htmlFor="precio-redondeo">Redondear hacia arriba</label><select id="precio-redondeo" value={redondeo} onChange={(e) => { setRedondeo(e.target.value); setMensaje(""); setError(""); }}><option value="0">Sin redondeo</option><option value="1">$ 1</option><option value="10">$ 10</option><option value="50">$ 50</option><option value="100">$ 100</option><option value="500">$ 500</option></select></div>
        <div className="form-group"><label htmlFor="precio-alcance">Aplicar a</label><select id="precio-alcance" value={alcance} onChange={(e) => setAlcance(e.target.value as Alcance)}><option value="filtrados">Productos filtrados ({filtrados.length})</option><option value="todos">Todos los productos ({productos.length})</option></select></div>
      </div>
    </fieldset>
    <p className="barcode-help">{soloRedondeo ? "Se usa el precio de venta actual: no se suma otro margen y no hace falta tener costo cargado. Elegir el redondeo solo actualiza la vista previa; para guardarlo, presioná Aplicar redondeo." : "Un recargo de 100% duplica el costo. El redondeo se aplica después del recargo."}</p>
    {!costosDisponibles && productos.length > 0 && <p className="barcode-help">Los costos no están disponibles para este perfil. Podés redondear los precios de venta sin modificar permisos.</p>}
    <div className="form-actions"><button className="primary-button" type="button" disabled={aplicando || objetivos.length === 0 || (soloRedondeo ? redondeoNumero <= 0 || cambios === 0 : !puedeRecalcularMargen || !Number.isFinite(margenNumero) || margenNumero < 0 || margenNumero > 10000 || omitidos === objetivos.length)} onClick={() => void aplicarMasivo()}>{aplicando ? "Aplicando…" : soloRedondeo ? `Aplicar redondeo (${cambios} precios)` : `Aplicar ${margenNumero || 0}% masivamente`}</button></div>
    {mensaje && <p role="status"><strong>{mensaje}</strong></p>}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="table-wrapper" style={{ marginTop: 16 }}><table className="products-table"><thead><tr><th>Producto</th>{!soloRedondeo && <th>Costo base</th>}<th>Precio actual</th><th>Nuevo precio</th><th>{soloRedondeo ? "Estado" : "Recargo aplicado"}</th></tr></thead><tbody>{vistaPrevia.map(({ producto, costo, precio }) => <tr key={producto.id}><td><strong>{producto.nombre}</strong><small>{producto.marca || producto.categoria || ""}</small></td>{!soloRedondeo && <td>{producto.costo_actual == null && producto.costo_ultima_compra == null ? "Costo no disponible" : costo > 0 ? dinero(costo) : "Sin costo"}</td>}<td>{dinero(producto.precio_venta)}</td><td>{precio == null ? "No se modifica" : dinero(precio)}</td><td>{soloRedondeo ? precio == null ? "Sin precio válido" : precio === Number(producto.precio_venta) ? "Sin cambios" : "A redondear" : Number.isFinite(margenNumero) ? `${margenNumero}%` : "-"}</td></tr>)}</tbody></table></div>
    <p className="barcode-help">Vista previa de hasta 8 productos · alcance total: <strong>{objetivos.length}</strong>{soloRedondeo ? ` · ${cambios} precios cambiarán` : ""}{omitidos ? ` · ${omitidos} sin ${soloRedondeo ? "precio" : "costo"} válido se omitirán` : ""}.</p>
    {!soloRedondeo && puedeRecalcularMargen && <>
      <hr style={{ margin: "22px 0" }} /><div className="page-header"><div><h3>Excepción individual</h3><p>Después del ajuste general, corregí solamente los productos que necesiten otro margen.</p></div></div>
      <div className="form-grid"><div className="form-group form-span-2"><label htmlFor="precio-individual-producto">Producto</label><select id="precio-individual-producto" disabled={aplicando} value={productoIndividual} onChange={(e) => { const id = e.target.value; setProductoIndividual(id); const seleccionado = productos.find((p) => p.id === id); setMargenIndividual(seleccionado?.margen_porcentaje == null ? "" : String(seleccionado.margen_porcentaje)); }}><option value="">Seleccionar…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.codigo_interno ? ` · ${p.codigo_interno}` : ""}</option>)}</select></div><div className="form-group"><label htmlFor="precio-individual-margen">Margen %</label><input id="precio-individual-margen" disabled={aplicando} type="number" min="0" max="10000" step="0.01" inputMode="decimal" value={margenIndividual} onChange={(e) => setMargenIndividual(e.target.value)} /></div><div className="form-group"><label>Precio resultante</label><div className="admin-button" style={{ cursor: "default", textAlign: "left" }}>{precioIndividual == null ? "-" : dinero(precioIndividual)}</div></div></div>
      <div className="form-actions"><button className="admin-button" type="button" disabled={aplicando || !productoIndividual || precioIndividual == null} onClick={() => void aplicarIndividual()}>Aplicar excepción</button></div>
    </>}
  </div></>;
}
