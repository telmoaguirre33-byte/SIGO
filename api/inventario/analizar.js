const MAX_IMAGES=10, MAX_DATA_URL=8_000_000;
function json(res,status,body){res.status(status).setHeader("Content-Type","application/json; charset=utf-8").send(JSON.stringify(body));}
function textOut(data){return (data?.candidates||[]).flatMap(c=>c?.content?.parts||[]).map(p=>p?.text||"").join("\n").trim();}
async function autorizado(req,empresaId){
 const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, key=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY, auth=String(req.headers.authorization||"");
 if(!url||!key||!auth.startsWith("Bearer ")) return false;
 const u=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:auth}}); if(!u.ok)return false;
 const p=await fetch(`${url}/rest/v1/rpc/tiene_permiso_empresa`,{method:"POST",headers:{apikey:key,Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({p_empresa_id:empresaId,p_permiso:"products.read"})});
 if(!p.ok)return false; return (await p.json().catch(()=>false))===true;
}
export default async function handler(req,res){
 if(req.method!=="POST")return json(res,405,{error:"METHOD_NOT_ALLOWED"});
 const empresaId=String(req.body?.empresaId||""), imagenes=Array.isArray(req.body?.imagenes)?req.body.imagenes.slice(0,MAX_IMAGES):[];
 if(!empresaId||!imagenes.length||imagenes.some(x=>typeof x!=="string"||!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(x)||x.length>MAX_DATA_URL))return json(res,400,{error:"INVALID_INPUT"});
 if(!(await autorizado(req,empresaId).catch(()=>false)))return json(res,403,{error:"FORBIDDEN"});
 const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY,auth=String(req.headers.authorization||"");
 let productos, catalogoCompleto;
 try { ({ productos, completo: catalogoCompleto } = await leerCatalogoInventario(url,key,auth,empresaId)); }
 catch { return json(res,502,{error:"PRODUCTS_UNAVAILABLE"}); }
 const catalogo=productos.map(p=>({id:p.id,nombre:p.nombre,codigo:p.codigo_barras||p.codigo_interno||null,categoria:p.categoria||null,marca:p.marca||null,stock:p.stock_actual}));
 const prompt=`Sos el auditor visual de inventario de SIGO. Analizá las fotos de UNA zona de un comercio. Primero determiná el bloque/familia dominante (ej bebidas gaseosas, fideos, librería). No compares contra categorías ajenas. Identificá productos visibles sin inventar marca, variante o tamaño. Para cada producto visible buscá correspondencia en el catálogo SIGO adjunto por EAN si es legible; si no, por marca+nombre+variante+tamaño. estado debe ser "ok" si existe en SIGO y stock_actual es mayor a 0, "sin_stock" si existe en SIGO pero stock_actual es 0 o menor, "falta_sigo" si es visible con confianza alta y no existe en catálogo, o "revisar" si no hay certeza. También devolvé ids_catalogo_no_vistos sólo para productos del MISMO bloque que razonablemente deberían estar en esta exhibición y no aparecen; no devuelvas todo el padrón. x e y son porcentajes 0..100 de un punto seguro cercano al producto, evitando tapar logo, marca, tamaño, código o precio. Respondé sólo JSON: {"bloque":string,"detectados":[{"descripcion":string,"codigo":string|null,"catalogo_id":string|null,"estado":"ok"|"sin_stock"|"falta_sigo"|"revisar","confianza":number,"foto":number,"x":number,"y":number}],"ids_catalogo_no_vistos":[string]}. CATÁLOGO ${catalogoCompleto ? "COMPLETO" : "PARCIAL: no declarar faltantes, usar revisar para productos no vinculados"} SIGO: ${JSON.stringify(catalogo)}`;
 const apiKey=process.env.GEMINI_API_KEY;if(!apiKey)return json(res,503,{error:"AI_NOT_CONFIGURED"});
 const model=process.env.GEMINI_INVENTORY_MODEL||process.env.GEMINI_INVOICE_MODEL||"gemini-3.8-flash";
 const parts=[{text:prompt},...imagenes.map(img=>({inlineData:{mimeType:img.match(/^data:([^;]+);/)?.[1]||"image/jpeg",data:img.split(",")[1]}}))];
 const ai=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{"x-goog-api-key":apiKey,"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts}],generationConfig:{temperature:0,responseMimeType:"application/json",maxOutputTokens:7000}})});
 if(!ai.ok)return json(res,502,{error:"AI_ERROR",status:ai.status}); const raw=JSON.parse(textOut(await ai.json()).replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));
 return json(res,200,{bloque:String(raw.bloque||"Bloque a revisar").slice(0,100),catalogoCompleto,hallazgos:construirHallazgosInventario(raw,productos,catalogoCompleto,imagenes.length)});
}


