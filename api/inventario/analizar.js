// One photograph per client batch; deadline stays below the existing 30s budget.
export const config = { maxDuration: 30 };
const MAX_IMAGES = 10, MAX_BODY_BYTES = 4_000_000, DEADLINE_MS = 25_000;
function json(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).send(JSON.stringify(body));
}
function failure(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function textOut(data) {
  if (data?.promptFeedback?.blockReason) throw failure(422, "AI_BLOCKED", "El proveedor no pudo analizar esta foto. Probá con otra toma.");
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") throw failure(502, "AI_INCOMPLETE", "La IA devolvió un análisis incompleto. Reintentá esta foto.");
  return (candidate?.content?.parts || []).map(p => p?.text || "").join("\n").trim();
}
function finite(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }

function textoNormalizado(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
// Same family guard as the existing inventory flow: unrelated catalog IDs may
// never become a match or a missing shelf product, even if Gemini returns them.
function productoDelBloque(producto, bloque, detectados) {
  const contenido = textoNormalizado([producto.nombre, producto.categoria, producto.marca].filter(Boolean).join(" "));
  const familia = textoNormalizado(bloque);
  const familias = [
    { patron: /bebid|gaseos|refresc|drink|cola/, terminos: ["bebida","gaseosa","agua","cerveza","jugo","energizante","soda","tonica","coca","cola","fanta","sprite","schweppes","monster","power","cepita","vino","sidra","lata"] },
    { patron: /librer|papeler|escolar/, terminos: ["cuaderno","lapiz","lapicera","papel","carpeta","goma","regla","marcador","resaltador","cartuchera","tinta","toner"] },
    { patron: /limpieza|higiene/, terminos: ["detergente","lavandina","jabon","limpiador","desinfectante","papel higienico","shampoo","acondicionador"] },
    { patron: /almacen|comestible|alimento/, terminos: ["fideo","arroz","harina","azucar","aceite","galletita","yerba","cafe","leche","conserva","salsa","snack"] },
  ];
  const conocida = familias.find(item => item.patron.test(familia));
  if (conocida) return conocida.terminos.some(termino => contenido.includes(termino));
  const palabrasVisibles = detectados.flatMap(item => textoNormalizado(item.descripcion).split(/[^a-z0-9]+/)).filter(palabra => palabra.length >= 4 && !["pack","latas","unidad","unidades","botella","botellas","tamaño","sabor"].includes(palabra));
  if (palabrasVisibles.some(palabra => contenido.includes(palabra))) return true;
  return !!(producto.categoria && familia && familia.split(/[^a-z0-9]+/).filter(palabra => palabra.length >= 4).some(palabra => contenido.includes(palabra)));
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "METHOD_NOT_ALLOWED", message: "Usá POST para analizar las fotos." }); }
  const started = Date.now(), requestId = "inv-" + started.toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const controller = new AbortController();
  let deadline = false;
  const timer = setTimeout(() => { deadline = true; controller.abort(); }, DEADLINE_MS);
  const cancel = () => controller.abort();
  const disconnected = () => { if (!res.writableEnded) cancel(); };
  req.on?.("aborted", cancel);
  res.on?.("close", disconnected);
  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { throw failure(400, "INVALID_INPUT", "La solicitud no contiene JSON válido."); } }
    const empresaId = String(body?.empresaId || ""), imagenes = body?.imagenes;
    if (Buffer.byteLength(JSON.stringify(body || {}), "utf8") > MAX_BODY_BYTES) throw failure(413, "PAYLOAD_TOO_LARGE", "Las fotos superan el límite de envío. Reintentá con una foto por vez.");
    if (!empresaId || !Array.isArray(imagenes) || imagenes.length < 1 || imagenes.length > MAX_IMAGES || imagenes.some(x => typeof x !== "string" || !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(x))) throw failure(400, "INVALID_INPUT", "Seleccioná entre 1 y 10 fotos JPG, PNG o WebP. Convertí HEIC a JPG si el navegador no lo admite.");
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer ")) throw failure(401, "SESSION_EXPIRED", "La sesión venció. Volvé a ingresar a SIGO.");
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!url || !key || !apiKey) throw failure(503, "AI_NOT_CONFIGURED", "El análisis de inventario no está configurado. Avisá al administrador.");
    const options = { headers: { apikey: key, Authorization: auth }, signal: controller.signal };
    const user = await fetch(url + "/auth/v1/user", options);
    if (!user.ok) throw failure(user.status === 401 || user.status === 403 ? 401 : 502, "AUTH_UNAVAILABLE", user.status === 401 || user.status === 403 ? "La sesión venció. Volvé a ingresar a SIGO." : "No se pudo validar la sesión. Reintentá en unos minutos.");
    const permission = await fetch(url + "/rest/v1/rpc/tiene_permiso_empresa", { ...options, method: "POST", headers: { ...options.headers, "Content-Type": "application/json" }, body: JSON.stringify({ p_empresa_id: empresaId, p_permiso: "stock.read" }) });
    if (!permission.ok) throw failure(503, "PERMISSION_UNAVAILABLE", "No se pudo verificar el permiso de inventario. Avisá al administrador.");
    if ((await permission.json()) !== true) throw failure(403, "FORBIDDEN", "No tenés permiso para consultar el inventario de esta empresa.");
    const pr = await fetch(url + "/rest/v1/productos?empresa_id=eq." + encodeURIComponent(empresaId) + "&select=id,nombre,codigo_interno,codigo_barras,categoria,marca,stock_actual&limit=5000", { ...options, headers: { ...options.headers, Prefer: "count=exact" } });
    if (!pr.ok) throw failure(502, "PRODUCTS_UNAVAILABLE", "No se pudo consultar el catálogo de SIGO. Reintentá en unos minutos.");
    const productos = await pr.json();
    if (!Array.isArray(productos)) throw failure(502, "PRODUCTS_UNAVAILABLE", "El catálogo de SIGO devolvió una respuesta inválida.");
    // A truncated catalog must never assert that a visible product is absent.
    const range = pr.headers?.get?.("content-range") || "", total = Number(range.split("/")[1]);
    const catalogoCompleto = range.endsWith("/*") ? false : range.includes("/") && Number.isFinite(total) ? productos.length >= total : productos.length < 1000;
    const catalogo = productos.map(p => ({ id: p.id, nombre: p.nombre, codigo: p.codigo_barras || p.codigo_interno || null, categoria: p.categoria || null, marca: p.marca || null, stock: p.stock_actual }));
    const prompt = "Sos el auditor visual de inventario de SIGO. Analizá las fotos de UNA zona de un comercio. Determiná el bloque/familia dominante. No compares categorías ajenas. Identificá productos visibles sin inventar marca, variante o tamaño. Buscá correspondencia en el catálogo por EAN legible o marca+nombre+variante+tamaño. Si no hay certeza devolvé revisar; falta_sigo sólo con confianza alta. ids_catalogo_no_vistos contiene sólo productos del MISMO bloque que razonablemente deberían estar en esta exhibición; nunca todo el padrón. foto usa numeración desde 1. x e y son porcentajes 0..100 de un punto cercano que no tape logo, marca, tamaño, código ni precio. Respondé sólo JSON: {\"bloque\":string,\"detectados\":[{\"descripcion\":string,\"codigo\":string|null,\"catalogo_id\":string|null,\"estado\":\"ok\"|\"sin_stock\"|\"falta_sigo\"|\"revisar\",\"confianza\":number,\"foto\":number,\"x\":number,\"y\":number}],\"ids_catalogo_no_vistos\":[string]}. CATÁLOGO SIGO: " + JSON.stringify(catalogo);
    const model = process.env.GEMINI_INVENTORY_MODEL || process.env.GEMINI_INVOICE_MODEL || "gemini-3.8-flash";
    const parts = [{ text: prompt }, ...imagenes.map(img => ({ inlineData: { mimeType: img.match(/^data:([^;]+);/)[1].replace("image/jpg", "image/jpeg"), data: img.split(",")[1] } }))];
    const ai = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", { method: "POST", headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 7000 } }) });
    if (!ai.ok) {
      const status = [413, 429, 503, 504].includes(ai.status) ? ai.status : 502;
      throw failure(status, "AI_HTTP_" + ai.status, ai.status === 413 ? "El proveedor rechazó el tamaño de la foto. Reducí la imagen antes de reintentar." : ai.status === 429 ? "La IA alcanzó su límite de solicitudes. Esperá antes de reintentar." : ai.status === 504 ? "El proveedor de IA agotó su tiempo de respuesta. Reintentá esta foto; las anteriores se conservan." : ai.status === 401 || ai.status === 403 ? "El proveedor rechazó la credencial de IA. Avisá al administrador." : ai.status === 404 ? "El modelo de IA configurado no está disponible. Avisá al administrador." : "El proveedor de IA no está disponible. Reintentá la foto en unos minutos.");
    }
    let raw;
    try { raw = JSON.parse(textOut(await ai.json()).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch (error) { if (error?.status || controller.signal.aborted) throw error; throw failure(502, "AI_INVALID_JSON", "La IA devolvió un análisis incompleto o inválido. Reintentá esta foto."); }
    if (!raw || typeof raw.bloque !== "string" || !Array.isArray(raw.detectados) || !Array.isArray(raw.ids_catalogo_no_vistos) || raw.detectados.some(d => !d || typeof d !== "object")) throw failure(502, "AI_INVALID_JSON", "La IA devolvió un análisis incompleto o inválido. Reintentá esta foto.");
    if (raw.detectados.length > 200 || raw.ids_catalogo_no_vistos.length > 100) throw failure(502, "AI_INCOMPLETE", "El análisis supera la capacidad de una revisión. Dividí la exhibición en bloques más pequeños para obtener un resultado completo.");
    const porId = new Map(productos.map(p => [String(p.id), p]));
    const detectados = raw.detectados.slice(0, 200).map((d, i) => {
      const candidate = porId.get(String(d.catalogo_id || "")), confianza = finite(d.confianza, 0, 0, 1);
      const p = candidate && productoDelBloque(candidate, raw.bloque, raw.detectados) ? candidate : null;
      const estado = p ? (confianza < .78 || p.stock_actual == null || !Number.isFinite(Number(p.stock_actual)) ? "revisar" : Number(p.stock_actual) > 0 ? "ok" : "sin_stock") : !candidate && d.estado === "falta_sigo" && confianza >= .8 && catalogoCompleto ? "falta_sigo" : "revisar";
      return { id: "v-" + i, descripcion: String(p?.nombre || d.descripcion || "Producto a revisar").slice(0, 160), codigo: String(p?.codigo_barras || p?.codigo_interno || d.codigo || "").slice(0, 80), categoria: String(p?.categoria || raw.bloque).slice(0, 100), stock_actual: p ? p.stock_actual : null, estado, confianza, foto: Math.round(finite(d.foto, 1, 1, imagenes.length)), x: finite(d.x, 50, 0, 100), y: finite(d.y, 50, 0, 100), catalogo_id: p?.id || null };
    });
    const vistos = new Set(detectados.map(d => d.catalogo_id).filter(Boolean));
    const noVistos = [...new Set(raw.ids_catalogo_no_vistos)].map(id => porId.get(String(id))).filter(p => p && productoDelBloque(p, raw.bloque, raw.detectados) && !vistos.has(p.id)).map((p, i) => ({ id: "n-" + i, descripcion: p.nombre, codigo: p.codigo_barras || p.codigo_interno || "", categoria: p.categoria || raw.bloque, stock_actual: p.stock_actual, estado: "no_visto", confianza: 1, foto: 0, x: 0, y: 0, catalogo_id: p.id }));
    console.info("inventory_analysis", { requestId, status: "ok", images: imagenes.length, findings: detectados.length + noVistos.length, durationMs: Date.now() - started, model });
    return json(res, 200, { bloque: raw.bloque.slice(0, 100), hallazgos: [...detectados, ...noVistos], requestId });
  } catch (error) {
    const status = error?.status || (deadline ? 504 : controller.signal.aborted ? 499 : 502);
    const code = typeof error?.code === "string" ? error.code : (deadline ? "AI_TIMEOUT" : controller.signal.aborted ? "CANCELLED" : "NETWORK_ERROR");
    const message = error?.status ? error.message : deadline ? "El proveedor de IA no respondió dentro del tiempo disponible. Reintentá esta foto; las anteriores se conservan." : controller.signal.aborted ? "Análisis cancelado. Las fotos se conservan para reintentar." : "No se pudo conectar con el proveedor de IA. Revisá la conexión o reintentá en unos minutos.";
    console.warn("inventory_analysis", { requestId, status, code, durationMs: Date.now() - started });
    return json(res, status, { error: code, message, requestId });
  } finally { clearTimeout(timer); req.off?.("aborted", cancel); res.off?.("close", disconnected); }
}
