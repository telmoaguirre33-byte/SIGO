import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '../../../supabase';
import {cargarMisEmpresas,leerEmpresaActivaGuardada,resolverEmpresaActiva,type EmpresaOperativa} from '../../../tenant';
import {createCompanyConfigProvider} from './company-config';
import {previewQaConfig} from './preview-qa-config';
import {type CompanyAccessConfig,isMayoristaEnabled,resolveMayoristaAccess} from './access-policy';
import {mayoristaPages} from './navigation.mjs';
import MayoristaWorkspace from './MayoristaWorkspace';
import './workspace.css';
const getSigoToken=async()=>{const {data}=await supabase.auth.getSession();const token=data.session?.access_token;if(!token)throw Error('Volvé a ingresar a SIGO');return token;};
const readConfig=createCompanyConfigProvider(async(id,signal)=>{
 const qa=previewQaConfig(id,import.meta.env,location.origin);if(qa)return qa;
 const {data,error}=await supabase.rpc('obtener_acceso_mayorista_sigo',{p_empresa_id:id}).abortSignal(signal);
 if(error)throw error;return data;
},async(id,signal)=>{
 const {data,error}=await supabase.rpc('listar_modulos_empresa_sigo',{p_empresa_id:id}).abortSignal(signal);
 if(error)throw error;return data;
});
const commerceRpc=async(name:string,args:Record<string,unknown>)=>{
 if(['facturar_entrega_mayorista_sigo','emitir_nota_credito_mayorista_sigo'].includes(name)){
  const {data}=await supabase.auth.getSession(),token=data.session?.access_token;
  if(!token)throw Error('Volvé a ingresar a SIGO');
  const response=await fetch(name==='emitir_nota_credito_mayorista_sigo'?'/api/mayorista/nota-credito':'/api/mayorista/arca',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok)throw Error('Factura no confirmada. Conservamos la entrega para revisión.');return result;
 }
 if(!['leer_comercio_mayorista_sigo','registrar_entrega_mayorista_sigo','autorizar_credito_mayorista_sigo','registrar_cobro_mayorista_sigo'].includes(name))throw Error('Operación inválida');
 const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data;
};
/** Acceso añadido al menú; sin acceso confirmado no renderiza elementos Mayorista. */
export default function MayoristaLauncher(){
 const [company,setCompany]=useState<EmpresaOperativa|null>(null),[config,setConfig]=useState<CompanyAccessConfig|null>(null),[hosts,setHosts]=useState<{desktop:HTMLElement|null;mobile:HTMLElement|null}>({desktop:null,mobile:null}),[page,setPage]=useState<string|null>(null);
 const generation=useRef(0),controller=useRef<AbortController|null>(null),dialog=useRef<HTMLDivElement>(null);
 const refresh=useCallback(async(reset=false)=>{
  const g=++generation.current;controller.current?.abort();const c=new AbortController();controller.current=c;
  const clear=()=>{if(g===generation.current){setCompany(null);setConfig(null);setPage(null);}};if(reset)clear();
  try{
   const {data,error}=await supabase.auth.getUser();if(error||!data.user){clear();return;}
   const companies=await cargarMisEmpresas(),active=resolverEmpresaActiva(companies,leerEmpresaActivaGuardada(data.user.id),data.user.id);
   if(!active||!['owner','admin'].includes(active.rol)){clear();return;}
   const settings=await readConfig(active.empresa_id,c.signal);
   if(g!==generation.current||c.signal.aborted)return;if(!isMayoristaEnabled({empresaId:active.empresa_id,rol:active.rol},settings)){clear();return;}
   setCompany(active);setConfig(settings);
  }catch{clear();/* Fallo cerrado: no afecta la operación Minorista. */}
 },[]);
 useEffect(()=>{
  void refresh();const update=()=>void refresh(true);
  window.addEventListener('sigo:empresa-activa-cambiada',update);window.addEventListener('sigo:mayorista-config-changed',update);
  const resume=()=>{if(document.visibilityState==='visible')void refresh();};window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
  const {data}=supabase.auth.onAuthStateChange(event=>{if(['SIGNED_OUT','SIGNED_IN'].includes(event))window.setTimeout(()=>void refresh(event==='SIGNED_OUT'),0);});
  return()=>{generation.current++;controller.current?.abort();data.subscription.unsubscribe();window.removeEventListener('sigo:empresa-activa-cambiada',update);window.removeEventListener('sigo:mayorista-config-changed',update);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
 },[refresh]);
 useEffect(()=>{const find=()=>{const desktop=document.querySelector<HTMLElement>('.sigo-operation-only .sidebar .menu')??document.querySelector<HTMLElement>('.sigo-context-actions'),mobile=document.querySelector<HTMLElement>('.sigo-mobile-drawer-nav');setHosts(old=>old.desktop===desktop&&old.mobile===mobile?old:{desktop,mobile});};find();const observer=new MutationObserver(find);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!page)return;const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setPage(null);if(e.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button,a,input,select,[tabindex="0"]');if(!items?.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[Boolean(page)]);
 if(!company||!config)return null;
 const decision=resolveMayoristaAccess({empresaId:company.empresa_id,rol:company.rol},config);
 const open=(id:string)=>{document.querySelector<HTMLButtonElement>('.sigo-mobile-drawer-backdrop')?.click();setPage(id);};
 const buttons=(mobile=false)=>mayoristaPages.map(item=><button key={item.id} className={mobile?'sigo-mobile-drawer-item':'menu-item'} type="button" onClick={()=>open(item.id)}>{item.label}</button>);
 return <>{hosts.desktop&&createPortal(<details className="mayorista-menu-section"><summary>MAYORISTA / DISTRIBUIDORA</summary><nav aria-label="Mayorista / Distribuidora">{buttons()}</nav></details>,hosts.desktop)}{hosts.mobile&&createPortal(<section className="mayorista-mobile-section" aria-label="Mayorista / Distribuidora"><h3>MAYORISTA / DISTRIBUIDORA</h3>{buttons(true)}</section>,hosts.mobile)}{page&&<div className="mayorista-page-overlay" role="dialog" aria-modal="true" aria-label="Mayorista / Distribuidora" tabIndex={-1} ref={dialog}><header className="mayorista-page-header"><button type="button" className="admin-button" onClick={()=>setPage(null)}>← Volver a SIGO</button><strong>{company.empresa_nombre}</strong>{decision.sellerUrl&&!config.qaAislado&&<a className="admin-button" href={decision.sellerUrl} target="_blank" rel="noopener noreferrer">App Vendedor</a>}</header><main className="mayorista-page-content">{config.qaAislado&&<p role="status">QA AISLADO · Datos sintéticos persistentes. Sin operaciones sobre el negocio real.</p>}{decision.enabled?<MayoristaWorkspace key={company.empresa_id} origin={config.origenAprobado} empresaId={company.empresa_id} page={page} sharedRpc={config.qaAislado?undefined:commerceRpc} qaAislado={config.qaAislado} getSigoToken={getSigoToken}/>:<section role="alert"><h2>{mayoristaPages.find(item=>item.id===page)?.label}</h2><p>Mayorista está activo para {company.empresa_nombre}. Falta configurar la conexión operativa de este entorno en Matriz.</p><p>{decision.reason}</p><button type="button" className="admin-button" onClick={()=>void refresh()}>Volver a verificar conexión</button></section>}</main></div>}</>;
}
