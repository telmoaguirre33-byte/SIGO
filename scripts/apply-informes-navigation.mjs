import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Follow the existing build-time UI patches. Never duplicate reports or touch data.
function replaceOnce(source, before, after, label) {
  if (source.includes(after) && !source.includes(before)) return source;
  if (source.split(before).length !== 2) {
    throw new Error(`SIGO_INFORMES_NAV_TARGET_NOT_FOUND: ${label}`);
  }
  return source.replace(before, after);
}

export function patchInformesNavigation(appSource, rootSource) {
  let app = replaceOnce(
    appSource,
    'export default function SigoApp({ empresa, initialSection = "Inicio", purchasesOnly = false }: { empresa: EmpresaOperativa; initialSection?: Section; purchasesOnly?: boolean }) {',
    'export default function SigoApp({ empresa, initialSection = "Inicio", purchasesOnly = false, onAbrirInformes }: { empresa: EmpresaOperativa; initialSection?: Section; purchasesOnly?: boolean; onAbrirInformes?: () => void }) {',
    "SigoApp reports callback",
  );
  app = replaceOnce(
    app,
    '{sections.map((item) => (',
    '{sections.filter((item) => item !== "Informes" || Boolean(onAbrirInformes)).map((item) => (',
    "reports visibility follows workspace permissions",
  );
  app = replaceOnce(
    app,
    'onClick={() => setSection(item)}',
    'onClick={() => { if (item === "Informes") { onAbrirInformes?.(); return; } setSection(item); }}',
    "reports uses parent navigation instead of pending section",
  );
  const root = replaceOnce(
    rootSource,
    '<SigoApp key={empresaActiva.empresa_id} empresa={empresaActiva} />',
    '<SigoApp key={empresaActiva.empresa_id} empresa={empresaActiva} onAbrirInformes={workspacePermitido(empresaActiva.rol, "informes") ? () => abrirWorkspace("informes") : undefined} />',
    "same permission-checked destination as the top menu",
  );
  return { app, root };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appPath = new URL("../src/SigoApp.tsx", import.meta.url);
  const rootPath = new URL("../src/SigoRoot.tsx", import.meta.url);
  // Validate both sources before writing either one.
  const result = patchInformesNavigation(
    fs.readFileSync(appPath, "utf8"),
    fs.readFileSync(rootPath, "utf8"),
  );
  fs.writeFileSync(appPath, result.app, "utf8");
  fs.writeFileSync(rootPath, result.root, "utf8");
  console.log("SIGO_INFORMES_SHARED_NAVIGATION_OK");
}
