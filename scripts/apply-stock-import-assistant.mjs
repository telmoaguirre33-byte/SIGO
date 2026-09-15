import fs from "node:fs";

const appFile = new URL("../src/SigoApp.tsx", import.meta.url);
let app = fs.readFileSync(appFile, "utf8");

const importAnchor = 'import BarcodeScanner from "./BarcodeScanner";';
const importLine = 'import StockImportAssistant from "./StockImportAssistant";';
if (!app.includes(importLine)) {
  if (!app.includes(importAnchor)) throw new Error("No se encontró el ancla de BarcodeScanner en SigoApp.tsx");
  app = app.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

const actionOld = '{puedeEditar ? <button className="primary-button" onClick={abrirNuevo}>Nuevo producto</button> : <span>Modo solo lectura</span>}';
const actionNew = `{puedeEditar ? (\n            <>\n              <StockImportAssistant empresaId={empresaId} productos={productos} onImported={() => cargar()} />\n              <button className="primary-button" onClick={abrirNuevo}>Nuevo producto</button>\n            </>\n          ) : <span>Modo solo lectura</span>}`;
if (!app.includes("<StockImportAssistant empresaId={empresaId}")) {
  if (!app.includes(actionOld)) throw new Error("No se encontró el botón Nuevo producto para integrar importación de stock");
  app = app.replace(actionOld, actionNew);
}

fs.writeFileSync(appFile, app);

const mainFile = new URL("../src/main.tsx", import.meta.url);
let main = fs.readFileSync(mainFile, "utf8");
const cssLine = 'import "./stock-import.css";';
const cssAnchor = 'import "./sigo-ayuda.css";';
if (!main.includes(cssLine)) {
  if (!main.includes(cssAnchor)) throw new Error("No se encontró el ancla CSS en main.tsx");
  main = main.replace(cssAnchor, `${cssAnchor}\n${cssLine}`);
  fs.writeFileSync(mainFile, main);
}

console.log("SIGO stock import assistant aplicado");
