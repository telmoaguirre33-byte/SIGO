import { useEffect,useRef,useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { supabase } from "./supabase";

export default function LectorCelularPage({token}:{token:string}){
 const videoRef=useRef<HTMLVideoElement>(null); const [estado,setEstado]=useState("Preparando cámara…"); const [ultimo,setUltimo]=useState(""); const [flash,setFlash]=useState(false); const ultimoRef=useRef(""); const ultimoAtRef=useRef(0);
 useEffect(()=>{let controls:any;let cancelled=false;
  async function start(){
   const {data,error}=await supabase.rpc("lector_celular_resolver_token",{p_token:token});
   if(error||!data){setEstado("Vínculo inválido o vencido.");return;}
   try{
    if(cancelled||!videoRef.current)return;
    const hints=new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.UPC_E,BarcodeFormat.CODE_128,BarcodeFormat.CODE_39,BarcodeFormat.ITF]);
    hints.set(DecodeHintType.TRY_HARDER,true);
    const reader=new BrowserMultiFormatReader(hints);
    controls=await reader.decodeFromConstraints({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}},videoRef.current,async(result)=>{
      const code=result?.getText()?.trim(); if(!code)return;
      const ahora=Date.now(); if(code===ultimoRef.current && ahora-ultimoAtRef.current<1400)return;
      ultimoRef.current=code; ultimoAtRef.current=ahora; setUltimo(code); setFlash(true); window.setTimeout(()=>setFlash(false),140);
      setEstado("Detectado: "+code+" · enviando…");
      if(navigator.vibrate) navigator.vibrate(80);
      const {error:sendError}=await supabase.rpc("lector_celular_enviar_codigo",{p_token:token,p_codigo:code});
      if(sendError){setEstado("Código leído, pero no se pudo enviar. Reintentá.");ultimoRef.current="";}else{setEstado("✓ TOMADO · "+code);}
    });
    setEstado("Celular vinculado · apuntá al código de barras");
   }catch{setEstado("No se pudo abrir la cámara. Revisá el permiso del navegador.");}
  } void start(); return()=>{cancelled=true;controls?.stop?.();};
 },[token]);
 return <main style={{minHeight:"100vh",padding:"18px 18px 34px",background:"linear-gradient(180deg,#0f1b31,#071426)",color:"white",fontFamily:"Arial,sans-serif"}}>
  <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,maxWidth:620,margin:"0 auto 18px"}}>
   <div><h1 style={{margin:0,fontSize:"clamp(34px,9vw,54px)"}}>SIGO</h1><div style={{fontSize:22,fontWeight:700,opacity:.85}}>Lector celular</div></div>
   <div style={{background:"#16263f",padding:"12px 16px",borderRadius:18,fontWeight:800}}><span style={{color:"#22c55e"}}>●</span> Conectado</div>
  </header>
  <section style={{maxWidth:620,margin:"0 auto 16px",background:"#14243b",padding:"14px 18px",borderRadius:18}}>
   <strong>Apuntá solo al código de barras</strong><div style={{opacity:.75,marginTop:4}}>El código se envía automáticamente a la computadora.</div>
  </section>
  <div style={{position:"relative",width:"100%",maxWidth:620,height:"clamp(130px,21vh,170px)",margin:"0 auto",overflow:"hidden",borderRadius:18,border:"3px solid #22c55e"}}>
   <video ref={videoRef} playsInline muted style={{width:"100%",height:"100%",objectFit:"cover",background:"#000"}}/>
   <div style={{position:"absolute",inset:0,background:"#fff",opacity:flash?.82:0,transition:"opacity 120ms",pointerEvents:"none",zIndex:4}}/><div style={{position:"absolute",left:"4%",right:"4%",top:"22%",bottom:"22%",border:"2px solid #22c55e",borderRadius:10,pointerEvents:"none"}}/><div style={{position:"absolute",left:"4%",right:"4%",top:"50%",height:3,background:"#ef4444",boxShadow:"0 0 10px #ef4444",pointerEvents:"none"}}/>
  </div>
  <div style={{maxWidth:620,margin:"14px auto",display:"flex",justifyContent:"space-around",textAlign:"center",fontSize:13,opacity:.9}}>
   <span>⚡<br/>Lectura rápida</span><span>◎<br/>Enfoque automático</span><span>✓<br/>Envío automático</span>
  </div>
  <section style={{maxWidth:620,margin:"16px auto 0",background:"#14243b",padding:"16px 18px",borderRadius:18}}>
   <div style={{opacity:.75,fontWeight:700}}>Último código</div>
   {ultimo ? <div style={{display:"flex",alignItems:"center",gap:12,marginTop:8}}><span style={{fontSize:34,color:"#22c55e"}}>✓</span><div><strong style={{fontSize:"clamp(24px,7vw,36px)"}}>{ultimo}</strong><div style={{color:"#86efac"}}>Enviado a SIGO</div></div></div> : <div style={{marginTop:8,opacity:.65}}>Esperando lectura…</div>}
  </section>
  <div style={{maxWidth:620,margin:"12px auto",textAlign:"center",fontWeight:800,color:estado.startsWith("Código")||estado.startsWith("✅")?"#86efac":"white"}}>{estado}</div>
 </main>;
}
