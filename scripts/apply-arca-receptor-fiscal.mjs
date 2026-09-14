import fs from "node:fs";

const path = "api/arca/cae-v2.js";
let source = fs.readFileSync(path, "utf8");

if (!source.includes("const receptorCuit = digits(req.body?.receptorCuit);")) {
  const from = '  const condicionIvaReceptorId = entero(req.body?.condicionIvaReceptorId, 1, 99);\n';
  const to = `${from}  const receptorCuit = digits(req.body?.receptorCuit);\n  const receptorRazonSocial = String(req.body?.receptorRazonSocial || "").trim().slice(0, 160);\n`;
  if (!source.includes(from)) throw new Error("ARCA_RECEPTOR_INPUT_TARGET_NOT_FOUND");
  source = source.replace(from, to);
}

if (!source.includes("ARCA_RECEPTOR_CUIT_REQUIRED")) {
  const from = `    let receptor = { docTipo: 99, docNro: "0", condicionIvaReceptorId };\n    if (venta.cliente_id) {\n      if (!(await permiso(sesion, empresaId, "clients.read"))) return json(res, 403, { error: "ARCA_CLIENT_READ_FORBIDDEN" });\n      const cliente = first(await rest(sesion, \`clientes_sigo?id=eq.\${encodeURIComponent(venta.cliente_id)}&empresa_id=eq.\${encodeURIComponent(empresaId)}&activo=is.true&select=documento,arca_doc_tipo,condicion_iva_receptor_id\`));\n      const docTipo = entero(cliente?.arca_doc_tipo, 1, 999);\n      const docNro = digits(cliente?.documento);\n      const condicion = entero(cliente?.condicion_iva_receptor_id, 1, 99);\n      if (!docTipo || !docNro || !condicion) return json(res, 409, { error: "ARCA_CLIENT_FISCAL_DATA_REQUIRED" });\n      receptor = { docTipo, docNro, condicionIvaReceptorId: condicion };\n    } else if (!condicionIvaReceptorId) {\n      return json(res, 409, { error: "ARCA_CONSUMER_IVA_CONDITION_REQUIRED" });\n    }\n    if (tipoCbte === 1 && (!venta.cliente_id || receptor.docTipo !== 80 || receptor.docNro.length !== 11 || receptor.condicionIvaReceptorId !== 1)) return json(res, 409, { error: "ARCA_INVOICE_A_CLIENT_REQUIRED" });\n`;

  const to = `    let receptor = { docTipo: 99, docNro: "0", condicionIvaReceptorId, razonSocial: "Consumidor Final" };\n    if (venta.cliente_id) {\n      if (!(await permiso(sesion, empresaId, "clients.read"))) return json(res, 403, { error: "ARCA_CLIENT_READ_FORBIDDEN" });\n      const cliente = first(await rest(sesion, \`clientes_sigo?id=eq.\${encodeURIComponent(venta.cliente_id)}&empresa_id=eq.\${encodeURIComponent(empresaId)}&activo=is.true&select=nombre,documento,arca_doc_tipo,condicion_iva_receptor_id\`));\n      const docTipo = entero(cliente?.arca_doc_tipo, 1, 999);\n      const docNro = digits(cliente?.documento);\n      const condicion = entero(cliente?.condicion_iva_receptor_id, 1, 99);\n      if (!docTipo || !docNro || !condicion) return json(res, 409, { error: "ARCA_CLIENT_FISCAL_DATA_REQUIRED" });\n      receptor = { docTipo, docNro, condicionIvaReceptorId: condicion, razonSocial: String(cliente?.nombre || "").trim() };\n    } else if (!condicionIvaReceptorId) {\n      return json(res, 409, { error: "ARCA_CONSUMER_IVA_CONDITION_REQUIRED" });\n    } else if ([1, 6].includes(condicionIvaReceptorId)) {\n      if (!/^\\d{11}$/.test(receptorCuit)) return json(res, 409, { error: "ARCA_RECEPTOR_CUIT_REQUIRED" });\n      if (receptorRazonSocial.length < 2) return json(res, 409, { error: "ARCA_RECEPTOR_RAZON_SOCIAL_REQUIRED" });\n      receptor = { docTipo: 80, docNro: receptorCuit, condicionIvaReceptorId, razonSocial: receptorRazonSocial };\n    }\n    if (tipoCbte === 1 && (receptor.docTipo !== 80 || receptor.docNro.length !== 11 || receptor.condicionIvaReceptorId !== 1)) return json(res, 409, { error: "ARCA_INVOICE_A_CLIENT_REQUIRED" });\n`;

  if (!source.includes(from)) throw new Error("ARCA_RECEPTOR_BLOCK_TARGET_NOT_FOUND");
  source = source.replace(from, to);
}

fs.writeFileSync(path, source);
console.log("SIGO_ARCA_RECEPTOR_FISCAL_PATCH_OK");
