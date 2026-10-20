import { useEffect, useMemo, useRef, useState } from "react";
import { analizarInventarioSigo, type LoteInventario } from "./inventarioIA";
import { prepararImagenIA } from "./iaImagenes";

type FotoInventario = { id: string; nombre: string; url: string; vence: number; blob: Blob };
type Estado = "ok" | "sin_stock" | "falta_sigo" | "no_visto" | "revisar";
type Hallazgo = { id:string; codigo:string; descripcion:string; categoria:string; color:string; stock_actual?:number|null; estado:Estado; foto?:number; x?:number; y?:number; confianza?:number };
type Revision = { id:string; fecha:number; bloque:string; hallazgos:Hallazgo[] };
type LoteGuardado = LoteInventario & { fotoId:string; vence:number };

const PALETA=["#2563eb","#dc2626","#16a34a","#9333ea","#ea580c","#0891b2","#db2777","#65a30d","#4f46e5","#b45309","#0f766e","#be123c","#7c3aed","#0369a1","#15803d","#c2410c","#a21caf","#1d4ed8","#4d7c0f","#9f1239"];
const PERIODO=()=>new Date().toISOString().slice(0,7);
const CLAVE=(empresaId:string,periodo:string)=>`sigo-stock-inventario-${empresaId}-${periodo}`;
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

