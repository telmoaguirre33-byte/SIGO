const MAX_DATA_URL_LENGTH = 8_000_000;
const MAX_INVOICE_ITEMS = 300;
const GEMINI_TIMEOUT_MS = 45_000;
const ALLOWED_IMAGE = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
const ALLOWED_PDF = /^data:application\/pdf;base64,/i;
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const MIN_GENERAL_CONFIDENCE_AUTO = 0.35;
const MIN_LINE_CONFIDENCE_AUTO = 0.30;

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function getGeminiOutputText(data) {
  const parts = [];
  for (const candidate of Array.isArray(data?.candidates) ? data.candidates : []) {
    for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
      if (typeof part?.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

const FACTURA_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    proveedor: {
      type: "OBJECT",
      properties: {
        razon_social: { type: "STRING", nullable: true },
        cuit: { type: "STRING", nullable: true },
      },
      required: ["razon_social", "cuit"],
    },
    fecha: { type: "STRING", nullable: true },
    tipo_comprobante: { type: "STRING", nullable: true },
    numero_comprobante: { type: "STRING", nullable: true },
    moneda: { type: "STRING", nullable: true },
    total: { type: "NUMBER", nullable: true },
    confianza_general: { type: "NUMBER" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          descripcion: { type: "STRING" },
          codigo: { type: "STRING", nullable: true },
          codigo_barras: { type: "STRING", nullable: true },
          cantidad: { type: "NUMBER" },
          costo_unitario: { type: "NUMBER" },
          total_linea: { type: "NUMBER", nullable: true },
          confianza: { type: "NUMBER" },
        },
        required: ["descripcion", "codigo", "codigo_barras", "cantidad", "costo_unitario", "total_linea", "confianza"],
      },
    },
  },
  required: ["proveedor", "fecha", "tipo_comprobante", "numero_comprobante", "moneda", "total", "confianza_general", "items"],
};

function parseJsonText(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
}

function textoSeguro(value, max = 180) {
  if (value == null) return null;
  const texto = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");
  return texto ? texto.slice(0, max) : null;
}

function numeroSeguro(value, { min = 0, max = 1_000_000_000_000, nullable = false } = {}) {
  if (value == null || value === "") return nullable ? null : NaN;
  const numero = Number(value);
  if (!Number.isFinite(numero) || numero < min || numero > max) return nullable ? null : NaN;
  return numero;
}

function confianza(value) {
  const numero = Number(value);
  if (!Number.isFinite(numero)) return 0;
  return Math.max(0, Math.min(1, numero));
}

