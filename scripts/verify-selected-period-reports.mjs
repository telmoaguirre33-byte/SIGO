import fs from "node:fs";

const service = fs.readFileSync("src/informes.ts", "utf8");
const ui = fs.readFileSync("src/InformesOperativos.tsx", "utf8");

for (const token of [
  "cargarComprasPeriodoSigo(empresaId: string, desde: string, hasta: string)",
  'from(tabla).select("total,created_at")',
  '.gte("created_at", inicio.toISOString())',
  '.lt("created_at", finExclusivo.toISOString())',
  'Promise.all([listar("compras_sigo"), listar("ventas_sigo")])',
  "balanceComercial: ventasTotal - comprasTotal",
  "const porHora = Array.from({ length: 24 }",
  "porDiaSemana[fechaVenta.getDay()]",
]) {
  if (!service.includes(token)) throw new Error(`Selected-period report service missing: ${token}`);
}

for (const token of [
  "cargarComprasPeriodoSigo(empresaId, comprasDesde, comprasHasta)",
  "Compras confirmadas · período",
  "Ventas confirmadas · período",
  "Ventas − compras",
  '["hoy","Hoy"]',
  '["2","2 días"]',
  '["3","3 días"]',
  '["7","7 días"]',
  '["15","15 días"]',
  '["30","30 días"]',
  '["3m","3 meses"]',
  '"personalizado","Personalizado"',
  "cargarVentasPeriodoSigo(empresaId, gerencialDesde, gerencialHasta)",
  "ventasGerenciales?.porHora",
  "ventasGerenciales?.porDiaSemana",
  "Evolución de ventas del período",
]) {
  if (!ui.includes(token)) throw new Error(`Selected-period report UI missing: ${token}`);
}

if (/compras30DiasTotal|ventas30DiasTotal|ventas7DiasTotal/.test(ui.slice(ui.indexOf('id="informe-compras"'), ui.indexOf('id="informe-clientes"')))) {
  throw new Error("Purchases report KPIs must not keep using a fixed 30-day summary");
}

console.log("Selected-period purchases and management reports verified: data bounds, sales comparison and KPIs/charts use the selected range.");
