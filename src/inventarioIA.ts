import { supabase } from "./supabase";
export type HallazgoInventario = { id:string; codigo:string; descripcion:string; categoria:string; stock_actual?:number|null; estado:"ok"|"sin_stock"|"falta_sigo"|"no_visto"|"revisar"; foto:number; x:number; y:number; confianza:number; catalogo_id?:string|null };
export type ResultadoInventario = { bloque:string; hallazgos:HallazgoInventario[] };
export type LoteInventario = { indice:number; resultado:ResultadoInventario };
type OpcionesInventario = { signal?:AbortSignal; completados?:LoteInventario[]; onLote?:(lote:LoteInventario)=>void; onProgreso?:(actual:number,total:number)=>void };

export function consolidarInventario(lotes:LoteInventario[]):ResultadoInventario {
  const ordenados = [...lotes].sort((a,b)=>a.indice-b.indice);
  const hallazgos = ordenados.flatMap(({indice,resultado})=>resultado.hallazgos.map((h,i)=>({...h,id:"foto-"+indice+"-"+i,foto:h.estado==="no_visto"?0:indice+1})));
  const vistos = new Set(hallazgos.filter(h=>h.estado!=="no_visto"&&h.catalogo_id).map(h=>h.catalogo_id));
  const faltantes = new Set<string>();
  return { bloque:[...new Set(ordenados.map(l=>l.resultado.bloque).filter(Boolean))].join(" · "), hallazgos:hallazgos.filter(h=>{
    if(h.estado!=="no_visto")return true;
    const key=h.catalogo_id||h.codigo||h.descripcion;
    if(vistos.has(h.catalogo_id)||faltantes.has(key))return false;
    faltantes.add(key);return true;
  }) };
}
function mensajeHTTP(status:number):string {
  if(status===401)return "La sesión venció. Volvé a ingresar a SIGO.";
  if(status===403)return "No tenés permiso para consultar el inventario de esta empresa.";
  if(status===413)return "La foto supera el límite de envío. Elegí una imagen más liviana.";
  if(status===429)return "La IA alcanzó su límite de solicitudes. Esperá antes de reintentar.";
  if(status===504)return "El proveedor de IA no respondió a tiempo. Reintentá; las fotos ya analizadas se conservan.";
  return "El análisis de IA no está disponible (HTTP "+status+"). Reintentá en unos minutos.";
}
function validarResultado(out:unknown):out is ResultadoInventario {
  const r=out as ResultadoInventario;
  return !!r&&typeof r.bloque==="string"&&Array.isArray(r.hallazgos)&&r.hallazgos.every(h=>!!h&&typeof h.descripcion==="string"&&["ok","sin_stock","falta_sigo","no_visto","revisar"].includes(h.estado));
}
export async function analizarInventarioSigo(empresaId:string,imagenes:string[],opciones:OpcionesInventario={}):Promise<ResultadoInventario> {
  if(!empresaId||imagenes.length<1||imagenes.length>10)throw new Error("Seleccioná entre 1 y 10 fotos para analizar.");
  if(opciones.signal?.aborted)throw new Error("Análisis cancelado. Las fotos ya analizadas se conservan.");
  const {data}=await supabase.auth.getSession();
  const token=data.session?.access_token;
  if(!token)throw new Error("La sesión venció. Volvé a ingresar a SIGO.");
  const lotes:LoteInventario[]=(opciones.completados||[]).filter(l=>l.indice>=0&&l.indice<imagenes.length&&validarResultado(l.resultado));
  for(let indice=0;indice<imagenes.length;indice++){
    if(opciones.signal?.aborted)throw new Error("Análisis cancelado. Las fotos ya analizadas se conservan.");
    if(lotes.some(l=>l.indice===indice))continue;
    opciones.onProgreso?.(indice+1,imagenes.length);
    const body=JSON.stringify({empresaId,imagenes:[imagenes[indice]]});
    if(new TextEncoder().encode(body).byteLength>4_000_000)throw new Error("La foto supera el límite seguro de envío. Elegí una imagen más liviana.");
    const controller=new AbortController();
    let agotado=false;
    const cancelar=()=>controller.abort();
    opciones.signal?.addEventListener("abort",cancelar,{once:true});
    const timer=setTimeout(()=>{agotado=true;controller.abort();},28_000);
    try {
      const response=await fetch("/api/inventario/analizar",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body,signal:controller.signal});
      const text=await response.text();
      let out:unknown;
      try{out=text?JSON.parse(text):null;}catch{if(response.ok)throw new Error("La IA devolvió una respuesta incompleta o inválida. Reintentá esta foto.");}
      if(!response.ok){
        const message=(out as {message?:unknown})?.message;
        throw new Error(typeof message==="string"&&message.length<600?message:mensajeHTTP(response.status));
      }
      if(!validarResultado(out))throw new Error("La IA devolvió una respuesta incompleta o inválida. Reintentá esta foto.");
      if(controller.signal.aborted)throw new DOMException("Aborted","AbortError");
      const lote={indice,resultado:out};
      lotes.push(lote);
      opciones.onLote?.(lote);
    }catch(error){
      if(opciones.signal?.aborted)throw new Error("Análisis cancelado. Las fotos ya analizadas se conservan.");
      if(agotado)throw new Error("El proveedor de IA no respondió a tiempo. Reintentá; las fotos ya analizadas se conservan.");
      if(error instanceof TypeError)throw new Error("No se pudo conectar con la IA de SIGO. Revisá la conexión y reintentá; las fotos ya analizadas se conservan.");
      throw error;
    }finally{clearTimeout(timer);opciones.signal?.removeEventListener("abort",cancelar);}
  }
  return consolidarInventario(lotes);
}

