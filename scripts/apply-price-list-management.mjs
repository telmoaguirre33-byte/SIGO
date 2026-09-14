import fs from "node:fs";

const file = new URL("../src/SigoApp.tsx", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const importAnchor = 'import BarcodeScanner from "./BarcodeScanner";';
const importLine = 'import ListaPreciosManager from "./ListaPreciosManager";';
if (!source.includes(importLine)) {
  if (!source.includes(importAnchor)) throw new Error("No se encontró el ancla de importación de BarcodeScanner en SigoApp.tsx");
  source = source.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

const scannerPanel = `      <div className="panel">\n        <h3>Buscar por código</h3>`;
const priceManager = `      <ListaPreciosManager\n        empresaId={empresaId}\n        productos={productos}\n        puedeEditar={puedeEditar}\n        onUpdated={cargar}\n      />\n\n`;
if (!source.includes("<ListaPreciosManager")) {
  if (!source.includes(scannerPanel)) throw new Error("No se encontró el panel de escáner para insertar la lista de precios");
  source = source.replace(scannerPanel, `${priceManager}${scannerPanel}`);
}

fs.writeFileSync(file, source);
console.log("SIGO price list management applied");
