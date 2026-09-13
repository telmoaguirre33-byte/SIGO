import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const menuPath = path.join(root, "src", "MobileOperationsMenu.tsx");
const cssPath = path.join(root, "src", "mobile-operations-menu.css");
const mainPath = path.join(root, "src", "main.tsx");

for (const file of [menuPath, cssPath, mainPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing mobile drawer/cart file: ${path.relative(root, file)}`);
}

const menu = fs.readFileSync(menuPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const main = fs.readFileSync(mainPath, "utf8");

for (const required of [
  "Abrir menú de SIGO",
  "Nueva venta / Carrito",
  "Ingresos",
  "Egresos",
  "Contactos / Clientes",
  "Productos",
  "Devoluciones / Anulaciones",
  "ARCA / Facturación",
  "Cuentas corrientes",
  "Informes",
  "Usuarios",
  "Configuración",
  "Ayuda",
  ".sigo-cart-menu-item, .sigo-cart-context-button",
]) {
  if (!menu.includes(required)) throw new Error(`Mobile menu safeguard missing: ${required}`);
}

for (const required of [
  ".sigo-mobile-operations-actions",
  ".sigo-mobile-menu-trigger",
  ".sigo-mobile-cart-trigger",
  ".sigo-mobile-drawer",
  "@media (max-width:760px)",
]) {
  if (!css.includes(required)) throw new Error(`Mobile menu CSS safeguard missing: ${required}`);
}

if (!main.includes("<MobileOperationsMenu />") || !main.includes('"./mobile-operations-menu.css"')) {
  throw new Error("Mobile menu must remain mounted in the production shell");
}

console.log("Mobile drawer/cart verified: hamburger topic menu and visible cart are mounted for phone operation.");
