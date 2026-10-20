import { useCallback,useEffect,useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./supabase";
import { cargarMisEmpresas,leerEmpresaActivaGuardada,resolverEmpresaActiva,type EmpresaOperativa } from "./tenant";
import { listarModulosEmpresa } from "./modulosEmpresa";
import LectorCelularRemoto from "./LectorCelularRemoto";

type Host={element:HTMLElement;kind:"sidebar"|"context"}|null;
export default function LectorCelularLauncher(){
 const [empresa,setEmpresa]=useState<EmpresaOperativa|null>(null);const [activo,setActivo]=useState(false);const [open,setOpen]=useState(false);const [host,setHost]=useState<Host>(null);const [ultimoCodigo,setUltimoCodigo]=useState("");
 const cargar=useCallback(async()=>{try{const {data}=await supabase.auth.getUser();if(!data.user){setEmpresa(null);setActivo(false);return;}const empresas=await cargarMisEmpresas();const e=resolverEmpresaActiva(empresas,leerEmpresaActivaGuardada(data.user.id),data.user.id);setEmpresa(e);if(!e){setActivo(false);return;}const mods=await listarModulosEmpresa(e.empresa_id);setActivo(Boolean(mods.find(m=>m.clave==="lector_celular_remoto")?.habilitado));}catch{setActivo(false);}},[]);
 useEffect(()=>{void cargar();const f=()=>{if(document.visibilityState==="visible")void cargar();};document.addEventListener("visibilitychange",f);return()=>document.removeEventListener("visibilitychange",f);},[cargar]);
 useEffect(()=>{function resolver(){const menu=document.querySelector<HTMLElement>(".sigo-operation-only .sidebar .menu");if(menu){setHost({element:menu,kind:"sidebar"});return;}const c=document.querySelector<HTMLElement>(".sigo-context-actions");setHost(c?{element:c,kind:"context"}:null);}resolver();const o=new MutationObserver(resolver);o.observe(document.body,{childList:true,subtree:true});return()=>o.disconnect();},[]);
 if(!empresa||!activo)return null;
 const boton=host?.kind==="sidebar"?<button className="menu-item sigo-mobile-reader-menu-item" type="button" onClick={()=>setOpen(true)}><span className="menu-icon">📱</span><span>Vincular celular</span></button>:<button className="admin-button" type="button" onClick={()=>setOpen(true)}>📱 Vincular celular</button>;
 if(host?.kind==="sidebar"){
   const carrito=host.element.querySelector(".sigo-cart-menu-item");
   const lector=host.element.querySelector(".sigo-mobile-reader-menu-item");
   if(carrito&&lector&&carrito.nextElementSibling!==lector) carrito.insertAdjacentElement("afterend",lector);
 }
 return <>{host?createPortal(boton,host.element):null}{open&&<div className="sigo-cart-overlay" role="dialog" aria-modal="true"><div className="sigo-cart-topbar"><button className="admin-button" onClick={()=>setOpen(false)}>← Cerrar</button><div><strong>📱 Vincular celular</strong><small>{empresa.empresa_nombre}</small></div></div><main className="sigo-cart-content"><LectorCelularRemoto empresaId={empresa.empresa_id} onCode={(codigo)=>{setUltimoCodigo(codigo);window.dispatchEvent(new CustomEvent("sigo-remote-barcode",{detail:codigo}));}}/>{ultimoCodigo&&<div className="panel" style={{marginTop:12}}><strong>Código recibido:</strong><div style={{fontSize:30,fontWeight:900}}>{ultimoCodigo}</div></div>}</main></div>}</>;
}
