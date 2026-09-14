import fs from "node:fs";

const path = "api/arca/wsaa.js";
let s = fs.readFileSync(path, "utf8");

function replaceOnce(from, to, label) {
  if (!s.includes(from)) throw new Error(`ARCA PV sync v2 missing token: ${label}`);
  s = s.replace(from, to);
}

replaceOnce(
  `  const faltantes = puntosConfigurados.filter((numero) => !habilitados.includes(numero));\n  if (faltantes.length > 0) throw new Error(\`PUNTO_VENTA_NO_HABILITADO_CAE:\${faltantes.join(",")}\`);\n  return { puntosArca: habilitados };`,
  `  const coincidentes = puntosConfigurados.filter((numero) => habilitados.includes(numero));\n  const faltantes = puntosConfigurados.filter((numero) => !habilitados.includes(numero));\n  return { puntosArca: habilitados, puntosCoincidentes: coincidentes, puntosConfiguradosInvalidos: faltantes };`,
  "validarWsfe result",
);

replaceOnce(
  `function errorSeguro(error) {`,
  `async function sincronizarPuntoVentaAutoritativo(sesion, empresaId, ambiente, puntosConfigurados, wsfe) {\n  const habilitados = Array.isArray(wsfe?.puntosArca)\n    ? [...new Set(wsfe.puntosArca.map(Number).filter((numero) => Number.isInteger(numero) && numero > 0))]\n    : [];\n  if (habilitados.length === 0) {\n    throw new Error(\`PUNTO_VENTA_NO_HABILITADO_CAE:\${puntosConfigurados.join(",")}:ARCA_SIN_PUNTOS_CAE\`);\n  }\n\n  const actualesOrdenados = [...new Set(puntosConfigurados.map(Number))].sort((a, b) => a - b);\n  const arcaOrdenados = [...habilitados].sort((a, b) => a - b);\n  const yaSincronizados = actualesOrdenados.length === arcaOrdenados.length\n    && actualesOrdenados.every((numero, index) => numero === arcaOrdenados[index]);\n  if (yaSincronizados) return arcaOrdenados;\n\n  const base = \`\${sesion.url}/rest/v1/arca_puntos_venta\`;\n  const authHeaders = { apikey: sesion.anonKey, Authorization: sesion.auth, "Content-Type": "application/json" };\n\n  const disable = await fetch(\`\${base}?empresa_id=eq.\${encodeURIComponent(empresaId)}&ambiente=eq.\${encodeURIComponent(ambiente)}&activo=is.true\`, {\n    method: "PATCH",\n    headers: { ...authHeaders, Prefer: "return=minimal" },\n    body: JSON.stringify({ activo: false, updated_at: new Date().toISOString() }),\n  });\n  if (!disable.ok) throw new Error(\`PUNTO_VENTA_SYNC_DISABLE_FAILED:\${disable.status}\`);\n\n  for (const numero of arcaOrdenados) {\n    const upsert = await fetch(\`\${base}?on_conflict=empresa_id,ambiente,numero\`, {\n      method: "POST",\n      headers: { ...authHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },\n      body: JSON.stringify({ empresa_id: empresaId, ambiente, numero, nombre: \`ARCA CAE \${String(numero).padStart(4, "0")}\`, activo: true, updated_at: new Date().toISOString() }),\n    });\n    if (!upsert.ok) throw new Error(\`PUNTO_VENTA_SYNC_UPSERT_FAILED:\${upsert.status}:\${numero}\`);\n  }\n  return arcaOrdenados;\n}\n\nfunction errorSeguro(error) {`,
  "sync helper",
);

replaceOnce(
  `    const wsfe = await validarWsfe(WSFE[config.ambiente], ticket, config.cuit_emisor, puntosConfigurados, sesion.auth, config.ambiente);\n\n    await guardarEstado(sesion, empresaId, {`,
  `    const wsfe = await validarWsfe(WSFE[config.ambiente], ticket, config.cuit_emisor, puntosConfigurados, sesion.auth, config.ambiente);\n    const puntosEfectivos = await sincronizarPuntoVentaAutoritativo(sesion, empresaId, config.ambiente, puntosConfigurados, wsfe);\n\n    await guardarEstado(sesion, empresaId, {`,
  "handler sync",
);

replaceOnce(
  `      puntosVentaConfigurados: puntosConfigurados,`,
  `      puntosVentaConfigurados: puntosEfectivos,`,
  "handler response",
);

fs.writeFileSync(path, s, "utf8");
console.log("SIGO_ARCA_PV_SYNC_V2_OK");
