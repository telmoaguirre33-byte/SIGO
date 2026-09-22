import { useEffect, useMemo, useState } from "react";
import { cargarRankingProductosSigo, type RankingProductoSigo } from "./rankingProductos";

type Periodo = "7" | "15" | "mes" | "personalizado";
type Orden = "unidades" | "importe";
function iso(d: Date) { return d.toISOString().slice(0, 10); }
function rango(p: Periodo) {
  const h = new Date(); const hasta = iso(h); const d = new Date(h);
  if (p === "mes") d.setDate(1); else d.setDate(d.getDate() - Number(p === "15" ? 15 : 7) + 1);
  return { desde: iso(d), hasta };
}
function dinero(v:number){return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(v)}

export default function RankingProductosStock({empresaId}:{empresaId:string}) {
  const inicial=rango("7");
  const [periodo,setPeriodo]=useState<Periodo>("7"),[desde,setDesde]=useState(inicial.desde),[hasta,setHasta]=useState(inicial.hasta);
  const [top,setTop]=useState(10),[orden,setOrden]=useState<Orden>("unidades"),[datos,setDatos]=useState<RankingProductoSigo[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  async function cargar(d=desde,h=hasta){setLoading(true);setError("");try{setDatos(await cargarRankingProductosSigo(empresaId,d,h))}catch(e){setError(e instanceof Error?e.message:"No se pudo cargar el ranking.")}finally{setLoading(false)}}
  useEffect(()=>{const r=rango("7");void cargar(r.desde,r.hasta)},[empresaId]);
  function elegir(p:Periodo){setPeriodo(p);if(p==="personalizado")return;const r=rango(p);setDesde(r.desde);setHasta(r.hasta);void cargar(r.desde,r.hasta)}
  const ranking=useMemo(()=>[...datos].sort((a,b)=>b[orden]-a[orden]).slice(0,top),[datos,orden,top]);
  const max=Math.max(...ranking.map(x=>x[orden]),1);
  return <div>
    <div className="page-header"><div><h3>🏆 Ranking de productos</h3><p>Productos más vendidos según ventas confirmadas.</p></div></div>
    <div className="sigo-income-presets">{([["7","7 días"],["15","15 días"],["mes","Este mes"],["personalizado","Personalizado"]] as Array<[Periodo,string]>).map(([v,l])=><button key={v} className={periodo===v?"active":""} onClick={()=>elegir(v)}>{l}</button>)}</div>
    {periodo==="personalizado"&&<div className="sigo-income-custom-range"><label><span>Desde</span><input type="date" value={desde} onChange={e=>setDesde(e.target.value)}/></label><label><span>Hasta</span><input type="date" value={hasta} onChange={e=>setHasta(e.target.value)}/></label><button className="primary-button" onClick={()=>void cargar()}>Aplicar</button></div>}
    <div className="form-actions" style={{justifyContent:"flex-start",margin:"14px 0"}}>
      <label>Mostrar <select value={top} onChange={e=>setTop(Number(e.target.value))}>{[5,10,15,20,25,30,50].map(n=><option key={n} value={n}>Top {n}</option>)}</select></label>
      <button className={orden==="unidades"?"primary-button":"admin-button"} onClick={()=>setOrden("unidades")}>Unidades</button>
      <button className={orden==="importe"?"primary-button":"admin-button"} onClick={()=>setOrden("importe")}>Facturación</button>
    </div>
    {loading?<p>Cargando ranking…</p>:error?<p role="alert">{error}</p>:ranking.length===0?<p>Sin ventas confirmadas en el período.</p>:<div style={{display:"grid",gap:12}}>
      {ranking.map((p,i)=><div key={p.productoId}><div style={{display:"flex",justifyContent:"space-between",gap:12}}><strong>{i+1}. {p.nombre}</strong><span>{orden==="unidades"?`${p.unidades.toLocaleString("es-AR")} u.`:dinero(p.importe)}</span></div><div style={{height:12,background:"#e5e7eb",borderRadius:8,overflow:"hidden",marginTop:6}}><div style={{height:"100%",width:`${Math.max(3,(p[orden]/max)*100)}%`,background:"#2563eb"}}/></div><small>{p.unidades.toLocaleString("es-AR")} unidades · {dinero(p.importe)}</small></div>)}
    </div>}
  </div>
}
