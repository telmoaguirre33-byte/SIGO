import fs from "node:fs";

const checks = [
  ["src/StockImportAssistant.tsx", ["Cargar mis productos", "Descargar planilla simple", "Foto de factura con IA", "Todavía no se modificó el stock", "Las filas marcadas"]],
  ["src/stockImportExcel.ts", ["SIGO-plantilla-stock.xlsx", "leerArchivoStock", "prepararImportacionStock", "importarFilasStockSigo", "guardarProductoSigo"]],
  ["src/stock-import.css", ["stock-import-modal", "stock-import-stats", "@media(max-width:760px)"]],
  ["scripts/apply-stock-import-assistant.mjs", ["StockImportAssistant", "stock-import.css"]],
];

for (const [file, tokens] of checks) {
  const source = fs.readFileSync(file, "utf8");
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`${file}: falta ${token}`);
  }
}

console.log("SIGO stock import assistant: OK");
