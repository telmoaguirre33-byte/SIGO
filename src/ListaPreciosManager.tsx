import { useMemo, useState } from "react";
import { supabase } from "./supabase";
import type { ProductoSigo } from "./productos";
import { descargarProductosExcel } from "./excelProductos";
import EtiquetasPrecios from "./EtiquetasPrecios";
import CarteleriaOfertas from "./CarteleriaOfertas";

type Props = {
  empresaId: string;
  productos: ProductoSigo[];
  puedeEditar: boolean;
  onUpdated: () => void | Promise<void>;
};

type BaseCosto = "actual" | "ultima_compra";
type Alcance = "filtrados" | "todos";

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
  if (!(costo > 0) || !Number.isFinite(margen)) return null;
  const bruto = costo * (1 + margen / 100);
  if (redondeo > 0) return Math.ceil(bruto / redondeo) * redondeo;
  return Math.round(bruto * 100) / 100;
}

function textoError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (raw.includes("FORBIDDEN")) return "Tu perfil no tiene permisos para modificar costos, márgenes o listas de precios.";
  if (raw.includes("MARGIN_INVALID")) return "El margen ingresado no es válido.";
  if (raw.includes("COST_BASE_INVALID")) return "La base de costo seleccionada no es válida.";
  if (raw.includes("ROUNDING_INVALID")) return "El redondeo seleccionado no es válido.";
  if (raw.includes("aplicar_margen_masivo_sigo") || raw.includes("PGRST202")) return "La actualización masiva todavía no está disponible en la base de datos. Esperá a que termine el despliegue y volvé a intentar.";
  return raw || "No se pudo actualizar la lista de precios.";
}