export default function StockVsInventario({empresaId}:{empresaId:string}) {
  const [periodo,setPeriodo]=useState(PERIODO);
  const [fotos,setFotos]=useState<FotoInventario[]>([]);
  const [hallazgos,setHallazgos]=useState<Hallazgo[]>([]);
  const [mensaje,setMensaje]=useState("");
  const [analizando,setAnalizando]=useState(false);
  const [bloque,setBloque]=useState("");
  const mes=new Intl.DateTimeFormat("es-AR",{month:"long",year:"numeric"}).format(new Date(`${periodo}-15T12:00:00Z`));
  const [historicos,setHistoricos]=useState<string[]>([]);
  const [revisiones,setRevisiones]=useState<Revision[]>([]);
  const [empresaCargada,setEmpresaCargada]=useState("");
  const lotes=useRef<LoteGuardado[]>([]);
  const controlador=useRef<AbortController|null>(null);
  const fotosActuales=useRef<FotoInventario[]>([]);
  const cargando=useRef(false);
  const revisionActual=useRef("");
  const contexto=useRef({empresaId,generacion:0});

  useEffect(()=>{
    const timer=window.setInterval(()=>setPeriodo(PERIODO()),60_000);
    return()=>window.clearInterval(timer);
  },[]);

  useEffect(()=>{
    let cancelado=false;
    contexto.current={empresaId,generacion:contexto.current.generacion+1};
    cargando.current=true;
    controlador.current?.abort(); controlador.current=null;
    fotosActuales.current.forEach(f=>URL.revokeObjectURL(f.url));
    fotosActuales.current=[];setFotos([]);setHallazgos([]);setBloque("");setMensaje("");setAnalizando(false);
    lotes.current=[];revisionActual.current="";setRevisiones([]);setEmpresaCargada("");
    try {
      const guardado=JSON.parse(localStorage.getItem(CLAVE(empresaId,periodo))||"{}");
      setHallazgos(guardado.hallazgos||[]);
      setBloque(guardado.bloque||"");
      setRevisiones(Array.isArray(guardado.revisiones)?guardado.revisiones:(guardado.hallazgos||[]).length?[{id:"anterior",fecha:Date.now(),bloque:guardado.bloque||"",hallazgos:guardado.hallazgos}]:[]);
      lotes.current=Array.isArray(guardado.lotes)?guardado.lotes.filter((l:LoteGuardado)=>l.vence>Date.now()):[];
      revisionActual.current=guardado.revisionActual||"";
      const prefijo=`sigo-stock-inventario-${empresaId}-`;
      setHistoricos(Object.keys(localStorage).filter(k=>k.startsWith(prefijo)&&k!==CLAVE(empresaId,periodo)).map(k=>k.slice(prefijo.length)).sort().reverse());
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
            const vigentes=propias.filter((f:any)=>f.vence>ahora).sort((a:any,b:any)=>typeof a.orden==="number"&&typeof b.orden==="number"?a.orden-b.orden:a.id.localeCompare(b.id)).slice(0,10);
            propias.filter((f:any)=>f.vence<=ahora).forEach((f:any)=>store.delete(f.key));
            const recuperadas=vigentes.map((f:any)=>({id:f.id,nombre:f.nombre,vence:f.vence,blob:f.blob,url:URL.createObjectURL(f.blob)}));
            fotosActuales.current=recuperadas;setFotos(recuperadas);
            cargando.current=false;
            if(!vigentes.length&&(guardado.fotos||[]).length)setMensaje("Las fotos anteriores ya no están disponibles en este navegador. Volvé a cargarlas para analizarlas.");
            db.close();
          };
          request.onerror=()=>{db.close();if(!cancelado)cargando.current=false;};
        }catch{
          if(!cancelado)cargando.current=false;
          if(!cancelado&&(guardado.fotos||[]).length)setMensaje("Las fotos anteriores ya no se pueden recuperar. Volvé a cargarlas para analizarlas.");
        }
      })();
    } catch { cargando.current=false; /* almacenamiento local opcional */ }
    setEmpresaCargada(`${empresaId}:${periodo}`);
    return()=>{cancelado=true;controlador.current?.abort();fotosActuales.current.forEach(f=>URL.revokeObjectURL(f.url));};
  },[empresaId,periodo]);

  useEffect(()=>{
    if(empresaCargada!==`${empresaId}:${periodo}`)return;
    try { localStorage.setItem(CLAVE(empresaId,periodo),JSON.stringify({hallazgos,mes,bloque,revisiones,lotes:lotes.current,revisionActual:revisionActual.current})); } catch { /* sin bloquear operación */ }
  },[empresaId,periodo,empresaCargada,hallazgos,mes,bloque,revisiones]);

  const hallazgosMes=useMemo(()=>revisiones.flatMap(r=>r.hallazgos.map(h=>({...h,id:`${r.id}-${h.id}`,fecha:r.fecha}))),[revisiones]);

  const resumen=useMemo(()=>({
    total:hallazgosMes.length,
    ok:hallazgosMes.filter(h=>h.estado==="ok").length,
    falta:hallazgosMes.filter(h=>h.estado==="falta_sigo").length,
    sinStock:hallazgosMes.filter(h=>h.estado==="sin_stock").length,
    noVisto:hallazgosMes.filter(h=>h.estado==="no_visto").length,
    revisar:hallazgosMes.filter(h=>h.estado==="revisar").length,
  }),[hallazgosMes]);

  async function cargarFotos(files:FileList|null){
    if(!files||analizando||cargando.current) return;
    const contextoCarga=contexto.current;
    cargando.current=true;
    const disponibles=Math.max(0,10-fotos.length);
    const seleccion=Array.from(files).slice(0,disponibles);
    if(Array.from(files).length>disponibles) setMensaje("Cada revisión admite hasta 10 fotos. Iniciá una nueva revisión para cargar otro grupo.");
    const nuevas=seleccion.filter(file=>file.type.startsWith("image/")||/\.(jpe?g|png|webp|hei[cf])$/i.test(file.name)).map(file=>({id:crypto.randomUUID(),nombre:file.name,url:URL.createObjectURL(file),vence:Date.now()+24*60*60*1000,blob:file}));
    if(nuevas.length!==seleccion.length)setMensaje("Seleccioná fotos JPG, PNG, WebP o HEIC compatible. Los PDF se leen desde Compras con IA.");
    fotosActuales.current=[...fotosActuales.current,...nuevas];setFotos(fotosActuales.current);
    const fotosGuardar=[...fotosActuales.current];
    if(nuevas.length)setHallazgos([]);
    try{
      const db=await abrirDBFotos();
      if(contexto.current!==contextoCarga){db.close();return;}
      const tx=db.transaction(STORE_FOTOS,"readwrite");
      const store=tx.objectStore(STORE_FOTOS);
      fotosGuardar.forEach((f,orden)=>store.put({key:`${empresaId}:${f.id}`,empresaId,id:f.id,nombre:f.nombre,vence:f.vence,blob:f.blob,orden}));
      tx.oncomplete=()=>db.close();
      tx.onerror=()=>{db.close();if(contexto.current===contextoCarga)setMensaje("Las fotos se pueden analizar ahora, pero no quedaron guardadas para reabrirlas durante las próximas 24 horas.");};
    }catch{
      if(contexto.current===contextoCarga)setMensaje("Las fotos se pueden analizar ahora, pero este navegador no permite conservarlas después de cerrar SIGO.");
    }finally{if(contexto.current===contextoCarga)cargando.current=false;}
  }

  async function analizar(){
    if(!fotos.length||analizando)return;
    const activa=new AbortController();controlador.current=activa;
    setAnalizando(true); setMensaje("Preparando fotos para comparar con el stock de SIGO…");
    try {
      if(fotos.some(f=>!f.blob))throw new Error("Una foto dejó de estar disponible. Volvé a cargarla para continuar.");
      if(fotos.some(f=>f.vence<=Date.now()))throw new Error("Venció la conservación de 24 horas de una foto. Iniciá una nueva revisión y volvé a cargarla.");
      const imagenes:string[]=[];
      for(const f of fotos){
        if(activa.signal.aborted)throw new Error("Análisis cancelado. Las fotos ya analizadas se conservan.");
        imagenes.push(await prepararImagenIA(new File([f.blob],f.nombre,{type:f.blob.type}),{maxBytes:1_000_000,maxDimension:2000}));
      }
      const completados=lotes.current.filter(l=>l.fotoId===fotos[l.indice]?.id&&l.vence>Date.now());
      const out=await analizarInventarioSigo(empresaId,imagenes,{signal:activa.signal,completados,onProgreso:(actual,total)=>{if(controlador.current===activa&&!activa.signal.aborted)setMensaje(`Analizando foto ${actual} de ${total}… Las anteriores se conservan para reintentar.`);},onLote:lote=>{
        if(controlador.current!==activa||activa.signal.aborted)return;
        const foto=fotos[lote.indice];
        lotes.current=[...lotes.current.filter(l=>l.fotoId!==foto.id),{...lote,fotoId:foto.id,vence:foto.vence}];
        try{const saved=JSON.parse(localStorage.getItem(CLAVE(empresaId,periodo))||"{}");localStorage.setItem(CLAVE(empresaId,periodo),JSON.stringify({...saved,lotes:lotes.current}));}catch{/* recuperación opcional */}
      }});
      if(activa.signal.aborted||controlador.current!==activa)return;
      const hallazgosNuevos=out.hallazgos.map((h,i)=>({...h,color:PALETA[i%PALETA.length]}));
      setBloque(out.bloque);setHallazgos(hallazgosNuevos);
      const id=revisionActual.current||crypto.randomUUID();revisionActual.current=id;
      setRevisiones(actual=>[...actual.filter(r=>r.id!==id),{id,fecha:Date.now(),bloque:out.bloque,hallazgos:hallazgosNuevos}]);
      setMensaje(`Bloque detectado: ${out.bloque||"a revisar"}. Comparación terminada.`);
    } catch(e){if(controlador.current===activa)setMensaje(e instanceof Error?e.message:"No se pudo analizar el inventario.");} finally{if(controlador.current===activa){setAnalizando(false);controlador.current=null;}}
  }

  async function nuevaRevision(){
    if(analizando||cargando.current)return;
    const contextoCarga=contexto.current;
    cargando.current=true;
    fotosActuales.current.forEach(f=>URL.revokeObjectURL(f.url));fotosActuales.current=[];setFotos([]);setHallazgos([]);setBloque("");setMensaje("");lotes.current=[];revisionActual.current="";
    try{const db=await abrirDBFotos();if(contexto.current!==contextoCarga){db.close();return;}const tx=db.transaction(STORE_FOTOS,"readwrite");const store=tx.objectStore(STORE_FOTOS);const r=store.getAll();r.onsuccess=()=>r.result.filter((f:any)=>f.empresaId===empresaId).forEach((f:any)=>store.delete(f.key));tx.oncomplete=()=>{db.close();if(contexto.current===contextoCarga)cargando.current=false;};tx.onerror=()=>{db.close();if(contexto.current===contextoCarga)cargando.current=false;};}catch{if(contexto.current===contextoCarga)cargando.current=false;/* no bloquear nueva revisión */}
  }

  function exportar(){
    const filas=[["Fecha","Código","Descripción","Categoría","Stock SIGO","Estado"],...hallazgosMes.map(h=>[new Date(h.fecha).toLocaleString("es-AR"),h.codigo,h.descripcion,h.categoria,h.stock_actual??"",h.estado])];
    const csv=filas.map(f=>f.map(v=>`"${String(v).replaceAll('"','""')}"`).join(";")).join("\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`SIGO-stock-inventario-${new Date().toISOString().slice(0,7)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return <div className="products-page">
    <div className="page-header"><div><h2>Stock vs Inventario</h2><p>Comparación visual por bloque. Reporte mensual · fotos disponibles durante 24 horas.</p></div><button className="admin-button" onClick={exportar} disabled={!hallazgosMes.length}>▣ Exportar Excel</button></div>
    <div className="stats-grid sigo-inventory-stats">
      <div className="stat-card"><span>Coinciden</span><strong>{resumen.ok}</strong></div>
      <div className="stat-card"><span>No está en SIGO</span><strong>{resumen.falta}</strong></div>
      <div className="stat-card"><span>Sin stock</span><strong>{resumen.sinStock}</strong></div>
      <div className="stat-card"><span>No visto</span><strong>{resumen.noVisto}</strong></div>
      <div className="stat-card"><span>Revisar</span><strong>{resumen.revisar}</strong></div>
    </div>
    <div className="panel">
      <div className="page-header"><div><h3>Nueva revisión</h3><p>Sacá una foto o subí hasta 10 fotos del mismo bloque o familia. SIGO compara sólo contra productos relacionados.</p></div><div className="topbar-actions"><label className="primary-button" style={{cursor:"pointer",fontSize:17}}>📷 Sacar foto<input hidden type="file" accept="image/*,.heic,.heif" capture="environment" disabled={analizando} onChange={e=>{void cargarFotos(e.target.files);e.target.value="";}}/></label><label className="admin-button" style={{cursor:"pointer"}}>＋ Agregar fotos<input hidden type="file" accept="image/*,.heic,.heif" multiple disabled={analizando} onChange={e=>{void cargarFotos(e.target.files);e.target.value="";}}/></label><button className="admin-button" disabled={analizando||!fotos.length} onClick={()=>void nuevaRevision()}>Nueva revisión</button></div></div>
      {mensaje&&<p role="alert">{mensaje}</p>}
      {fotos.length>0&&<div className="sigo-inventory-photos">
        {fotos.map((f,i)=><div key={f.id} className="sigo-inventory-photo"><img src={f.url} alt={f.nombre}/>{hallazgos.filter(h=>h.foto===i+1).map((h,j)=><span key={h.id} title={h.descripcion} style={{position:"absolute",left:`${h.x??50}%`,top:`${h.y??50}%`,width:16,height:16,borderRadius:"50%",background:h.color,border:"2px solid white",boxShadow:"0 1px 4px #0008",transform:"translate(-50%,-50%)",zIndex:2}}><small style={{position:"absolute",left:17,top:-3,background:"#fff",borderRadius:8,padding:"1px 4px",fontSize:9,fontWeight:800}}>{String(hallazgos.indexOf(h)+1).padStart(2,"0")}</small></span>)}<span style={{position:"absolute",left:8,bottom:8,background:"#fff",padding:"3px 7px",borderRadius:10,fontSize:12,fontWeight:800}}>Foto {i+1}</span></div>)}
      </div>}
      <p style={{marginTop:14}}><strong>Marcadores:</strong> cada producto detectado tendrá color + número. El punto se ubicará en un espacio libre o fuera del envase con una línea fina; nunca sobre logo, marca, variedad, tamaño, código o precio.</p>
      <button className="primary-button" disabled={!fotos.length||analizando} onClick={()=>void analizar()}>{analizando?"Analizando…":"✨ Analizar fotos"}</button>
      {analizando&&<button className="admin-button" onClick={()=>controlador.current?.abort()}>Cancelar análisis</button>}
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
      <div className="table-wrapper"><table className="products-table"><thead><tr><th>Marca</th><th>Fecha</th><th>Código</th><th>Descripción</th><th>Bloque</th><th>Stock SIGO</th><th>Estado</th></tr></thead><tbody>
        {hallazgosMes.map((h,i)=><tr key={h.id}><td><span aria-label={`Marcador ${i+1}`} style={{display:"inline-block",width:12,height:12,borderRadius:"50%",background:h.color||PALETA[i%PALETA.length],marginRight:7}}/>{String(i+1).padStart(2,"0")}</td><td>{new Date(h.fecha).toLocaleString("es-AR")}</td><td>{h.codigo||"-"}</td><td><strong>{h.descripcion}</strong></td><td>{h.categoria}</td><td>{h.stock_actual==null?"-":h.stock_actual}</td><td>{h.estado==="falta_sigo"?"F — NO ESTÁ EN SIGO":h.estado==="sin_stock"?"SIN STOCK EN SIGO":h.estado==="no_visto"?"NO VISTO EN INVENTARIO":h.estado==="ok"?"ESTÁ EN SIGO":"REVISAR"}</td></tr>)}
      </tbody></table>{!hallazgosMes.length&&<div className="table-empty">Todavía no hay revisiones cargadas este mes.</div>}</div>
    </div>
  </div>;
}