export async function leerCatalogoInventario(url,key,auth,empresaId) {
 const productos=[];
 for(let pagina=0;pagina<10 && productos.length<5000;pagina++) {
  const limite=Math.min(1000,5000-productos.length);
  const response=await fetch(`${url}/rest/v1/productos?empresa_id=eq.${encodeURIComponent(empresaId)}&select=id,nombre,codigo_interno,codigo_barras,categoria,marca,stock_actual&order=id.asc&offset=${productos.length}&limit=${limite}`,{headers:{apikey:key,Authorization:auth,Prefer:"count=exact"}});
  if(!response.ok)throw Error("PRODUCTS_UNAVAILABLE");
  const lote=await response.json();if(!Array.isArray(lote))throw Error("PRODUCTS_INVALID");
  productos.push(...lote);
  const totalTexto=response.headers.get("content-range")?.split("/")[1];
  const total=totalTexto && /^\d+$/.test(totalTexto)?Number(totalTexto):null;
  if(total!==null && productos.length>=total)return {productos,completo:true};
  if(!lote.length)return {productos,completo:true};
 }
 // El límite de contexto no demuestra ausencia en el catálogo completo.
 return {productos,completo:false};
}

export function construirHallazgosInventario(raw,productos,completo,cantidadImagenes) {
 const porId=new Map(productos.map(p=>[p.id,p]));
 const codigo=(p)=>p.codigo_barras||p.codigo_interno||"";
 const detectados=(raw.detectados||[]).slice(0,200).map((d,i)=>{
  const porCodigo=d.codigo?productos.filter(p=>[p.codigo_barras,p.codigo_interno].includes(String(d.codigo))):[];
  const p=porId.get(d.catalogo_id)||(porCodigo.length===1?porCodigo[0]:null);
  const confianza=Math.max(0,Math.min(1,Number(d.confianza)||0));
  let estado="revisar";
  if(p && p.stock_actual!==null && p.stock_actual!==undefined && Number.isFinite(Number(p.stock_actual)))estado=Number(p.stock_actual)>0?"ok":"sin_stock";
  else if(!p && completo && !d.catalogo_id && d.estado==="falta_sigo" && confianza>=0.85)estado="falta_sigo";
  return {id:`v-${i}`,descripcion:String(p?.nombre||d.descripcion||"Producto a revisar").slice(0,160),codigo:p?codigo(p):String(d.codigo||"").slice(0,80),categoria:String(raw.bloque||"").slice(0,100),estado,stock_actual:p?.stock_actual??null,confianza,foto:Math.max(1,Math.min(cantidadImagenes,Number(d.foto)||1)),x:Math.max(0,Math.min(100,Number(d.x)||50)),y:Math.max(0,Math.min(100,Number(d.y)||50)),catalogo_id:p?.id||null};
 });
 const noVistos=(raw.ids_catalogo_no_vistos||[]).map(id=>porId.get(id)).filter(Boolean).slice(0,100).map((p,i)=>({id:`n-${i}`,descripcion:p.nombre,codigo:codigo(p),categoria:p.categoria||String(raw.bloque||""),estado:"no_visto",stock_actual:p.stock_actual,confianza:1,foto:0,x:0,y:0,catalogo_id:p.id}));
 return [...detectados,...noVistos];
}