export default function ListaPreciosManager({ empresaId, productos, puedeEditar, onUpdated }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [marca, setMarca] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [margen, setMargen] = useState("30");
  const [base, setBase] = useState<BaseCosto>("actual");
  const [redondeo, setRedondeo] = useState("0");
  const [alcance, setAlcance] = useState<Alcance>("filtrados");
  const [aplicando, setAplicando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [productoIndividual, setProductoIndividual] = useState("");
  const [margenIndividual, setMargenIndividual] = useState("");

  const categorias = useMemo(() => Array.from(new Set(productos.map((p) => p.categoria).filter((v): v is string => Boolean(v)))).sort(), [productos]);
  const marcas = useMemo(() => Array.from(new Set(productos.map((p) => p.marca).filter((v): v is string => Boolean(v)))).sort(), [productos]);
  const proveedores = useMemo(() => Array.from(new Set(productos.map((p) => p.proveedor).filter((v): v is string => Boolean(v)))).sort(), [productos]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      if (categoria && p.categoria !== categoria) return false;
      if (marca && p.marca !== marca) return false;
      if (proveedor && p.proveedor !== proveedor) return false;
      if (!q) return true;
      return [p.nombre, p.codigo_interno, p.codigo_barras, p.categoria, p.marca, p.proveedor]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [productos, busqueda, categoria, marca, proveedor]);

  const objetivos = alcance === "todos" ? productos : filtrados;
  const margenNumero = Number(margen);
  const redondeoNumero = Number(redondeo);
  const vistaPrevia = objetivos.slice(0, 8).map((p) => {
    const costo = costoBase(p, base);
    return { producto: p, costo, precio: precioConMargen(costo, margenNumero, redondeoNumero) };
  });
  const sinCosto = objetivos.filter((p) => costoBase(p, base) <= 0).length;

  async function aplicar(ids: string[] | null, margenAplicar: number) {
    const redondeoAplicar = Number(redondeo);
    if (!Number.isFinite(margenAplicar) || margenAplicar < 0) throw new Error("MARGIN_INVALID");
    if (!Number.isFinite(redondeoAplicar) || redondeoAplicar < 0) throw new Error("ROUNDING_INVALID");

    const { data, error: rpcError } = await supabase.rpc("aplicar_margen_masivo_sigo", {
      p_empresa_id: empresaId,
      p_margen_porcentaje: margenAplicar,
      p_producto_ids: ids,
      p_base_costo: base,
      p_redondeo: redondeoAplicar,
    });
    if (rpcError) throw new Error(rpcError.message);
    const fila = Array.isArray(data) ? data[0] : data;
    return {
      actualizados: Number(fila?.actualizados ?? 0),
      omitidos: Number(fila?.omitidos_sin_costo ?? 0),
    };
  }

  async function aplicarMasivo() {
    setMensaje("");
    setError("");
    if (!puedeEditar) {
      setError("Tu perfil es de consulta y no puede modificar precios.");
      return;
    }
    if (!Number.isFinite(margenNumero) || margenNumero < 0) {
      setError("Ingresá un margen válido igual o mayor a 0%. ");
      return;
    }
    if (objetivos.length === 0) {
      setError("No hay productos dentro del alcance seleccionado.");
      return;
    }

    const textoAlcance = alcance === "todos" ? `todos los ${productos.length} productos` : `${objetivos.length} productos filtrados`;
    if (!window.confirm(`Se recalculará el precio de ${textoAlcance} con un recargo del ${margenNumero}% sobre el costo. ¿Continuar?`)) return;

    setAplicando(true);
    try {
      const resultado = await aplicar(alcance === "todos" ? null : objetivos.map((p) => p.id), margenNumero);
      await onUpdated();
      setMensaje(`Actualización terminada: ${resultado.actualizados} producto(s) modificados${resultado.omitidos ? ` · ${resultado.omitidos} omitidos por no tener costo válido` : ""}.`);
    } catch (err) {
      setError(textoError(err));
    } finally {
      setAplicando(false);
    }
  }

  async function aplicarIndividual() {
    setMensaje("");
    setError("");
    const margenNumeroIndividual = Number(margenIndividual);
    if (!productoIndividual) {
      setError("Seleccioná el producto que querés corregir individualmente.");
      return;
    }
    if (!Number.isFinite(margenNumeroIndividual) || margenNumeroIndividual < 0) {
      setError("Ingresá un margen individual válido.");
      return;
    }
    setAplicando(true);
    try {
      const resultado = await aplicar([productoIndividual], margenNumeroIndividual);
      await onUpdated();
      setMensaje(resultado.actualizados === 1 ? "Margen individual actualizado." : "El producto no se modificó porque no tiene un costo válido.");
    } catch (err) {
      setError(textoError(err));
    } finally {
      setAplicando(false);
    }
  }

  const individual = productos.find((p) => p.id === productoIndividual) ?? null;
  const costoIndividual = individual ? costoBase(individual, base) : 0;
  const precioIndividual = individual && margenIndividual.trim()
    ? precioConMargen(costoIndividual, Number(margenIndividual), redondeoNumero)
    : null;

  return (
    <div className="panel" aria-label="Lista de precios de venta">
      <div className="page-header">
        <div>
          <h3>Lista de precios de venta</h3>
          <p>Exportá el catálogo completo a Excel y corregí precios de forma masiva. Un margen de 100% duplica el costo.</p>
        </div>
        <button className="admin-button" type="button" disabled={productos.length === 0} onClick={() => descargarProductosExcel(productos)}>
          Exportar Excel
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <EtiquetasPrecios productos={filtrados} />
        <CarteleriaOfertas productos={filtrados} />
      </div>

      <div className="form-grid">
        <div className="form-group form-span-2">
          <label htmlFor="precio-buscar">Buscar dentro de la lista</label>
          <input id="precio-buscar" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Producto, código, marca o proveedor" />
        </div>
        <div className="form-group">
          <label htmlFor="precio-categoria">Categoría</label>
          <select id="precio-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Todas</option>{categorias.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
        <div className="form-group">
          <label htmlFor="precio-marca">Marca</label>
          <select id="precio-marca" value={marca} onChange={(e) => setMarca(e.target.value)}><option value="">Todas</option>{marcas.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
        <div className="form-group">
          <label htmlFor="precio-proveedor">Proveedor</label>
          <select id="precio-proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)}><option value="">Todos</option>{proveedores.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </div>
        <div className="form-group">
          <label htmlFor="precio-margen">Margen / recargo %</label>
          <input id="precio-margen" type="number" min="0" step="0.01" inputMode="decimal" value={margen} onChange={(e) => setMargen(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="precio-base">Base de cálculo</label>
          <select id="precio-base" value={base} onChange={(e) => setBase(e.target.value as BaseCosto)}>
            <option value="actual">Costo actual</option>
            <option value="ultima_compra">Costo de última compra</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="precio-redondeo">Redondear hacia arriba</label>
          <select id="precio-redondeo" value={redondeo} onChange={(e) => setRedondeo(e.target.value)}>
            <option value="0">Sin redondeo</option>
            <option value="1">$ 1</option>
            <option value="10">$ 10</option>
            <option value="50">$ 50</option>
            <option value="100">$ 100</option>
            <option value="500">$ 500</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="precio-alcance">Aplicar a</label>
          <select id="precio-alcance" value={alcance} onChange={(e) => setAlcance(e.target.value as Alcance)}>
            <option value="filtrados">Productos filtrados ({filtrados.length})</option>
            <option value="todos">Todos los productos ({productos.length})</option>
          </select>
        </div>
      </div>

      <div className="table-wrapper" style={{ marginTop: 16 }}>
        <table className="products-table">
          <thead><tr><th>Producto</th><th>Costo base</th><th>Precio actual</th><th>Nuevo precio</th><th>Margen</th></tr></thead>
          <tbody>
            {vistaPrevia.map(({ producto, costo, precio }) => (
              <tr key={producto.id}>
                <td><strong>{producto.nombre}</strong><small>{producto.marca || producto.categoria || ""}</small></td>
                <td>{costo > 0 ? dinero(costo) : "Sin costo"}</td>
                <td>{dinero(producto.precio_venta)}</td>
                <td>{precio == null ? "No se modifica" : dinero(precio)}</td>
                <td>{Number.isFinite(margenNumero) ? `${margenNumero}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="barcode-help">Vista previa de hasta 8 productos · alcance total: <strong>{objetivos.length}</strong>{sinCosto ? ` · ${sinCosto} sin costo válido se omitirán` : ""}.</p>

      <div className="form-actions">
        <button className="primary-button" type="button" disabled={!puedeEditar || aplicando || objetivos.length === 0} onClick={() => void aplicarMasivo()}>
          {aplicando ? "Aplicando…" : `Aplicar ${margenNumero || 0}% masivamente`}
        </button>
      </div>

      <hr style={{ margin: "22px 0" }} />
      <div className="page-header">
        <div><h3>Excepción individual</h3><p>Después del ajuste general, corregí solamente los productos que necesiten otro margen.</p></div>
      </div>
      <div className="form-grid">
        <div className="form-group form-span-2">
          <label htmlFor="precio-individual-producto">Producto</label>
          <select id="precio-individual-producto" value={productoIndividual} onChange={(e) => {
            const id = e.target.value;
            setProductoIndividual(id);
            const seleccionado = productos.find((p) => p.id === id);
            setMargenIndividual(seleccionado?.margen_porcentaje == null ? "" : String(seleccionado.margen_porcentaje));
          }}>
            <option value="">Seleccionar…</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.codigo_interno ? ` · ${p.codigo_interno}` : ""}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="precio-individual-margen">Margen %</label>
          <input id="precio-individual-margen" type="number" min="0" step="0.01" inputMode="decimal" value={margenIndividual} onChange={(e) => setMargenIndividual(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Precio resultante</label>
          <div className="admin-button" style={{ cursor: "default", textAlign: "left" }}>{precioIndividual == null ? "-" : dinero(precioIndividual)}</div>
        </div>
      </div>
      <div className="form-actions">
        <button className="admin-button" type="button" disabled={!puedeEditar || aplicando || !productoIndividual} onClick={() => void aplicarIndividual()}>
          Aplicar excepción
        </button>
      </div>

      {mensaje && <p role="status"><strong>{mensaje}</strong></p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
