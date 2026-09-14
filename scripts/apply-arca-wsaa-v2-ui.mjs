import fs from "node:fs";

const path = "src/ArcaPreflight.tsx";
let source = fs.readFileSync(path, "utf8");
const from = 'fetch("/api/arca/wsaa", {';
const to = 'fetch("/api/arca/wsaa-v2", {';
if (!source.includes(from)) throw new Error("ARCA_WSAA_V2_UI_TARGET_NOT_FOUND");
source = source.replace(from, to);
fs.writeFileSync(path, source, "utf8");
console.log("SIGO_ARCA_WSAA_V2_UI_OK");
