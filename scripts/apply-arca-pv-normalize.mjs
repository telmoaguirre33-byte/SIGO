import fs from "node:fs";

const path = "api/arca/wsaa.js";
let s = fs.readFileSync(path, "utf8");

const from = `  const habilitados = puntosArca\n    .filter((item) => item.bloqueado !== "S" && !item.fechaBaja && item.emisionTipo === "CAE")\n    .map((item) => item.numero);`;

const to = `  const activos = puntosArca.filter((item) => {\n    const baja = String(item.fechaBaja || "").replace(/\\D/g, "");\n    const dadoDeBaja = /^\\d{8}$/.test(baja) && Number(baja) >= 19000101;\n    return item.bloqueado !== "S" && !dadoDeBaja;\n  });\n  const caeDeclarados = activos.filter((item) => item.emisionTipo === "CAE");\n  const noCaea = activos.filter((item) => item.emisionTipo !== "CAEA");\n  const baseHabilitados = caeDeclarados.length > 0 ? caeDeclarados : noCaea;\n  const habilitados = [...new Set(baseHabilitados.map((item) => item.numero))];`;

if (!s.includes(from)) throw new Error("ARCA PV normalize patch missing token");
s = s.replace(from, to);
fs.writeFileSync(path, s, "utf8");
console.log("SIGO_ARCA_PV_NORMALIZE_OK");
