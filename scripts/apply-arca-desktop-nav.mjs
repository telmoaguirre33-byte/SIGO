import fs from "node:fs";

const path = "src/SigoRoot.tsx";
let source = fs.readFileSync(path, "utf8");

const from = `          {!matrixMode && empresaActiva ? permitidos.map((item) => (\n            <button key={item} className={workspace === item ? "primary-button" : "admin-button"} aria-current={workspace === item ? "page" : undefined} onClick={() => abrirWorkspace(item)}>\n              {WORKSPACE_LABELS[item]}\n            </button>\n          )) : null}`;

const to = `          {!matrixMode && empresaActiva ? (\n            <>\n              {permitidos.map((item) => (\n                <button key={item} className={workspace === item ? "primary-button" : "admin-button"} aria-current={workspace === item ? "page" : undefined} onClick={() => abrirWorkspace(item)}>\n                  {WORKSPACE_LABELS[item]}\n                </button>\n              ))}\n              {["owner", "admin", "seller"].includes(empresaActiva.rol) ? (\n                <button\n                  className="admin-button"\n                  type="button"\n                  onClick={() => document.querySelector<HTMLButtonElement>(".arca-launcher")?.click()}\n                  aria-label="Abrir Facturación ARCA"\n                >\n                  ARCA\n                </button>\n              ) : null}\n            </>\n          ) : null}`;

if (!source.includes(from)) {
  if (source.includes('aria-label="Abrir Facturación ARCA"') && source.includes('document.querySelector<HTMLButtonElement>(".arca-launcher")')) {
    console.log("SIGO_ARCA_DESKTOP_NAV_ALREADY_OK");
    process.exit(0);
  }
  throw new Error("SIGO_ARCA_DESKTOP_NAV_TARGET_NOT_FOUND");
}

source = source.replace(from, to);
fs.writeFileSync(path, source, "utf8");
console.log("SIGO_ARCA_DESKTOP_NAV_OK");