function textoNormalizado(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function productoDelBloque(producto, bloque, detectados) {
  const contenido = textoNormalizado([
    producto.nombre,
    producto.categoria,
    producto.marca,
  ].filter(Boolean).join(" "));
  const familia = textoNormalizado(bloque);
  const familias = [
    { patron: /bebid|gaseos|refresc|drink|cola/, terminos: ["bebida","gaseosa","agua","cerveza","jugo","energizante","soda","tonica","coca","cola","fanta","sprite","schweppes","monster","power","cepita","vino","sidra","lata"] },
    { patron: /librer|papeler|escolar/, terminos: ["cuaderno","lapiz","lapicera","papel","carpeta","goma","regla","marcador","resaltador","cartuchera","tinta","toner"] },
    { patron: /limpieza|higiene/, terminos: ["detergente","lavandina","jabon","limpiador","desinfectante","papel higienico","shampoo","acondicionador"] },
    { patron: /almacen|comestible|alimento/, terminos: ["fideo","arroz","harina","azucar","aceite","galletita","yerba","cafe","leche","conserva","salsa","snack"] },
  ];
  const familiaConocida = familias.find(item => item.patron.test(familia));
  if (familiaConocida) return familiaConocida.terminos.some(termino => contenido.includes(termino));
  const palabrasVisibles = (detectados || [])
    .flatMap(item => textoNormalizado(item.descripcion).split(/[^a-z0-9]+/))
    .filter(palabra => palabra.length >= 4 && !["pack","latas","unidad","unidades","botella","botellas","tamaño","sabor"].includes(palabra));
  if (palabrasVisibles.some(palabra => contenido.includes(palabra))) return true;
  if (!familiaConocida && producto.categoria && familia) {
    const palabrasFamilia = familia.split(/[^a-z0-9]+/).filter(palabra => palabra.length >= 4);
    return palabrasFamilia.some(palabra => contenido.includes(palabra));
  }
  return false;
}

function normalizarMoneda(value) {
  const moneda = textoSeguro(value, 12);
  if (!moneda) return null;
  const limpia = moneda.toUpperCase().replace(/\s+/g, "");
  if (["ARS", "$", "AR$", "PESO", "PESOS", "PESOSARGENTINOS"].includes(limpia)) return "ARS";
  if (["USD", "US$", "U$S", "DOLAR", "DOLARES", "DÓLAR", "DÓLARES"].includes(limpia)) return "USD";
  return limpia.slice(0, 12);
}

function cuitArgentinoValido(value) {
  const cuit = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((total, peso, index) => total + Number(cuit[index]) * peso, 0);
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return esperado === Number(cuit[10]);
}

function gtinValido(value) {
  const codigo = String(value ?? "").replace(/[\s-]+/g, "");
  if (!/^\d+$/.test(codigo) || !GTIN_LENGTHS.has(codigo.length)) return null;
  const cuerpo = codigo.slice(0, -1);
  const digito = Number(codigo.at(-1));
  let suma = 0;
  let peso = 3;
  for (let index = cuerpo.length - 1; index >= 0; index -= 1) {
    suma += Number(cuerpo[index]) * peso;
    peso = peso === 3 ? 1 : 3;
  }
  const esperado = (10 - (suma % 10)) % 10;
  return esperado === digito;
}

function normalizarCodigoBarras(value, advertencias, descripcion) {
  const codigo = textoSeguro(value, 80);
  if (!codigo) return null;
  const compacto = codigo.replace(/[\s-]+/g, "");
  const validacion = gtinValido(compacto);
  if (validacion === false) {
    advertencias.push(`Código de barras descartado por dígito verificador inválido en ${descripcion}.`);
    return null;
  }
  return compacto;
}

function normalizarDescripcion(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fechaIsoCalendarioValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const fecha = new Date(Date.UTC(year, month - 1, day));
  return fecha.getUTCFullYear() === year && fecha.getUTCMonth() === month - 1 && fecha.getUTCDate() === day;
}

function detectarCodigosConflictivos(items) {
  const porCodigo = new Map();
  for (const item of items) {
    const codigos = new Set([item.codigo_barras, item.codigo]
      .filter(Boolean)
      .map((codigo) => String(codigo).trim().toUpperCase())
      .filter(Boolean));
    for (const clave of codigos) {
      const nombres = porCodigo.get(clave) ?? new Set();
      nombres.add(normalizarDescripcion(item.descripcion));
      porCodigo.set(clave, nombres);
    }
  }
  return [...porCodigo.entries()]
    .filter(([, nombres]) => nombres.size > 1)
    .map(([codigo]) => codigo);
}

function errorRevision(codigo, detalle = null) {
  const error = new Error(codigo);
  if (detalle) error.detalle = detalle;
  return error;
}

function normalizarFacturaIA(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_INVOICE_OBJECT");

  const advertencias = [];
  const proveedorRaw = raw.proveedor && typeof raw.proveedor === "object" && !Array.isArray(raw.proveedor)
    ? raw.proveedor
    : {};
  const razonSocial = textoSeguro(proveedorRaw.razon_social, 180);
  const cuitLeido = String(proveedorRaw.cuit ?? "").replace(/\D/g, "");
  const cuit = cuitArgentinoValido(cuitLeido) ? cuitLeido : null;
  if (cuitLeido && !cuit) advertencias.push("El CUIT leído no supera la validación del dígito verificador; no se usará para crear o asociar proveedor.");
  if (!razonSocial && !cuit) {
    throw errorRevision("SUPPLIER_IDENTITY_MISSING");
  }

  const numeroComprobante = textoSeguro(raw.numero_comprobante, 80);
  if (!numeroComprobante) {
    throw errorRevision("DOCUMENT_NUMBER_MISSING");
  }

  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  if (itemsRaw.length > MAX_INVOICE_ITEMS) throw new Error("TOO_MANY_INVOICE_ITEMS");
  const items = [];

  for (const item of itemsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const descripcion = textoSeguro(item.descripcion, 240);
    const cantidad = numeroSeguro(item.cantidad, { min: 0.000001, max: 1_000_000 });
    const costoUnitario = numeroSeguro(item.costo_unitario, { min: 0, max: 1_000_000_000_000 });
    if (!descripcion || !Number.isFinite(cantidad) || !Number.isFinite(costoUnitario)) continue;

    const confianzaLinea = confianza(item.confianza);
    if (confianzaLinea < MIN_LINE_CONFIDENCE_AUTO) {
      throw errorRevision("LOW_LINE_CONFIDENCE", descripcion);
    }

    const totalLinea = numeroSeguro(item.total_linea, { min: 0, max: 1_000_000_000_000, nullable: true });
    if (totalLinea != null) {
      const calculado = cantidad * costoUnitario;
      const diferencia = Math.abs(totalLinea - calculado);
      const tolerancia = Math.max(2, calculado * 0.03);
      const toleranciaCritica = Math.max(10, calculado * 0.15);
      if (diferencia > toleranciaCritica) {
        advertencias.push(`CRÍTICO · Revisar ${descripcion}: cantidad × costo unitario no coincide con el total de línea leído. Corregí esta línea antes de confirmar.`);
      } else if (diferencia > tolerancia) {
        advertencias.push(`Revisar ${descripcion}: cantidad × costo unitario no coincide con el total de línea leído.`);
      }
    }

    items.push({
      descripcion,
      codigo: textoSeguro(item.codigo, 80),
      codigo_barras: normalizarCodigoBarras(item.codigo_barras, advertencias, descripcion),
      cantidad,
      costo_unitario: costoUnitario,
      total_linea: totalLinea,
      confianza: confianzaLinea,
    });
  }

  if (items.length === 0) throw new Error("NO_VALID_INVOICE_ITEMS");

  const codigosConflictivos = detectarCodigosConflictivos(items);
  if (codigosConflictivos.length > 0) {
    const error = new Error("AMBIGUOUS_INVOICE_CODES");
    error.codigos = codigosConflictivos;
    throw error;
  }

  const fechaTexto = textoSeguro(raw.fecha, 16);
  const fecha = fechaTexto && fechaIsoCalendarioValida(fechaTexto) ? fechaTexto : null;
  if (fechaTexto && !fecha) advertencias.push("La fecha leída no es una fecha calendario válida; revisala antes de confirmar la compra.");

  const confianzaGeneral = confianza(raw.confianza_general);
  if (confianzaGeneral < MIN_GENERAL_CONFIDENCE_AUTO) {
    throw errorRevision("LOW_INVOICE_CONFIDENCE");
  }
  if (confianzaGeneral < 0.55) advertencias.push("La confianza general de lectura es baja. Revisá cada línea antes de aplicar la factura.");

  const bajaConfianza = items.filter((item) => item.confianza < 0.5).length;
  if (bajaConfianza > 0) {
    advertencias.push(`${bajaConfianza} línea${bajaConfianza === 1 ? "" : "s"} tiene${bajaConfianza === 1 ? "" : "n"} confianza menor al 50%; revisá cantidad, costo y producto antes de ingresar stock.`);
  }

  const total = numeroSeguro(raw.total, { min: 0, max: 1_000_000_000_000, nullable: true });
  if (total != null) {
    const sumaLineas = items.reduce((suma, item) => {
      const totalLinea = item.total_linea;
      const calculado = item.cantidad * item.costo_unitario;
      return suma + (totalLinea != null && Number.isFinite(totalLinea) && totalLinea >= 0 ? totalLinea : calculado);
    }, 0);
    if (sumaLineas > 0) {
      const diferencia = Math.abs(total - sumaLineas);
      const tolerancia = Math.max(20, total * 0.05);
      if (diferencia > tolerancia) {
        advertencias.push("El total de la factura difiere de la suma de las líneas leídas. Revisá impuestos, descuentos y productos antes de confirmar.");
      }
    }
  }

  return {
    proveedor: {
      razon_social: razonSocial,
      cuit,
    },
    fecha,
    tipo_comprobante: textoSeguro(raw.tipo_comprobante, 60),
    numero_comprobante: numeroComprobante,
    moneda: normalizarMoneda(raw.moneda),
    total,
    confianza_general: confianzaGeneral,
    items,
    advertencias: [...new Set(advertencias)].slice(0, 30),
  };
}

async function validarUsuarioYPermiso(req, empresaId, permiso = "stock.read") {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const auth = String(req.headers.authorization || "");
  if (!supabaseUrl || !anonKey || !auth.startsWith("Bearer ")) return false;

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: auth },
  });
  if (!userResponse.ok) return false;

  const permisoResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/tiene_permiso_empresa`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: auth,
      "Content-Type": "application/json",
    },
      body: JSON.stringify({ p_empresa_id: empresaId, p_permiso: permiso }),
  });
  if (!permisoResponse.ok) return false;
  const permitido = await permisoResponse.json().catch(() => false);
  return permitido === true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" });

  if (req.body?.modo === "inventario") {
    const empresaId = String(req.body?.empresaId || "").trim();
    const imagenes = Array.isArray(req.body?.imagenes) ? req.body.imagenes.slice(0,10) : [];
    if (!empresaId || !imagenes.length || imagenes.some((x)=>typeof x!=="string" || !ALLOWED_IMAGE.test(x) || x.length>MAX_DATA_URL_LENGTH)) return json(res,400,{error:"INVALID_INVENTORY_INPUT",message:"Revisá las fotos del inventario."});
    if (imagenes.reduce((total,img)=>total+img.length,0)>4_000_000) return json(res,413,{error:"INVENTORY_IMAGES_TOO_LARGE",message:"Las fotos superan el límite de tamaño. Volvé a intentarlo con menos fotos."});
    try { if (!(await validarUsuarioYPermiso(req, empresaId, "stock.read"))) return json(res,403,{error:"FORBIDDEN"}); } catch { return json(res,403,{error:"FORBIDDEN"}); }
    const supabaseUrl=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, anonKey=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY, auth=String(req.headers.authorization||"");
    const imagenPrompt=`Auditor visual de SIGO. Hacé un BARRIDO VISUAL COMPLETO e independiente del catálogo: mirá toda la superficie de cada foto, dividila mentalmente en una cuadrícula de 3×3 y recorré cada fila de izquierda a derecha, desde arriba hacia abajo. Registrá cada tipo de producto/frente distinto que sea razonablemente identificable; no te limites a los más grandes o fáciles, no omitas productos visibles y no inventes etiquetas ocultas. Para cada producto transcribí marca, variedad y presentación sólo hasta donde se lean; si faltan datos o la foto no da seguridad, incluilo con menor confianza para REVISAR. Un producto con varias unidades iguales cuenta una sola vez; variantes o tamaños distintos son productos distintos. Primero definí el bloque dominante. x/y son porcentajes 0..100: elegí espacio libre cercano que no tape marca, logo, variedad, tamaño, código ni precio; si no hay espacio, preferí un borde libre. Respondé sólo JSON válido: {"bloque":string,"visuales":[{"descripcion":string,"marca":string|null,"variedad":string|null,"presentacion":string|null,"confianza":number,"foto":number,"x":number,"y":number}]}. Incluí todas las detecciones hasta un máximo de 200, ordenadas por foto, fila y columna.`;
    const apiKey=process.env.GEMINI_API_KEY;if(!apiKey)return json(res,503,{error:"AI_NOT_CONFIGURED",message:"La IA de SIGO no está configurada."});
    // Vercel runtime logs proved this model is the reliable path for inventory images.
    // Keep the purchases model isolated; only this modo=inventario branch changes.
    const model=process.env.GEMINI_INVENTORY_MODEL||process.env.GEMINI_INVOICE_FALLBACK_MODEL||"gemini-3.1-flash-lite-preview";
    const fallbackModel=process.env.GEMINI_INVENTORY_FALLBACK_MODEL||process.env.GEMINI_INVOICE_MODEL||"gemini-3.8-flash";
    const fetchInventoryGemini=async(stage,prompt,withImages)=>{
      const modelos=[...new Set([model,fallbackModel].filter(Boolean))];
      let ultimaRespuesta=null;
      for(let modeloIndex=0;modeloIndex<modelos.length;modeloIndex+=1){
        const modelo=modelos[modeloIndex];
        const maxReintentos=modeloIndex===modelos.length-1?2:0;
        for(let intento=0;intento<=maxReintentos;intento+=1){
          if(intento>0)await new Promise((resolve)=>setTimeout(resolve,intento===1?700:1400));
          const controller=new AbortController();
          const timeout=setTimeout(()=>controller.abort(),GEMINI_TIMEOUT_MS);
          const inicio=Date.now();
          try{
            const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,{
              method:"POST",signal:controller.signal,
              headers:{"x-goog-api-key":apiKey,"Content-Type":"application/json"},
              body:JSON.stringify({contents:[{role:"user",parts:[
                {text:prompt},
                ...(withImages?imagenes.map((img)=>({inlineData:{mimeType:img.match(/^data:([^;]+);/)?.[1]||"image/jpeg",data:img.split(",")[1]}})):[]),
              ]}],generationConfig:{temperature:0,responseMimeType:"application/json",maxOutputTokens:7000}}),
            });
            console.info("SIGO inventory Gemini",{stage,intento:intento+1,status:response.status,model:modelo,ms:Date.now()-inicio});
            if(response.ok)return {response,model:modelo};
            ultimaRespuesta={response,model:modelo};
            if(![429,503].includes(response.status))return ultimaRespuesta;
          }catch(error){
            console.warn("SIGO inventory Gemini connection",{stage,intento:intento+1,model:modelo,error:error?.name||"network"});
            if(error?.name==="AbortError")ultimaRespuesta={error:"timeout",model:modelo};
            else ultimaRespuesta={error:"network",model:modelo};
            break;
          }finally{clearTimeout(timeout);}
        }
      }
      return ultimaRespuesta;
    };
    const errorGemini=(result)=>{
      if(result?.error==="timeout")return json(res,504,{error:"AI_TIMEOUT",message:"El análisis de inventario tardó demasiado. Probá nuevamente con menos fotos o en unos segundos."});
      if(result?.error)return json(res,502,{error:"AI_UNAVAILABLE",message:"No se pudo conectar con la IA de SIGO. Volvé a intentar en unos segundos."});
      const status=result?.response?.status||502;
      if(status===503)return json(res,503,{error:"AI_TEMPORARILY_UNAVAILABLE",message:"Gemini sigue temporalmente con alta demanda en el modelo de inventario. Volvé a intentar en unos segundos."});
      if(status===429)return json(res,429,{error:"AI_RATE_LIMIT",message:"Gemini alcanzó temporalmente su límite de uso. Intentá nuevamente en unos minutos."});
      if(status===404)return json(res,502,{error:"AI_MODEL_UNAVAILABLE",message:"El modelo de IA de inventario no está disponible para este proyecto."});
      return json(res,502,{error:"AI_ERROR",message:`La IA no pudo analizar el inventario (HTTP ${status}).`});
    };
    const salidaTexto=async(result)=>parseJsonText(getGeminiOutputText(await result.response.json()));
    let faseVisual=await fetchInventoryGemini("barrido",imagenPrompt,true);
    if(!faseVisual?.response?.ok)return errorGemini(faseVisual);
    try {
      const raw=await salidaTexto(faseVisual);
      const visuales=(Array.isArray(raw.visuales)?raw.visuales:[]).slice(0,200).map((v,i)=>({
        visual_index:i,
        descripcion:textoSeguro([v.marca,v.variedad,v.presentacion].filter(Boolean).join(" ")||v.descripcion,180)||"Producto visible a revisar",
        confianza:confianza(v.confianza),
        foto:Math.max(1,Math.min(imagenes.length,Number(v.foto)||1)),
        x:Math.max(0,Math.min(100,Number(v.x)||50)),
        y:Math.max(0,Math.min(100,Number(v.y)||50)),
      }));
      const bloque=textoSeguro(raw.bloque,100)||"Bloque a revisar";
      if(visuales.length===0)return json(res,200,{bloque,hallazgos:[],resumen:{visuales:0}});
      // Fetch the tenant catalogue only after the complete visual sweep and family detection.
      let pr;
      try{pr=await fetch(`${supabaseUrl}/rest/v1/productos?empresa_id=eq.${encodeURIComponent(empresaId)}&select=id,nombre,codigo_interno,codigo_barras,categoria,marca,stock_actual&limit=5000`,{headers:{apikey:anonKey,Authorization:auth}});}catch{return json(res,502,{error:"PRODUCTS_UNAVAILABLE",message:"No pude consultar el stock de SIGO."});}
      if(!pr.ok)return json(res,502,{error:"PRODUCTS_UNAVAILABLE",message:"No pude consultar el stock de SIGO."});
      const productos=await pr.json().catch(()=>null);
      if(!Array.isArray(productos))return json(res,502,{error:"PRODUCTS_UNAVAILABLE",message:"No pude leer el catálogo de stock de SIGO."});
      const familia=productos.filter((p)=>productoDelBloque(p,bloque,visuales)).slice(0,500);
      const catalogo=familia.map((p)=>({id:p.id,nombre:p.nombre,codigo:p.codigo_barras||p.codigo_interno||null,categoria:p.categoria||null,marca:p.marca||null,stock:Number(p.stock_actual||0)}));
      const crucePrompt=`Cruce de inventario SIGO en dos etapas. La detección visual ya terminó y no se debe borrar ni fusionar ningún elemento de VISUALES. El bloque detectado es ${bloque}. Compará cada visual_index con el producto del catálogo más exacto posible, considerando marca, variedad y presentación. Sólo asigná catalogo_id si la correspondencia es segura; si no, null. No inventes productos. Si el producto está claramente identificado y no tiene correspondencia segura en el catálogo de este bloque, estado=falta_sigo con confianza>=0.8. Si hay duda de producto, variante o tamaño, estado=revisar. ids_catalogo_no_vistos sólo puede contener productos del catálogo de esta misma familia que razonablemente pertenecerían a la exhibición y no aparecen en VISUALES. JSON exacto: {"cruces":[{"visual_index":number,"catalogo_id":string|null,"estado":"ok"|"sin_stock"|"falta_sigo"|"revisar","confianza":number}],"ids_catalogo_no_vistos":[string]}. VISUALES: ${JSON.stringify(visuales)} CATÁLOGO FAMILIAR: ${JSON.stringify(catalogo)}`;
      const faseCruce=await fetchInventoryGemini("cruce",crucePrompt,false);
      if(!faseCruce?.response?.ok)return errorGemini(faseCruce);
      const cruce=await salidaTexto(faseCruce);
      const porId=new Map(productos.map((p)=>[String(p.id),p]));
      const cruces=new Map((Array.isArray(cruce.cruces)?cruce.cruces:[]).map(c=>[Number(c.visual_index),c]));
      const detectados=visuales.map((v,i)=>{
        const d=cruces.get(v.visual_index)||{};
        const producto=porId.get(String(d.catalogo_id||""));
        const confianzaProducto=confianza(d.confianza??v.confianza);
        const relacionado=producto&&productoDelBloque(producto,bloque,visuales);
        const matchSeguro=relacionado&&confianzaProducto>=0.78;
        const estado=matchSeguro
          ? Number(producto.stock_actual||0)>0?"ok":"sin_stock"
          : d.estado==="falta_sigo"&&confianzaProducto>=0.8&&v.confianza>=0.8?"falta_sigo"
          : "revisar";
        return {
          id:`v-${i}`,
          descripcion:matchSeguro?textoSeguro(producto.nombre,160):v.descripcion,
          codigo:matchSeguro?textoSeguro(producto.codigo_barras||producto.codigo_interno,80)||"":"",
          categoria:textoSeguro(matchSeguro?producto.categoria:null,100)||bloque,
          stock_actual:matchSeguro?Number(producto.stock_actual||0):null,
          estado,
          confianza:confianzaProducto,
          foto:v.foto,
          x:v.x,
          y:v.y,
        };
      });
      const visualesConCatalogo=new Set(detectados.filter(h=>h.stock_actual!=null).map(h=>h.descripcion));
      const noVistos=(Array.isArray(cruce.ids_catalogo_no_vistos)?cruce.ids_catalogo_no_vistos:[])
        .map((id)=>porId.get(String(id)))
        .filter((p)=>p&&familia.some(f=>String(f.id)===String(p.id))&&!visualesConCatalogo.has(p.nombre))
        .slice(0,100)
        .map((p,i)=>({id:`n-${i}`,descripcion:p.nombre,codigo:p.codigo_barras||p.codigo_interno||"",categoria:p.categoria||bloque,stock_actual:Number(p.stock_actual||0),estado:"no_visto",confianza:1,foto:0,x:0,y:0}));
      const hallazgos=[...detectados,...noVistos];
      const resumen={visuales:visuales.length,ok:detectados.filter(h=>h.estado==="ok").length,sin_stock:detectados.filter(h=>h.estado==="sin_stock").length,falta_sigo:detectados.filter(h=>h.estado==="falta_sigo").length,no_visto:noVistos.length,revisar:detectados.filter(h=>h.estado==="revisar").length};
      console.info("SIGO inventory completed",{bloque,imagenes:imagenes.length,payloadChars:imagenes.reduce((n,img)=>n+img.length,0),modelVision:faseVisual.model,modelCruce:faseCruce.model,...resumen});
      return json(res,200,{bloque,hallazgos,resumen});
    } catch(e){console.error("SIGO inventory parse error",e);return json(res,502,{error:"AI_INVALID_OUTPUT",message:"La IA respondió pero el análisis de inventario no fue válido."});}
  }

  const empresaId = String(req.body?.empresaId || "").trim();
  const documentDataUrl = String(req.body?.documentDataUrl || req.body?.imageDataUrl || "");
  const documentType = String(req.body?.documentType || (ALLOWED_PDF.test(documentDataUrl) ? "pdf" : "imagen"));
  const mensajeTexto = String(req.body?.mensajeTexto || "").trim();
  const filename = textoSeguro(req.body?.filename, 120) || (documentType === "pdf" ? "documento.pdf" : "documento.jpg");
  if (!empresaId) return json(res, 400, { error: "EMPRESA_REQUIRED" });
  const formatoValido = documentType === "texto" ? mensajeTexto.length >= 4 && mensajeTexto.length <= 15000 : documentType === "pdf" ? ALLOWED_PDF.test(documentDataUrl) : ALLOWED_IMAGE.test(documentDataUrl);
  if (!formatoValido || documentDataUrl.length > MAX_DATA_URL_LENGTH) {
    return json(res, 400, { error: "INVALID_DOCUMENT" });
  }

  try {
    if (!(await validarUsuarioYPermiso(req, empresaId, "purchases.write"))) return json(res, 403, { error: "FORBIDDEN" });
  } catch {
    return json(res, 403, { error: "FORBIDDEN" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(res, 503, { error: "AI_NOT_CONFIGURED" });

  const model = process.env.GEMINI_INVOICE_MODEL || "gemini-3.8-flash";
  const configuredFallbackModel = process.env.GEMINI_INVOICE_FALLBACK_MODEL || "gemini-3.5-flash-lite";
  // La versión preview fue retirada por Google; nunca enviar solicitudes a ese endpoint.
  const fallbackModel = configuredFallbackModel === "gemini-3.1-flash-lite-preview"
    ? "gemini-3.1-flash-lite"
    : configuredFallbackModel;
  const prompt = `Analizá este comprobante o mensaje comercial argentino para cargar mercadería en un sistema comercial. Puede ser factura, ticket, remito, nota de pedido, orden/pedido de compra, talonario X, comprobante X, mensaje de WhatsApp u otro registro de compra/recepción. Identificá el tipo real en tipo_comprobante.
