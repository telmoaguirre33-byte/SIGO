import fs from "node:fs";

const path = "src/VentaRapidaOperativa.tsx";
let s = fs.readFileSync(path, "utf8");

function replaceOnce(from, to, label) {
  if (s.includes(to)) return;
  if (!s.includes(from)) throw new Error(`SALE_CART_UX_PATCH_MISSING:${label}`);
  s = s.replace(from, to);
}

replaceOnce(
`  const empresaActivaRef = useRef(empresaId);`,
`  const empresaActivaRef = useRef(empresaId);
  const busquedaProductoRef = useRef<HTMLInputElement | null>(null);`,
"search-ref",
);

replaceOnce(
`  function vaciar() {`,
`  function seguirAgregando() {
    if (confirmando) return;
    setBusquedaProducto("");
    setProductoBloqueado(null);
    setError("");
    setExito("");
    window.setTimeout(() => {
      busquedaProductoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      busquedaProductoRef.current?.focus();
    }, 0);
  }

  function vaciar() {`,
"continue-shopping",
);

replaceOnce(
`          <input
            id="venta-buscar-producto"
            type="search"
            autoComplete="off"`,
`          <input
            ref={busquedaProductoRef}
            id="venta-buscar-producto"
            type="search"
            autoComplete="off"`,
"search-input-ref",
);

replaceOnce(
`        <h3>Escanear producto</h3>`,
`        <h3>Agregar productos a la venta</h3>
        <p style={{ marginTop: 0 }}>Escaneá o buscá un producto, agregalo y repetí todas las veces que necesites antes de confirmar.</p>`,
"scanner-heading",
);

replaceOnce(
`<td><button type="button" className="admin-button" onClick={() => seleccionarProductoManual(producto)}>Elegir</button></td>`,
`<td><button type="button" className="primary-button" onClick={() => seleccionarProductoManual(producto)}>Agregar</button></td>`,
"manual-add-label",
);

replaceOnce(
`          <div><h3>Carrito</h3><p>El precio final, stock, cliente y límite de crédito se vuelven a validar en backend al confirmar.</p></div>`,
`          <div>
            <h3>Carrito · {items.length} producto{items.length === 1 ? "" : "s"} · {items.reduce((total, item) => total + item.cantidad, 0)} unidad{items.reduce((total, item) => total + item.cantidad, 0) === 1 ? "" : "es"}</h3>
            <p>Podés seguir escaneando o buscando productos. Recién se descuenta stock cuando confirmás la venta.</p>
          </div>`,
"cart-heading",
);

replaceOnce(
`        <div className="table-wrapper">
          <table className="products-table">
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th><th>Stock</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.producto.id}>
                  <td><strong>{item.producto.nombre}</strong></td>
                  <td>
                    <div className="row-actions">
                      <button className="admin-button" disabled={confirmando} onClick={() => cambiarCantidad(item.producto.id, -1)}>−</button>
                      <strong>{item.cantidad}</strong>
                      <button className="admin-button" disabled={confirmando} onClick={() => cambiarCantidad(item.producto.id, 1)}>+</button>
                    </div>
                  </td>
                  <td>$ {Number(item.producto.precio_venta).toLocaleString("es-AR")}</td>
                  <td>$ {(Number(item.producto.precio_venta) * item.cantidad).toLocaleString("es-AR")}</td>
                  <td>{item.producto.stock_actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <div className="table-empty">Escaneá un producto para iniciar la venta.</div>}
        </div>`,
`        {items.length > 0 && (
          <button type="button" className="primary-button" disabled={confirmando} onClick={seguirAgregando} style={{ width: "100%", marginBottom: 14 }}>
            + Agregar otro producto
          </button>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <div key={item.producto.id} className="arca-security-note" style={{ alignItems: "stretch" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{item.producto.nombre}</strong>
                  <span>Stock disponible: {item.producto.stock_actual}</span>
                </div>
                <strong style={{ whiteSpace: "nowrap" }}>$ {(Number(item.producto.precio_venta) * item.cantidad).toLocaleString("es-AR")}</strong>
              </div>
              <div className="row-actions" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div className="row-actions">
                  <button type="button" className="admin-button" disabled={confirmando} onClick={() => cambiarCantidad(item.producto.id, -1)}>−</button>
                  <strong>{item.cantidad}</strong>
                  <button type="button" className="admin-button" disabled={confirmando} onClick={() => cambiarCantidad(item.producto.id, 1)}>+</button>
                </div>
                <span>$ {Number(item.producto.precio_venta).toLocaleString("es-AR")} c/u</span>
                <button type="button" className="admin-button danger-button" disabled={confirmando} onClick={() => cambiarCantidad(item.producto.id, -item.cantidad)}>Quitar</button>
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="table-empty">Escaneá o buscá un producto para iniciar la venta.</div>}
        </div>`,
"mobile-cart-cards",
);

replaceOnce(
`        <div className="form-actions">
          <strong>Total: $ {total.toLocaleString("es-AR")}</strong>
          <button className="primary-button" disabled={!puedeConfirmar || confirmando} onClick={() => void confirmar()}>
            {confirmando ? "Confirmando…" : "Confirmar venta"}
          </button>
        </div>`,
`        <div className="form-actions" style={{ flexWrap: "wrap" }}>
          {items.length > 0 && (
            <button type="button" className="admin-button" disabled={confirmando} onClick={seguirAgregando}>+ Agregar otro</button>
          )}
          <strong style={{ fontSize: "1.15rem" }}>Total: $ {total.toLocaleString("es-AR")}</strong>
          <button className="primary-button" disabled={!puedeConfirmar || confirmando} onClick={() => void confirmar()}>
            {confirmando ? "Confirmando…" : `Confirmar venta${items.length > 0 ? ` · ${items.length} producto${items.length === 1 ? "" : "s"}` : ""}`}
          </button>
        </div>`,
"cart-actions",
);

fs.writeFileSync(path, s, "utf8");
console.log("SIGO_SALE_CART_UX_OK");
