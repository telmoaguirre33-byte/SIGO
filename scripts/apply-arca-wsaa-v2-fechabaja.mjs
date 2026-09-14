import fs from "node:fs";

const path = "api/arca/wsaa-v2.js";
let source = fs.readFileSync(path, "utf8");

const from = '  const activos = puntos.filter((item) => item.bloqueado !== "S" && !item.fechaBaja);';
const to = `  const activos = puntos.filter((item) => {\n    const bajaRaw = String(item.fechaBaja || "").trim().toUpperCase();\n    const bajaDigitos = bajaRaw.replace(/\\D/g, "");\n    const dadoDeBaja = bajaRaw !== "" && bajaRaw !== "NULL" && bajaRaw !== "N/A" && bajaDigitos !== "00000000" && /^\\d{8}$/.test(bajaDigitos);\n    return item.bloqueado !== "S" && !dadoDeBaja;\n  });`;

if (!source.includes(from)) throw new Error("ARCA_WSAA_V2_FECHABAJA_TARGET_NOT_FOUND");
source = source.replace(from, to);
fs.writeFileSync(path, source, "utf8");
console.log("SIGO_ARCA_WSAA_V2_FECHABAJA_OK");
