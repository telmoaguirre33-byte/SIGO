import { useEffect,useRef,useState } from "react";
import { supabase } from "./supabase";

export default function LectorCelularPage({token}:{token:string}){
 const videoRef=useRef<HTMLVideoElement>(null); const [estado,setEstado]=useState("Preparando cámara…"); const [ultimo,setUltimo]=useState("");
 useEffect(()=>{let controls:any;let cancelled=false;
  async function start(){
   const {data,error}=await supabase.rpc("lector_celular_resolver_token",{p_token:token});
   if(error||!data){setEstado("Vínculo inválido o vencido.");return;}
   try{
    const {BrowserMultiFormatReader}=await import("@zxing/browser"); if(cancelled||!videoRef.current)return;
    const reader=new BrowserMultiFormatReader();
    controls=await reader.decodeFromConstraints({video:{facingMode:{ideal:"environment"}}},videoRef.current,async(result)=>{
      const code=result?.getText()?.trim(); if(!code||code===ultimo)return;
      setUltimo(code);setEstado("Código enviado: "+code);
      await supabase.rpc("lector_celular_enviar_codigo",{p_token:token,p_codigo:code});
    });
    setEstado("Celular vinculado · apuntá al código de barras");
   }catch{setEstado("No se pudo abrir la cámara. Revisá el permiso del navegador.");}
  } void start(); return()=>{cancelled=true;controls?.stop?.();};
 },[token]);
 return <main style={{minHeight:"100vh",padding:18,background:"#0f172a",color:"white",fontFamily:"Arial"}}>
  <h1>SIGO · Lector celular</h1><p>{estado}</p>
  <video ref={videoRef} playsInline muted style={{width:"100%",maxWidth:620,borderRadius:18,background:"#000"}}/>
  {ultimo&&<h2>Último: {ultimo}</h2>}
 </main>;
}
