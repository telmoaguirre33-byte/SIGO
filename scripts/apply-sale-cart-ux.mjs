import fs from "node:fs";
const path="src/VentaRapidaOperativa.tsx";
const s=fs.readFileSync(path,"utf8");
if(!s.includes('className="sigo-pos"')) throw new Error("SALE_POS_LAYOUT_MISSING");
console.log("SIGO_SALE_CART_UX_OK");
