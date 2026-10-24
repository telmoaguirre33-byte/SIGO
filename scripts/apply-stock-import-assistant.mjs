import fs from "node:fs";

const appFile = new URL("../src/SigoApp.tsx", import.meta.url);
let app = fs.readFileSync(appFile, "utf8");

const importAnchor = 'import BarcodeScanner from "./BarcodeScanner";';
const importLine = 'import StockImportAssistant from "./StockImportAssistant";';
if (!app.includes(importLine)) {
  if (!app.includes(importAnchor)) throw new Error("No se encontró el ancla de BarcodeScanner en SigoApp.tsx");
  app = app.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

const renderOld = '          {section === "Productos" && <Productos empresaId={empresa.empresa_id} puedeEditar={puedeEditarProductos} />}';
const renderNew = '          {section === "Productos" && <Productos empresaId={empresa.empresa_id} puedeEditar={puedeEditarProductos} puedeImportar={can(empresa.rol, "products.write") && can(empresa.rol, "stock.write") && (can(empresa.rol, "sales.write") || can(empresa.rol, "price_lists.read"))} />}';
// Corrección inicial agrega props que deben conservarse al integrar importación.
const renderCorrection = '          {section === "Productos" && <Productos key={empresa.empresa_id} empresaId={empresa.empresa_id} puedeEditar={puedeEditarProductos} puedeCorregirUnidad={puedeCorregirUnidad} onCorreccionAbierta={setCorreccionAbierta} />}';
const importPermission = ' puedeImportar={can(empresa.rol, "products.write") && can(empresa.rol, "stock.write") && (can(empresa.rol, "sales.write") || can(empresa.rol, "price_lists.read"))}';
const renderCorrectionNew = renderCorrection.replace(' />}', `${importPermission} />}`);
if (!app.includes(renderNew) && !app.includes(renderCorrectionNew)) {
  if (app.includes(renderCorrection)) app = app.replace(renderCorrection, renderCorrectionNew);
  else if (app.includes(renderOld)) app = app.replace(renderOld, renderNew);
  else throw new Error("No se encontró el render de Productos para habilitar importación segura");
}

const signatureOld = 'function Productos({ empresaId, puedeEditar }: { empresaId: string; puedeEditar: boolean }) {';
const signatureNew = 'function Productos({ empresaId, puedeEditar, puedeImportar }: { empresaId: string; puedeEditar: boolean; puedeImportar: boolean }) {';
const signatureCorrection = 'function Productos({ empresaId, puedeEditar, puedeCorregirUnidad, onCorreccionAbierta }: { empresaId: string; puedeEditar: boolean; puedeCorregirUnidad: boolean; onCorreccionAbierta: (abierta: boolean) => void }) {';
const signatureCorrectionNew = signatureCorrection
  .replace('onCorreccionAbierta }:', 'onCorreccionAbierta, puedeImportar }:')
  .replace('onCorreccionAbierta: (abierta: boolean) => void }', 'onCorreccionAbierta: (abierta: boolean) => void; puedeImportar: boolean }');
if (!app.includes(signatureNew) && !app.includes(signatureCorrectionNew)) {
  if (app.includes(signatureCorrection)) app = app.replace(signatureCorrection, signatureCorrectionNew);
  else if (app.includes(signatureOld)) app = app.replace(signatureOld, signatureNew);
  else throw new Error("No se encontró la firma de Productos para integrar importación segura");
}

const actionOld = '{puedeEditar ? <button className="primary-button" onClick={abrirNuevo}>Nuevo producto</button> : <span>Modo solo lectura</span>}';
const actionNew = `{puedeEditar ? (\n            <>\n              {puedeImportar && <StockImportAssistant empresaId={empresaId} productos={productos} onImported={() => cargar()} />}\n              <button className="primary-button" onClick={abrirNuevo}>Nuevo producto</button>\n            </>\n          ) : <span>Modo solo lectura</span>}`;
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

// En producción el lector XLSX anterior dependía de DecompressionStream del navegador.
// Algunos Android/WebView no soportan correctamente deflate-raw. En build, redirigimos
// solamente la lectura del archivo al lector móvil basado en fflate/read-excel-file.
const assistantFile = new URL("../src/StockImportAssistant.tsx", import.meta.url);
let assistant = fs.readFileSync(assistantFile, "utf8");
const robustImport = 'import { leerArchivoStockMovil as leerArchivoStock } from "./stockImportReader";';
if (!assistant.includes(robustImport)) {
  const facturaImport = 'import { analizarFacturaCompraSigo } from "./facturaIA";';
  if (!assistant.includes(facturaImport)) throw new Error("No se encontró el import de facturaIA en StockImportAssistant.tsx");
  assistant = assistant.replace(facturaImport, `${facturaImport}\n${robustImport}`);
  assistant = assistant.replace('  leerArchivoStock,\n', '');
}

const inputOld = '<input ref={excelRef} className="stock-import-hidden" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => void cargarExcel(event)} />';
const inputNew = '<input ref={excelRef} className="stock-import-hidden" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => void cargarExcel(event)} />';
if (assistant.includes(inputOld)) assistant = assistant.replace(inputOld, inputNew);

fs.writeFileSync(assistantFile, assistant);

console.log("SIGO stock import assistant aplicado");
