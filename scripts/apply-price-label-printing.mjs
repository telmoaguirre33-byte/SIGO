import fs from "node:fs";

const file = new URL("../src/ListaPreciosManager.tsx", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const importAnchor = 'import { descargarProductosExcel } from "./excelProductos";';
const importLine = 'import EtiquetasPrecios from "./EtiquetasPrecios";';
if (!source.includes(importLine) && source.includes("<EtiquetasPrecios")) {
  if (!source.includes(importAnchor)) throw new Error("No se encontró el ancla de importación de Excel en ListaPreciosManager.tsx");
  source = source.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

const headerAnchor = `        <button className="admin-button" type="button" disabled={productos.length === 0} onClick={() => descargarProductosExcel(productos)}>\n          Exportar Excel\n        </button>\n      </div>\n\n      <div className="form-grid">`;
const replacement = `        <button className="admin-button" type="button" disabled={productos.length === 0} onClick={() => descargarProductosExcel(productos)}>\n          Exportar Excel\n        </button>\n      </div>\n\n      <EtiquetasPrecios productos={filtrados} />\n\n      <div className="form-grid">`;

if (!source.includes("<EtiquetasPrecios") && source.includes(headerAnchor)) {
  source = source.replace(headerAnchor, replacement);
}

fs.writeFileSync(file, source);
console.log("SIGO price label printing applied");
