import { useEffect,useRef,useState } from "react";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/browser";
import { supabase } from "./supabase";

export default function LectorCelularPage({token}:{token:string}){
 const videoRef=useRef<HTMLVideoElement>(null); const [estado,setEstado]=useState("Preparando cámara…"); const [ultimo,setUltimo]=useState(""); const ultimoRef=useRef("");
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
    controls=await reader.decodeFromConstraints({video:{facingMode:{exact:"environment"},width:{ideal:1920},height:{ideal:1080},advanced:[{focusMode:"continuous"} as any]}},videoRef.current,async(result)=>{
      const code=result?.getText()?.trim(); if(!code||code===ultimoRef.current)return;
      ultimoRef.current=code; setUltimo(code);setEstado("Código leído · enviado a SIGO: "+code);
      if(navigator.vibrate) navigator.vibrate(80);
      const {error:sendError}=await supabase.rpc("lector_celular_enviar_codigo",{p_token:token,p_codigo:code});
      if(sendError)setEstado("Código leído, pero no se pudo enviar. Reintentá.");
    });
    setEstado("Celular vinculado · apuntá al código de barras");
   }catch{setEstado("No se pudo abrir la cámara. Revisá el permiso del navegador.");}
  } void start(); return()=>{cancelled=true;controls?.stop?.();};
 },[token]);
 return <main style={{minHeight:"100vh",padding:18,background:"#0f172a",color:"white",fontFamily:"Arial"}}>
  <h1>SIGO · Lector celular</h1><p>{estado}</p>
  <div style={{position:"relative",width:"100%",maxWidth:620}}>
   <video ref={videoRef} playsInline muted style={{width:"100%",borderRadius:18,background:"#000"}}/>
   <div style={{position:"absolute",left:"8%",right:"8%",top:"42%",height:"16%",border:"3px solid #22c55e",borderRadius:12,boxShadow:"0 0 0 9999px rgba(0,0,0,.18)",pointerEvents:"none"}}/>
  </div>
  <p style={{opacity:.8}}>Acercá el código hasta que ocupe el recuadro verde. Evitá reflejos y mantenelo enfocado.</p>
  {ultimo&&<h2>Último: {ultimo}</h2>}
 </main>;
}
