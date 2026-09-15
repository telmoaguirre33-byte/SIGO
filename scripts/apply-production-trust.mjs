import fs from "node:fs";

const authPath = "src/SigoAuthGate.tsx";
let auth = fs.readFileSync(authPath, "utf8");

const legacy = 'const SIGO_PRODUCTION_URL = "https://comercial-lilac.vercel.app/";';
const hardened = 'const SIGO_PRODUCTION_URL = String(import.meta.env.VITE_PUBLIC_APP_URL ?? window.location.origin).replace(/\\/?$/, "/");';

if (auth.includes(legacy)) {
  auth = auth.replace(legacy, hardened);
} else if (!auth.includes("VITE_PUBLIC_APP_URL")) {
  throw new Error("SIGO_PRODUCTION_URL_TARGET_NOT_FOUND");
}

fs.writeFileSync(authPath, auth, "utf8");
console.log("SIGO_PRODUCTION_TRUST_OK");
