import fs from "node:fs";

const patch = fs.readFileSync("scripts/apply-matriz-support-entry.mjs", "utf8");
for (const token of [
  "entrarEmpresaSoporte",
  "Entrar a empresa",
  "Cerrar soporte",
  "onOpenEmpresa(empresa.empresa_id)",
]) {
  if (!patch.includes(token)) throw new Error(`Falta ${token} en parche de Matriz`);
}

console.log("SIGO matriz soporte entry: OK");
