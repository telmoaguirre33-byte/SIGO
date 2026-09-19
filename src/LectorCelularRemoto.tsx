import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

type Props={empresaId:string; onCode:(codigo:string)=>void};

export default function LectorCelularRemoto({empresaId,onCode}:Props){
  const [token,setToken]=useState("");
  const [sessionId,setSessionId]=useState("");
  const [error,setError]=useState("");
  const [last,setLast]=useState("");
  const [qrData,setQrData]=useState("");
  const channelRef=useRef<any>(null);
  const lastRef=useRef("");

  useEffect(()=>()=>{ if(channelRef.current) void supabase.removeChannel(channelRef.current); },[]);
  useEffect(()=>{
    if(!sessionId)return;
    let alive=true;
    const timer=window.setInterval(async()=>{
      const {data}=await supabase.rpc("lector_celular_estado",{p_sesion_id:sessionId});
      const row=Array.isArray(data)?data[0]:data;
      const codigo=String(row?.codigo||"").trim();
      if(alive&&codigo&&codigo!==lastRef.current){lastRef.current=codigo;setLast(codigo);onCode(codigo);}
    },900);
    return()=>{alive=false;window.clearInterval(timer);};
  },[sessionId,onCode]);

  async function vincular(){
    setError("");
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){setError("La sesión venció.");return;}
    const {data,error:e}=await supabase.rpc("crear_sesion_lector_celular",{p_empresa_id:empresaId});
    const sesion=Array.isArray(data)?data[0]:data;
    if(e||!sesion){setError(e?.message||"No se pudo crear la vinculación.");return;}
    setSessionId(String(sesion.id)); setToken(String(sesion.token));
    if(channelRef.current) await supabase.removeChannel(channelRef.current);
    const ch=supabase.channel("lector-"+sesion.id)
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"sigo_lector_celular_sesiones",filter:`id=eq.${sesion.id}`},(payload:any)=>{
        const codigo=String(payload.new?.codigo||"").trim();
        if(codigo&&codigo!==lastRef.current){lastRef.current=codigo;setLast(codigo);onCode(codigo);}
      }).subscribe();
    channelRef.current=ch;
  }
  const link=token ? `${window.location.origin}/?lector_token=${encodeURIComponent(token)}` : "";
  useEffect(()=>{let active=true;if(!link){setQrData("");return;}void import("qrcode").then((QR)=>QR.toDataURL(link,{width:260,margin:1,errorCorrectionLevel:"M"})).then((url)=>{if(active)setQrData(url);}).catch(()=>{if(active)setQrData("");});return()=>{active=false;};},[link]);
  return <div className="panel" style={{border:"2px solid #16a34a"}}>
    <div className="page-header"><div><h3>📱 Lector celular remoto</h3><p>Usá la cámara del teléfono como lector inalámbrico para esta computadora.</p></div>{token&&<strong style={{color:"#15803d"}}>● Esperando celular</strong>}</div>
    {!token?<button className="primary-button" type="button" onClick={()=>void vincular()}>📱 Vincular celular</button>:<>
      <div style={{display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"grid",gap:10,justifyItems:"center"}}>
          {qrData ? <img src={qrData} width="220" height="220" alt="QR para vincular celular"/> : <div style={{width:220,height:220,display:"grid",placeItems:"center",border:"1px solid #cbd5e1",borderRadius:12}}>Generando QR…</div>}
          <a className="primary-button" href={link} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>Abrir vínculo en celular</a>
          <small style={{maxWidth:320,wordBreak:"break-all"}}>{link}</small>
        </div>
        <div><h4>1. Escaneá este QR con el celular</h4><p>2. Abrí el enlace de SIGO.</p><p>3. Permití usar la cámara.</p><p>4. Escaneá productos.</p>{last&&<p><strong>Último código:</strong> {last}</p>}</div>
      </div>
      <button className="admin-button" type="button" onClick={()=>{setToken("");setSessionId("");setLast("");if(channelRef.current)void supabase.removeChannel(channelRef.current);channelRef.current=null;}}>Desvincular</button>
    </>}
    {error&&<p className="form-error">{error}</p>}
  </div>;
}
