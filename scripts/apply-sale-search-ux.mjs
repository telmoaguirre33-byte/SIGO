import fs from "node:fs";

const path = "src/VentaRapidaOperativa.tsx";
let s = fs.readFileSync(path, "utf8");

function replaceOnce(from, to, label) {
  if (!s.includes(from)) throw new Error(`SALE_SEARCH_PATCH_MISSING:${label}`);
  s = s.replace(from, to);
}

replaceOnce(
`export default function VentaRapidaOperativa({ empresaId, puedeEditarProductos = false }: { empresaId: string; puedeEditarProductos?: boolean }) {`,
`function normalizarBusqueda(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLocaleLowerCase("es-AR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function textoBusquedaProducto(producto: ProductoSigo) {
  return normalizarBusqueda([
    producto.nombre,
    producto.codigo_interno,
    producto.codigo_barras,
    producto.marca,
    producto.categoria,
    producto.descripcion,
    producto.proveedor,
  ].filter(Boolean).join(" "));
}

function puntajeBusquedaProducto(producto: ProductoSigo, consulta: string, tokens: string[]) {
  const nombre = normalizarBusqueda(producto.nombre);
  const codigoInterno = normalizarBusqueda(producto.codigo_interno);
  const codigoBarras = normalizarBusqueda(producto.codigo_barras);
  const marca = normalizarBusqueda(producto.marca);
  const categoria = normalizarBusqueda(producto.categoria);
  const texto = textoBusquedaProducto(producto);
  if (!tokens.every((token) => texto.includes(token))) return -1;

  let score = 0;
  if (codigoBarras === consulta || codigoInterno === consulta) score += 1000;
  if (nombre === consulta) score += 800;
  if (nombre.startsWith(consulta)) score += 500;
  else if (nombre.includes(consulta)) score += 320;
  if (marca === consulta || marca.startsWith(consulta)) score += 160;
  if (categoria === consulta || categoria.startsWith(consulta)) score += 100;
  score += Math.max(0, 80 - nombre.length);
  return score;
}

export default function VentaRapidaOperativa({ empresaId, puedeEditarProductos = false }: { empresaId: string; puedeEditarProductos?: boolean }) {`,
"helpers",
);

replaceOnce(
`  const productosEncontrados = useMemo(() => {
    const q = busquedaProducto.trim().toLocaleLowerCase("es-AR");
    if (q.length < 2) return [];
    return catalogo
      .filter((producto) => [producto.nombre, producto.codigo_interno, producto.codigo_barras, producto.marca]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("es-AR")
        .includes(q))
      .slice(0, 12);
  }, [busquedaProducto, catalogo]);`,
`  const productosEncontrados = useMemo(() => {
    const q = normalizarBusqueda(busquedaProducto);
    if (!q) return [];
    const tokens = q.split(/\\s+/).filter(Boolean);
    return catalogo
      .map((producto) => ({ producto, score: puntajeBusquedaProducto(producto, q, tokens) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.producto.nombre.localeCompare(b.producto.nombre, "es-AR"))
      .slice(0, 20)
      .map((item) => item.producto);
  }, [busquedaProducto, catalogo]);`,
"search",
);

replaceOnce(
`        <div className="form-group" style={{ marginTop: 16 }}>
          <label htmlFor="venta-buscar-producto">O buscar por nombre, código o marca</label>
          <input
            id="venta-buscar-producto"
            type="search"
            placeholder="Ej.: resma A4, tinta Epson o código interno"
            value={busquedaProducto}
            onChange={(event) => setBusquedaProducto(event.target.value)}
            disabled={confirmando}
          />
        </div>`,
`        <p className="barcode-help" style={{ marginTop: 10 }}>Buscá en el campo azul por nombre, código interno o EAN. También podés leer con pistola o cámara. Catálogo: {catalogo.length.toLocaleString("es-AR")} productos.</p>`,
"one-search",
);

replaceOnce(
`          onBlockedProduct={marcarProductoBloqueado}
        />`,
`          onBlockedProduct={marcarProductoBloqueado}
          onQueryChange={setBusquedaProducto}
          queryResetKey={busquedaResetKey}
          onManualQuery={(query) => {
            const codigo = query.trim().toLocaleLowerCase("es-AR");
            if (!codigo) return true;
            const exacto = catalogo.some((producto) => [producto.codigo_interno, producto.codigo_barras]
              .some((valor) => String(valor ?? "").trim().toLocaleLowerCase("es-AR") === codigo));
            if (exacto) return false;
            setBusquedaProducto(query);
            return true;
          }}
        />`,
"scanner-search",
);

replaceOnce(
`  const [busquedaProducto, setBusquedaProducto] = useState("");`,
`  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [busquedaResetKey, setBusquedaResetKey] = useState(0);`,
"reset-key",
);

replaceOnce(
`    setItems((actual) => {
      const existente = actual.find((item) => item.producto.id === producto.id);`,
`    setBusquedaProducto("");
    setBusquedaResetKey((key) => key + 1);
    setItems((actual) => {
      const existente = actual.find((item) => item.producto.id === producto.id);`,
"reset-after-add",
);

replaceOnce(
`    setPrecioRapido("");
    setBusquedaProducto("");
    setIdempotencyKey(nuevaClaveVenta());`,
`    setPrecioRapido("");
    setBusquedaProducto("");
    setBusquedaResetKey((key) => key + 1);
    setIdempotencyKey(nuevaClaveVenta());`,
"reset-after-empty",
);

replaceOnce(
`        {busquedaProducto.trim().length >= 2 && productosEncontrados.length === 0 && !catalogoError ? (
          <p className="barcode-help">No se encontraron productos con esa búsqueda en la empresa activa.</p>
        ) : null}`,
`        {busquedaProducto.trim().length >= 1 && productosEncontrados.length === 0 && !catalogoError ? (
          <p className="barcode-help">{catalogo.length === 0 ? "Esta empresa no tiene productos cargados. Cambiá de empresa o cargá mercadería antes de vender." : "No encontré coincidencias. Probá con una parte del nombre, marca, categoría o código."}</p>
        ) : null}`,
"empty-state",
);

fs.writeFileSync(path, s, "utf8");
console.log("SIGO_SALE_SEARCH_UX_OK");
