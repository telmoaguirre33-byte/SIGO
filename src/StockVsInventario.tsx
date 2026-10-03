import { useEffect, useMemo, useState } from "react";
import { analizarInventarioSigo } from "./inventarioIA";

type FotoInventario = { id: string; nombre: string; url: string; vence: number; blob: Blob };
type Estado = "ok" | "sin_stock" | "falta_sigo" | "no_visto" | "revisar";
type Hallazgo = { id:string; codigo:string; descripcion:string; categoria:string; color:string; stock_actual?:number|null; estado:Estado; foto?:number; x?:number; y?:number; confianza?:number };

const PALETA=["#2563eb","#dc2626","#16a34a","#9333ea","#ea580c","#0891b2","#db2777","#65a30d","#4f46e5","#b45309","#0f766e","#be123c","#7c3aed","#0369a1","#15803d","#c2410c","#a21caf","#1d4ed8","#4d7c0f","#9f1239"];
const PERIODO=()=>new Date().toISOString().slice(0,7);
const CLAVE=(empresaId:string)=>`sigo-stock-inventario-${empresaId}-${PERIODO()}`;
const DB_FOTOS="sigo-inventario-fotos-v1";
const STORE_FOTOS="fotos";

function abrirDBFotos():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)){reject(new Error("Este navegador no permite guardar fotos temporalmente."));return;}
    const request=indexedDB.open(DB_FOTOS,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE_FOTOS))request.result.createObjectStore(STORE_FOTOS,{keyPath:"key"});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("No se pudo abrir el almacenamiento de fotos."));
  });
}

async function convertirParaAnalisis(blob:Blob):Promise<string>{
  const bitmap=await createImageBitmap(blob);
  try{
    const canvas=document.createElement("canvas");
    const ctx=canvas.getContext("2d");
    if(!ctx)throw new Error("No se pudo preparar la foto para el análisis.");
    let escala=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    let resultado:Blob|null=null;
    for(let intento=0;intento<12;intento++){
      canvas.width=Math.max(1,Math.round(bitmap.width*escala));
      canvas.height=Math.max(1,Math.round(bitmap.height*escala));
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for(const calidad of [0.82,0.72,0.62,0.52]){
        resultado=await new Promise<Blob|null>(ok=>canvas.toBlob(ok,"image/jpeg",calidad));
        if(resultado&&resultado.size<=280_000)break;
      }
      if(resultado&&resultado.size<=280_000)break;
      escala*=0.82;
    }
    if(!resultado)throw new Error("No se pudo preparar una de las fotos.");
    if(resultado.size>280_000)throw new Error("Una foto supera el tamaño seguro para el análisis. Probá con menos fotos o una imagen más liviana.");
    return await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result));
      reader.onerror=()=>reject(reader.error||new Error("No se pudo leer una de las fotos."));
      reader.readAsDataURL(resultado!);
    });
  }finally{bitmap.close();}
}