No inventes datos. Si algo no es legible, usá null y baja confianza.
Extraé únicamente productos/servicios efectivamente facturados; no conviertas IVA, descuentos globales, percepciones, subtotales ni totales en productos.
Para cada ítem, cantidad y costo_unitario deben ser números. SIGO opera minorista y el stock se expresa en UNIDADES VENDIBLES, no en cajas/bultos.
Si la factura indica cajas, packs, bultos o displays y también informa cuántas unidades contiene cada uno, convertí la cantidad a unidades vendibles: cantidad_stock = cantidad_bultos × unidades_por_bulto. Ejemplo: 2 cajas x 6 botellas = cantidad 12, nunca 2.
El costo_unitario devuelto también debe corresponder a UNA unidad vendible. Si la factura expresa precio por caja/bulto, dividilo por unidades_por_bulto. El total de línea debe seguir conciliando contra cantidad × costo_unitario.
Si la factura ya detalla directamente unidades, respetá esa cantidad y no vuelvas a multiplicarla. No adivines unidades por caja: si el empaque no es legible o es ambiguo, bajá la confianza para obligar revisión.
costo_unitario es el precio de compra por unidad vendible antes de multiplicar por cantidad. Si sólo figura total de línea y cantidad en unidades vendibles, calculá costo unitario.
Si aparece un código de producto del proveedor, guardalo en codigo. Si aparece un EAN/UPC/código de barras, guardalo en codigo_barras.
fecha en formato YYYY-MM-DD cuando sea posible. CUIT sólo dígitos. moneda debe ser el código ISO cuando se identifique (por ejemplo ARS o USD).
Respondé SOLAMENTE JSON válido con esta forma exacta:
{"proveedor":{"razon_social":string|null,"cuit":string|null},"fecha":string|null,"tipo_comprobante":string|null,"numero_comprobante":string|null,"moneda":string|null,"total":number|null,"confianza_general":number,"items":[{"descripcion":string,"codigo":string|null,"codigo_barras":string|null,"cantidad":number,"costo_unitario":number,"total_linea":number|null,"confianza":number}]}
confianza_general y confianza van de 0 a 1.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let aiResponse;
  try {
    const fetchGemini = (modelo) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            ...(documentType === "texto" ? [{ text: `Mensaje comercial a registrar como compra:\n${mensajeTexto}` }] : [{
              inlineData: {
                mimeType: documentType === "pdf"
                  ? "application/pdf"
                  : (documentDataUrl.match(/^data:([^;]+);base64,/i)?.[1] || "image/jpeg"),
                data: documentDataUrl.split(",")[1],
              },
            }]),
          ],
        }],
        generationConfig: {
          maxOutputTokens: 6000,
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: FACTURA_RESPONSE_SCHEMA,
        },
      }),
    });
    const inicioGemini = Date.now();
    aiResponse = await fetchGemini(model);
    console.info("SIGO Gemini attempt", { intento: 1, status: aiResponse.status, model, ms: Date.now() - inicioGemini });
    // Evitar que tres reintentos del mismo modelo agoten el presupuesto de 45 s.
    // Ante saturación, priorizar el modelo alternativo y conservar un único reintento corto.
    if ((aiResponse.status === 503 || aiResponse.status === 429) && fallbackModel && fallbackModel !== model) {
      const inicioFallback = Date.now();
      aiResponse = await fetchGemini(fallbackModel);
      console.info("SIGO Gemini fallback", { status: aiResponse.status, model: fallbackModel, ms: Date.now() - inicioFallback });
    } else if (aiResponse.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const inicioReintento = Date.now();
      aiResponse = await fetchGemini(model);
      console.info("SIGO Gemini attempt", { intento: 2, status: aiResponse.status, model, ms: Date.now() - inicioReintento });
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return json(res, 504, { error: "AI_TIMEOUT", message: "La lectura de la factura tardó demasiado. Probá nuevamente con una foto más nítida." });
    }
    return json(res, 502, { error: "AI_UNAVAILABLE", message: "No se pudo conectar con el servicio de IA." });
  } finally {
    clearTimeout(timeout);
  }

  if (!aiResponse.ok) {
    const detail = await aiResponse.text().catch(() => "");
    console.error("SIGO invoice Gemini error", aiResponse.status, detail.slice(0, 1200));
    if (aiResponse.status === 404) return json(res, 502, { error: "AI_MODEL_UNAVAILABLE", message: "El modelo de IA configurado no está disponible para este proyecto." });
    if (aiResponse.status === 503) return json(res, 503, { error: "AI_TEMPORARILY_UNAVAILABLE", message: "Gemini está temporalmente con alta demanda. SIGO reintentó automáticamente; esperá unos segundos y volvé a intentar." });
    if (aiResponse.status === 429) return json(res, 429, { error: "AI_RATE_LIMIT", message: "Gemini alcanzó temporalmente su límite de uso. Intentá nuevamente en unos minutos." });
    return json(res, 502, { error: "AI_ERROR", message: "La IA no pudo procesar el comprobante." });
  }

  try {
    const aiData = await aiResponse.json();
    const text = getGeminiOutputText(aiData);
    if (!text) throw new Error("EMPTY_AI_OUTPUT");
    const leido = parseJsonText(text);
    const tipo = String(leido?.tipo_comprobante || "").toLowerCase();
    if (documentType === "texto" || (tipo && !tipo.includes("factura"))) {
      if (!leido.proveedor?.razon_social && !leido.proveedor?.cuit) leido.proveedor = { razon_social: "Proveedor sin identificar", cuit: null };
      if (!leido.numero_comprobante) leido.numero_comprobante = `COMPRA-${Date.now()}`;
      if (!leido.tipo_comprobante) leido.tipo_comprobante = documentType === "texto" ? "Mensaje de WhatsApp" : "Comprobante";
    }
    const factura = normalizarFacturaIA(leido);
    return json(res, 200, { factura, model: aiData?.modelVersion || model });
  } catch (error) {
    if (error?.message === "AMBIGUOUS_INVOICE_CODES") {
      return json(res, 422, {
        error: "AI_REVIEW_REQUIRED",
        message: "La factura contiene el mismo código asociado a productos distintos. Revisá la foto o cargá esas líneas manualmente antes de ingresar stock.",
      });
    }
    if (error?.message === "TOO_MANY_INVOICE_ITEMS") {
      return json(res, 422, {
        error: "AI_REVIEW_REQUIRED",
        message: `La factura contiene más de ${MAX_INVOICE_ITEMS} líneas. Dividí la carga o ingresala manualmente para evitar una compra parcial.`,
      });
    }
    if (error?.message === "SUPPLIER_IDENTITY_MISSING") {
      return json(res, 422, {
        error: "AI_REVIEW_REQUIRED",
        message: "No pude identificar con seguridad al proveedor. Seleccionalo o crealo manualmente antes de ingresar stock.",
      });
    }
    if (error?.message === "DOCUMENT_NUMBER_MISSING") {
      return json(res, 422, {
        error: "AI_REVIEW_REQUIRED",
        message: "No pude leer el número de comprobante. Cargalo manualmente para conservar el control contra facturas duplicadas.",
      });
    }
    if (error?.message === "LOW_INVOICE_CONFIDENCE") {
      return json(res, 422, {
        error: "AI_REVIEW_REQUIRED",
        message: "La confianza general de lectura es demasiado baja para preparar stock automáticamente. Revisá la factura y cargala manualmente.",
      });
    }
    if (error?.message === "LOW_LINE_CONFIDENCE") {
      return json(res, 422, {
        error: "AI_REVIEW_REQUIRED",
        message: `La línea ${error?.detalle ? `“${String(error.detalle).slice(0, 120)}” ` : ""}tiene confianza demasiado baja. Revisala manualmente antes de ingresar stock.`,
      });
    }
    if (error?.message === "INVOICE_LINE_TOTAL_MISMATCH") {
      return json(res, 422, {
        error: "AI_REVIEW_REQUIRED",
        message: `La línea ${error?.detalle ? `“${String(error.detalle).slice(0, 120)}” ` : ""}tiene una diferencia crítica entre cantidad × costo y total leído. Revisala manualmente antes de ingresar stock.`,
      });
    }
    console.error("SIGO invoice parse error", error);
    return json(res, 502, { error: "AI_INVALID_OUTPUT", message: "La IA respondió, pero no devolvió una factura segura y utilizable." });
  }
}
