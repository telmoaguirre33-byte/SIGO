import { useEffect, useMemo, useState } from "react";

type FotoInventario = { id: string; nombre: string; url: string; vence: number };
type Estado = "ok" | "falta_sigo" | "no_visto" | "revisar";
type Hallazgo = { id:string; codigo:string; descripcion:string; categoria:string; color:string; estado:Estado; foto?:number; x?:number; y?:number; confianza?:number };

const PALETA=["#2563eb","#dc2626","#16a34a","#9333ea","#ea580c","#0891b2","#db2777","#65a30d","#4f46e5","#b45309","#0f766e","#be123c","#7c3aed","#0369a1","#15803d","#c2410c","#a21caf","#1d4ed8","#4d7c0f","#9f1239"];
const PERIODO=()=>new Date().toISOString().slice(0,7);
const CLAVE=(empresaId:string)=>`sigo-stock-inventario-${empresaId}-${PERIODO()}`;

export default function StockVsInventario({empresaId}:{empresaId:string}) {
  const [fotos,setFotos]=useState<FotoInventario[]>([]);
  const [hallazgos,setHallazgos]=useState<Hallazgo[]>([]);
  const [mensaje,setMensaje]=useState("");
  const [analizando,setAnalizando]=useState(false);
  const [bloque,setBloque]=useState("");
  const mes=new Intl.DateTimeFormat("es-AR",{month:"long",year:"numeric"}).format(new Date());
  const [historicos,setHistoricos]=useState<string[]>([]);

  useEffect(()=>{
    try {
      const guardado=JSON.parse(localStorage.getItem(CLAVE(empresaId))||"{}");
      const ahora=Date.now();
      setFotos((guardado.fotos||[]).filter((f:FotoInventario)=>f.vence>ahora));
      setHallazgos(guardado.hallazgos||[]);
      const prefijo=`sigo-stock-inventario-${empresaId}-`;
      setHistoricos(Object.keys(localStorage).filter(k=>k.startsWith(prefijo)&&k!==CLAVE(empresaId)).map(k=>k.slice(prefijo.length)).sort().reverse());
    } catch { /* almacenamiento local opcional */ }
  },[empresaId]);

  useEffect(()=>{
    try { localStorage.setItem(CLAVE(empresaId),JSON.stringify({fotos,hallazgos,mes})); } catch { /* sin bloquear operación */ }
  },[empresaId,fotos,hallazgos,mes]);

  const resumen=useMemo(()=>({
    ok:hallazgos.filter(h=>h.estado==="ok").length,
    falta:hallazgos.filter(h=>h.estado==="falta_sigo").length,
    noVisto:hallazgos.filter(h=>h.estado==="no_visto").length,
    revisar:hallazgos.filter(h=>h.estado==="revisar").length,
  }),[hallazgos]);

  function cargarFotos(files:FileList|null){
    if(!files) return;
    const disponibles=Math.max(0,10-fotos.length);
    const seleccion=Array.from(files).slice(0,disponibles);
    if(Array.from(files).length>disponibles) setMensaje("Este análisis admite hasta 10 fotos. Para más capacidad se requiere otro plan.");
    const nuevas=seleccion.map((file,i)=>({id:`${Date.now()}-${i}`,nombre:file.name,url:URL.createObjectURL(file),vence:Date.now()+24*60*60*1000}));
    setFotos(actual=>[...actual,...nuevas]);
  }

  async function analizar(){
    if(!fotos.length||analizando)return; setAnalizando(true); setMensaje("Analizando productos y comparando con el stock de SIGO…");
    try { const imagenes=await Promise.all(fotos.map(f=>fetch(f.url).then(r=>r.blob()).then(blob=>new Promise<string>((ok,no)=>{const rd=new FileReader();rd.onload=()=>ok(String(rd.result));rd.onerror=()=>no(rd.error);rd.readAsDataURL(blob)}))));
      const { supabase }=await import("./supabase"); const {data}=await supabase.auth.getSession(); const token=data.session?.access_token;
      const res=await fetch("/api/inventario/analizar",{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({empresaId,imagenes})}); const texto=await res.text(); let out:any={}; try{out=texto?JSON.parse(texto):{}}catch{out={message:texto}} if(!res.ok)throw new Error(out?.message||`No se pudo analizar (HTTP ${res.status}).`);
      setBloque(out.bloque||""); setHallazgos((out.hallazgos||[]).map((h:Hallazgo,i:number)=>({...h,color:PALETA[i%PALETA.length]}))); setMensaje(`Bloque detectado: ${out.bloque||"a revisar"}. Comparación terminada.`);
    } catch(e){const m=e instanceof Error?e.message:"No se pudo analizar el inventario."; setMensaje(m==="Failed to fetch"?"No se pudo conectar con el analizador de inventario. Actualizá SIGO y volvé a intentar; si continúa, el servicio de análisis no está publicado.":m);} finally{setAnalizando(false)}
  }

  function exportar(){
    const filas=[["Código","Descripción","Categoría","Estado"],...hallazgos.map(h=>[h.codigo,h.descripcion,h.categoria,h.estado])];
    const csv=filas.map(f=>f.map(v=>`"${String(v).replaceAll('"','""')}"`).join(";")).join("\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`SIGO-stock-inventario-${new Date().toISOString().slice(0,7)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return <div className="products-page">
    <div className="page-header"><div><h2>Stock vs Inventario</h2><p>Comparación visual por bloque. Reporte mensual · fotos disponibles durante 24 horas.</p></div><button className="admin-button" onClick={exportar} disabled={!hallazgos.length}>▣ Exportar Excel</button></div>
    <div className="stats-grid sigo-inventory-stats">
      <div className="stat-card"><span>Coinciden</span><strong>{resumen.ok}</strong></div>
      <div className="stat-card"><span>Falta en SIGO</span><strong>{resumen.falta}</strong></div>
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
    <div className="panel">
      <div className="page-header"><div><h3>Reporte mensual · {mes}</h3>{bloque&&<strong>Bloque analizado: {bloque}</strong>}<p>Se alimenta con las revisiones del mes. Al cambiar de mes empieza un reporte nuevo y el anterior queda como histórico.</p>{historicos.length>0&&<small>Históricos guardados: {historicos.join(" · ")}</small>}</div></div>
      <div className="table-wrapper"><table className="products-table"><thead><tr><th>Marca</th><th>Código</th><th>Descripción</th><th>Bloque</th><th>Estado</th></tr></thead><tbody>
        {hallazgos.map((h,i)=><tr key={h.id}><td><span aria-label={`Marcador ${i+1}`} style={{display:"inline-block",width:12,height:12,borderRadius:"50%",background:h.color||PALETA[i%PALETA.length],marginRight:7}}/>{String(i+1).padStart(2,"0")}</td><td>{h.codigo||"-"}</td><td><strong>{h.descripcion}</strong></td><td>{h.categoria}</td><td>{h.estado==="falta_sigo"?"F — NO ESTÁ EN SIGO":h.estado==="no_visto"?"NO VISTO EN INVENTARIO":h.estado==="ok"?"ESTÁ EN SIGO":"REVISAR"}</td></tr>)}
      </tbody></table>{!hallazgos.length&&<div className="table-empty">Todavía no hay revisiones cargadas este mes.</div>}</div>
    </div>
  </div>;
}