export default function StockVsInventario({empresaId}:{empresaId:string}) {
  const [fotos,setFotos]=useState<FotoInventario[]>([]);
  const [hallazgos,setHallazgos]=useState<Hallazgo[]>([]);
  const [mensaje,setMensaje]=useState("");
  const [analizando,setAnalizando]=useState(false);
  const [bloque,setBloque]=useState("");
  const mes=new Intl.DateTimeFormat("es-AR",{month:"long",year:"numeric"}).format(new Date());
  const [historicos,setHistoricos]=useState<string[]>([]);

  useEffect(()=>{
    let cancelado=false;
    try {
      const guardado=JSON.parse(localStorage.getItem(CLAVE(empresaId))||"{}");
      setHallazgos(guardado.hallazgos||[]);
      const prefijo=`sigo-stock-inventario-${empresaId}-`;
      setHistoricos(Object.keys(localStorage).filter(k=>k.startsWith(prefijo)&&k!==CLAVE(empresaId)).map(k=>k.slice(prefijo.length)).sort().reverse());
      void (async()=>{
        try{
          const db=await abrirDBFotos();
          const tx=db.transaction(STORE_FOTOS,"readwrite");
          const store=tx.objectStore(STORE_FOTOS);
          const request=store.getAll();
          request.onsuccess=()=>{
            if(cancelado){db.close();return;}
            const ahora=Date.now();
            const propias=(request.result||[]).filter((f:any)=>f.empresaId===empresaId);
            const vigentes=propias.filter((f:any)=>f.vence>ahora);
            propias.filter((f:any)=>f.vence<=ahora).forEach((f:any)=>store.delete(f.key));
            setFotos(vigentes.map((f:any)=>({id:f.id,nombre:f.nombre,vence:f.vence,blob:f.blob,url:URL.createObjectURL(f.blob)})));
            if(!vigentes.length&&(guardado.fotos||[]).length)setMensaje("Las fotos anteriores ya no están disponibles en este navegador. Volvé a cargarlas para analizarlas.");
            db.close();
          };
          request.onerror=()=>db.close();
        }catch{
          if(!cancelado&&(guardado.fotos||[]).length)setMensaje("Las fotos anteriores ya no se pueden recuperar. Volvé a cargarlas para analizarlas.");
        }
      })();
    } catch { /* almacenamiento local opcional */ }
    return()=>{cancelado=true;};
  },[empresaId]);

  useEffect(()=>{
    try { localStorage.setItem(CLAVE(empresaId),JSON.stringify({hallazgos,mes})); } catch { /* sin bloquear operación */ }
  },[empresaId,hallazgos,mes]);

  const resumen=useMemo(()=>({
    total:hallazgos.length,
    ok:hallazgos.filter(h=>h.estado==="ok").length,
    falta:hallazgos.filter(h=>h.estado==="falta_sigo").length,
    sinStock:hallazgos.filter(h=>h.estado==="sin_stock").length,
    noVisto:hallazgos.filter(h=>h.estado==="no_visto").length,
    revisar:hallazgos.filter(h=>h.estado==="revisar").length,
  }),[hallazgos]);

  async function cargarFotos(files:FileList|null){
    if(!files) return;
    const disponibles=Math.max(0,10-fotos.length);
    const seleccion=Array.from(files).slice(0,disponibles);
    if(Array.from(files).length>disponibles) setMensaje("Este análisis admite hasta 10 fotos. Para más capacidad se requiere otro plan.");
    const nuevas=seleccion.map((file,i)=>({id:`${Date.now()}-${i}`,nombre:file.name,url:URL.createObjectURL(file),vence:Date.now()+24*60*60*1000,blob:file}));
    setFotos(actual=>[...actual,...nuevas]);
    try{
      const db=await abrirDBFotos();
      const tx=db.transaction(STORE_FOTOS,"readwrite");
      const store=tx.objectStore(STORE_FOTOS);
      nuevas.forEach(f=>store.put({key:`${empresaId}:${f.id}`,empresaId,id:f.id,nombre:f.nombre,vence:f.vence,blob:f.blob}));
      tx.oncomplete=()=>db.close();
      tx.onerror=()=>{db.close();setMensaje("Las fotos se pueden analizar ahora, pero no quedaron guardadas para reabrirlas durante las próximas 24 horas.");};
    }catch{
      setMensaje("Las fotos se pueden analizar ahora, pero este navegador no permite conservarlas después de cerrar SIGO.");
    }
  }

  async function analizar(){
    if(!fotos.length||analizando)return; setAnalizando(true); setMensaje("Analizando productos y comparando con el stock de SIGO…");
    try {
      if(fotos.some(f=>!f.blob))throw new Error("Una foto dejó de estar disponible. Volvé a cargarla para continuar.");
      const imagenes=await Promise.all(fotos.map(f=>convertirParaAnalisis(f.blob)));
      if(imagenes.reduce((suma,img)=>suma+img.length,0)>4_000_000)throw new Error("El conjunto de fotos supera el límite seguro. Probá con menos fotos.");
      const out=await analizarInventarioSigo(empresaId,imagenes);
      setBloque(out.bloque||""); setHallazgos((out.hallazgos||[]).map((h,i)=>({...h,color:PALETA[i%PALETA.length]}))); setMensaje(`Bloque detectado: ${out.bloque||"a revisar"}. Comparación terminada.`);
    } catch(e){const m=e instanceof Error?e.message:"No se pudo analizar el inventario."; setMensaje(m==="Failed to fetch"?"No se pudo conectar con la IA de SIGO. Revisá la conexión y volvé a intentar.":m);} finally{setAnalizando(false)}
  }

  function exportar(){
    const filas=[["Código","Descripción","Categoría","Estado"],...hallazgos.map(h=>[h.codigo,h.descripcion,h.categoria,h.estado])];
    const csv=filas.map(f=>f.map(v=>`"${String(v).replaceAll('"','""')}"`).join(";")).join("\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`SIGO-stock-inventario-${new Date().toISOString().slice(0,7)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return <div className="products-page">
    <div className="page-header"><div><p>Comparación visual por bloque. Reporte mensual · fotos disponibles durante 24 horas.</p></div><button className="admin-button" onClick={exportar} disabled={!hallazgos.length}>▣ Exportar Excel</button></div>
    <div className="stats-grid sigo-inventory-stats">
      <div className="stat-card"><span>Coinciden</span><strong>{resumen.ok}</strong></div>
      <div className="stat-card"><span>No está en SIGO</span><strong>{resumen.falta}</strong></div>
      <div className="stat-card"><span>Sin stock</span><strong>{resumen.sinStock}</strong></div>
      <div className="stat-card"><span>No visto</span><strong>{resumen.noVisto}</strong></div>
      <div className="stat-card"><span>Revisar</span><strong>{resumen.revisar}</strong></div>
    </div>
    <div className="panel">
      <div className="page-header"><div><h3>Nueva revisión</h3><p>Sacá una foto o subí hasta 10 fotos del mismo bloque o familia. SIGO compara sólo contra productos relacionados.</p></div><div className="topbar-actions"><label className="primary-button" style={{cursor:"pointer",fontSize:17}}>📷 Sacar foto<input hidden type="file" accept="image/*" capture="environment" onChange={e=>cargarFotos(e.target.files)}/></label><label className="admin-button" style={{cursor:"pointer"}}>＋ Agregar fotos<input hidden type="file" accept="image/*" multiple onChange={e=>cargarFotos(e.target.files)}/></label></div></div>
      {mensaje&&<p role="alert">{mensaje}</p>}
      {fotos.length>0&&<div className="sigo-inventory-photos">
        {fotos.map((f,i)=><div key={f.id} className="sigo-inventory-photo"><img src={f.url} alt={f.nombre}/>{hallazgos.filter(h=>h.foto===i+1).map((h,j)=><span key={h.id} title={h.descripcion} style={{position:"absolute",left:`${h.x??50}%`,top:`${h.y??50}%`,width:16,height:16,borderRadius:"50%",background:h.color,border:"2px solid white",boxShadow:"0 1px 4px #0008",transform:"translate(-50%,-50%)",zIndex:2}}><small style={{position:"absolute",left:17,top:-3,background:"#fff",borderRadius:8,padding:"1px 4px",fontSize:9,fontWeight:800}}>{String(hallazgos.indexOf(h)+1).padStart(2,"0")}</small></span>)}<span style={{position:"absolute",left:8,bottom:8,background:"#fff",padding:"3px 7px",borderRadius:10,fontSize:12,fontWeight:800}}>Foto {i+1}</span></div>)}
      </div>}
      <p style={{marginTop:14}}><strong>Marcadores:</strong> cada producto detectado tendrá color + número. El punto se ubicará en un espacio libre o fuera del envase con una línea fina; nunca sobre logo, marca, variedad, tamaño, código o precio.</p>
      <button className="primary-button" disabled={!fotos.length||analizando} onClick={()=>void analizar()}>{analizando?"Analizando…":"✨ Analizar fotos"}</button>
    </div>
    <div className="panel sigo-inventory-manager">
      <div className="page-header"><div><h3>Informe gerencial</h3><p>Resumen acumulado del período para detectar diferencias entre la exhibición y SIGO.</p></div></div>
      <div className="sigo-inventory-manager-kpis">
        <div><span>Analizados</span><strong>{resumen.total}</strong></div>
        <div><span>En SIGO</span><strong>{resumen.ok}</strong></div>
        <div><span>Sin stock</span><strong>{resumen.sinStock}</strong></div>
        <div><span>No están en SIGO</span><strong>{resumen.falta}</strong></div>
        <div><span>No vistos</span><strong>{resumen.noVisto}</strong></div>
        <div><span>Revisar</span><strong>{resumen.revisar}</strong></div>
      </div>
      <div className="sigo-inventory-manager-chart" aria-label="Gráfico gerencial Stock vs Inventario">
        {[
          ["En SIGO",resumen.ok],["Sin stock",resumen.sinStock],["No están",resumen.falta],["No vistos",resumen.noVisto],["Revisar",resumen.revisar]
        ].map(([nombre,valor])=><div className="sigo-inventory-manager-bar" key={String(nombre)} title={`${nombre}: ${valor}`}>
          <div><span style={{height:`${Math.max(Number(valor)>0?8:2,(Number(valor)/Math.max(1,resumen.total))*100)}%`}} /></div>
          <strong>{valor}</strong><small>{nombre}</small>
        </div>)}
      </div>
    </div>
    <div className="panel">
      <div className="page-header"><div><h3>Reporte mensual · {mes}</h3>{bloque&&<strong>Bloque analizado: {bloque}</strong>}<p>Se alimenta con las revisiones del mes. Al cambiar de mes empieza un reporte nuevo y el anterior queda como histórico.</p>{historicos.length>0&&<small>Históricos guardados: {historicos.join(" · ")}</small>}</div></div>
      <div className="table-wrapper"><table className="products-table"><thead><tr><th>Marca</th><th>Código</th><th>Descripción</th><th>Bloque</th><th>Stock SIGO</th><th>Estado</th></tr></thead><tbody>
        {hallazgos.map((h,i)=><tr key={h.id}><td><span aria-label={`Marcador ${i+1}`} style={{display:"inline-block",width:12,height:12,borderRadius:"50%",background:h.color||PALETA[i%PALETA.length],marginRight:7}}/>{String(i+1).padStart(2,"0")}</td><td>{h.codigo||"-"}</td><td><strong>{h.descripcion}</strong></td><td>{h.categoria}</td><td>{h.stock_actual==null?"-":h.stock_actual}</td><td>{h.estado==="falta_sigo"?"F — NO ESTÁ EN SIGO":h.estado==="sin_stock"?"SIN STOCK EN SIGO":h.estado==="no_visto"?"NO VISTO EN INVENTARIO":h.estado==="ok"?"ESTÁ EN SIGO":"REVISAR"}</td></tr>)}
      </tbody></table>{!hallazgos.length&&<div className="table-empty">Todavía no hay revisiones cargadas este mes.</div>}</div>
    </div>
  </div>;
}
