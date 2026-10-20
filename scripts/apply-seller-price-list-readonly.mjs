import fs from "node:fs";

const file = new URL("../src/ListaPreciosManager.tsx", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const anchor = `  const precioIndividual = individual && margenIndividual.trim()\n    ? precioConMargen(costoIndividual, Number(margenIndividual), redondeoNumero)\n    : null;\n\n  return (`;

const replacement = `  const precioIndividual = individual && margenIndividual.trim()\n    ? precioConMargen(costoIndividual, Number(margenIndividual), redondeoNumero)\n    : null;\n\n  // Vendedor/cajero: consulta estricta. No se muestran costos, márgenes,\n  // redondeos, exportación ni acciones que puedan sugerir capacidad de edición.\n  if (!puedeEditar) {\n    return (\n      <div className=\"panel\" aria-label=\"Lista de precios de venta en modo consulta\">\n        <div className=\"page-header\">\n          <div>\n            <h3>Lista de precios</h3>\n            <p>Consulta de productos y precios de venta. Tu perfil no puede modificar precios ni márgenes.</p>\n          </div>\n        </div>\n\n        <div className=\"form-group\">\n          <label htmlFor=\"precio-buscar-consulta\">Buscar producto</label>\n          <input\n            id=\"precio-buscar-consulta\"\n            type=\"search\"\n            autoComplete=\"off\"\n            value={busqueda}\n            onChange={(e) => setBusqueda(e.target.value)}\n            placeholder=\"Producto, código o marca\"\n          />\n        </div>\n\n        <div className=\"table-wrapper\" style={{ marginTop: 16 }}>\n          <table className=\"products-table\">\n            <thead><tr><th>Producto</th><th>Precio de venta</th></tr></thead>\n            <tbody>\n              {filtrados.map((producto) => (\n                <tr key={producto.id}>\n                  <td>\n                    <strong>{producto.nombre}</strong>\n                    <small>{producto.codigo_barras || producto.codigo_interno || producto.marca || \"\"}</small>\n                  </td>\n                  <td><strong>{dinero(producto.precio_venta)}</strong></td>\n                </tr>\n              ))}\n            </tbody>\n          </table>\n          {filtrados.length === 0 && <div className=\"table-empty\">No hay productos que coincidan con la búsqueda.</div>}\n        </div>\n        <p className=\"barcode-help\">Modo consulta · {filtrados.length.toLocaleString(\"es-AR\")} producto{filtrados.length === 1 ? \"\" : \"s\"} visible{filtrados.length === 1 ? \"\" : \"s\"}.</p>\n      </div>\n    );\n  }\n\n  return (`;

if (!source.includes("Lista de precios de venta en modo consulta")) {
  if (!source.includes(anchor)) throw new Error("SELLER_PRICE_LIST_READONLY_ANCHOR_MISSING");
  source = source.replace(anchor, replacement);
}

fs.writeFileSync(file, source, "utf8");
console.log("SIGO_SELLER_PRICE_LIST_READONLY_OK");
