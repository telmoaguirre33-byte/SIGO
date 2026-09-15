import fs from "node:fs";

const file = new URL("../src/MatrizAdmin.tsx", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const cerrarAnchor = "  async function cerrarSoporte(empresa: EmpresaMatriz) {";
const helper = `  async function entrarEmpresaSoporte(empresa: EmpresaMatriz) {\n    if (!empresa.activa) return;\n    setWorkingId(empresa.empresa_id);\n    setError(\"\");\n    setMensaje(\"\");\n    try {\n      await onOpenEmpresa(empresa.empresa_id);\n    } catch (e) {\n      console.error(e);\n      setError(\"No pudimos entrar a esa empresa en modo soporte.\");\n    } finally {\n      setWorkingId(null);\n    }\n  }\n\n`;

if (!source.includes("async function entrarEmpresaSoporte(")) {
  if (!source.includes(cerrarAnchor)) throw new Error("MATRIZ_SUPPORT_HELPER_ANCHOR_NOT_FOUND");
  source = source.replace(cerrarAnchor, `${helper}${cerrarAnchor}`);
}

const oldBlock = `                    {empresa.soporte_activo ? (\n                      <button className=\"admin-button\" type=\"button\" disabled={workingId === empresa.empresa_id} onClick={() => void cerrarSoporte(empresa)}>Cerrar soporte</button>\n                    ) : (\n                      <button className=\"primary-button\" type=\"button\" disabled={!empresa.activa || workingId === empresa.empresa_id} onClick={() => void abrirSoporte(empresa)}>Entrar en soporte</button>\n                    )}`;

const newBlock = `                    {empresa.soporte_activo ? (\n                      <>\n                        <button className=\"primary-button\" type=\"button\" disabled={!empresa.activa || workingId === empresa.empresa_id} onClick={() => void entrarEmpresaSoporte(empresa)}>Entrar a empresa</button>\n                        <button className=\"admin-button\" type=\"button\" disabled={workingId === empresa.empresa_id} onClick={() => void cerrarSoporte(empresa)}>Cerrar soporte</button>\n                      </>\n                    ) : (\n                      <button className=\"primary-button\" type=\"button\" disabled={!empresa.activa || workingId === empresa.empresa_id} onClick={() => void abrirSoporte(empresa)}>Entrar en soporte</button>\n                    )}`;

if (!source.includes("onClick={() => void entrarEmpresaSoporte(empresa)}")) {
  if (!source.includes(oldBlock)) throw new Error("MATRIZ_SUPPORT_ACTION_BLOCK_NOT_FOUND");
  source = source.replace(oldBlock, newBlock);
}

fs.writeFileSync(file, source, "utf8");
console.log("SIGO matriz soporte: acceso con soporte abierto aplicado");
