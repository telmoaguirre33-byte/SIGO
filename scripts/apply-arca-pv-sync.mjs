import fs from "node:fs";

const path = "api/arca/wsaa.js";
let s = fs.readFileSync(path, "utf8");

function replaceOnce(from, to, label) {
  if (!s.includes(from)) throw new Error(`ARCA PV sync patch missing token: ${label}`);
  s = s.replace(from, to);
}

replaceOnce(
  `  const faltantes = puntosConfigurados.filter((numero) => !habilitados.includes(numero));\n  if (faltantes.length > 0) throw new Error(\`PUNTO_VENTA_NO_HABILITADO_CAE:\${faltantes.join(",")}\`);\n  return { puntosArca: habilitados };`,
  `  const coincidentes = puntosConfigurados.filter((numero) => habilitados.includes(numero));\n  const faltantes = puntosConfigurados.filter((numero) => !habilitados.includes(numero));\n  return { puntosArca: habilitados, puntosCoincidentes: coincidentes, puntosConfiguradosInvalidos: faltantes };`,
  "validarWsfe result",
);

replaceOnce(
  `function errorSeguro(error) {`,
  `async function sincronizarPuntosVentaAutoritativos(sesion, empresaId, ambiente, wsfe) {\n  const habilitados = Array.isArray(wsfe?.puntosArca) ? wsfe.puntosArca.filter((numero) => Number.isInteger(numero) && numero > 0) : [];\n  if (habilitados.length === 0) throw new Error("PUNTO_VENTA_NO_HABILITADO_CAE:SIN_PUNTOS_ARCA");\n\n  const base = \`\${sesion.url}/rest/v1/arca_puntos_venta\`;\n  const authHeaders = { apikey: sesion.anonKey, Authorization: sesion.auth, "Content-Type": "application/json" };\n  const now = new Date().toISOString();\n\n  const disable = await fetch(\`\${base}?empresa_id=eq.\${encodeURIComponent(empresaId)}&ambiente=eq.\${encodeURIComponent(ambiente)}&activo=is.true\`, {\n    method: "PATCH",\n    headers: { ...authHeaders, Prefer: "return=minimal" },\n    body: JSON.stringify({ activo: false, updated_at: now }),\n  });\n  if (!disable.ok) throw new Error(\`PUNTO_VENTA_SYNC_DISABLE_FAILED:\${disable.status}\`);\n\n  for (const numero of habilitados) {\n    const upsert = await fetch(\`\${base}?on_conflict=empresa_id,ambiente,numero\`, {\n      method: "POST",\n      headers: { ...authHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },\n      body: JSON.stringify({\n        empresa_id: empresaId,\n        ambiente,\n        numero,\n        nombre: \`ARCA CAE \${String(numero).padStart(4, "0")}\`,\n        activo: true,\n        updated_at: now,\n      }),\n    });\n    if (!upsert.ok) throw new Error(\`PUNTO_VENTA_SYNC_UPSERT_FAILED:\${numero}:\${upsert.status}\`);\n  }\n\n  return habilitados;\n}\n\nfunction errorSeguro(error) {`,
  "sync helper",
);

replaceOnce(
  `    const wsfe = await validarWsfe(WSFE[config.ambiente], ticket, config.cuit_emisor, puntosConfigurados, sesion.auth, config.ambiente);\n\n    await guardarEstado(sesion, empresaId, {`,
  `    const wsfe = await validarWsfe(WSFE[config.ambiente], ticket, config.cuit_emisor, puntosConfigurados, sesion.auth, config.ambiente);\n    const puntosEfectivos = await sincronizarPuntosVentaAutoritativos(sesion, empresaId, config.ambiente, wsfe);\n\n    await guardarEstado(sesion, empresaId, {`,
  "handler sync",
);

replaceOnce(
  `      puntosVentaConfigurados: puntosConfigurados,`,
  `      puntosVentaConfigurados: puntosEfectivos,`,
  "handler response",
);

fs.writeFileSync(path, s, "utf8");
console.log("SIGO_ARCA_PV_SYNC_ALL_PATCH_OK");
