import fs from "node:fs";

const path = "src/ArcaCaeEmission.tsx";
let source = fs.readFileSync(path, "utf8");
const from = 'fetch("/api/arca/cae", {';
const to = 'fetch("/api/arca/cae-v2", {';
if (!source.includes(from) && !source.includes(to)) throw new Error("ARCA_CAE_V2_UI_TARGET_NOT_FOUND");
if (source.includes(from)) source = source.replace(from, to);
fs.writeFileSync(path, source, "utf8");
console.log("SIGO_ARCA_CAE_V2_UI_OK");
