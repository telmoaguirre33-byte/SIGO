import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {supabase} from '../../../supabase';
import {cargarMisEmpresas,leerEmpresaActivaGuardada,resolverEmpresaActiva,type EmpresaOperativa} from '../../../tenant';
import {createCompanyConfigProvider} from './company-config';
import {type CompanyAccessConfig,resolveMayoristaAccess} from './access-policy';
import {mayoristaPages} from './navigation.mjs';
import MayoristaWorkspace from './MayoristaWorkspace';
import './workspace.css';
const readConfig=createCompanyConfigProvider(async(id,signal)=>{
 const {data,error}=await supabase.rpc('obtener_acceso_mayorista_sigo',{p_empresa_id:id}).abortSignal(signal);
 if(error)throw error;return data;
});
const commerceRpc=async(name:string,args:Record<string,unknown>)=>{
 if(name==='facturar_entrega_mayorista_sigo'){
  const {data}=await supabase.auth.getSession(),token=data.session?.access_token;
  if(!token)throw Error('Volvé a ingresar a SIGO');
  const response=await fetch('/api/mayorista/arca',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok)throw Error('Factura no confirmada. Conservamos la entrega para revisión.');return result;
 }
 if(!['leer_comercio_mayorista_sigo','registrar_entrega_mayorista_sigo','autorizar_credito_mayorista_sigo','registrar_cobro_mayorista_sigo'].includes(name))throw Error('Operación inválida');
 const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data;
};
/** Acceso añadido al menú; sin acceso confirmado no renderiza elementos Mayorista. */
export default function MayoristaLauncher(){
 const [company,setCompany]=useState<EmpresaOperativa|null>(null),[config,setConfig]=useState<CompanyAccessConfig|null>(null),[host,setHost]=useState<HTMLElement|null>(null),[page,setPage]=useState<string|null>(null);
 const generation=useRef(0),controller=useRef<AbortController|null>(null),dialog=useRef<HTMLDivElement>(null);
 const refresh=useCallback(async()=>{
  const g=++generation.current;controller.current?.abort();const c=new AbortController();controller.current=c;
  setCompany(null);setConfig(null);setPage(null);
  try{
   const {data,error}=await supabase.auth.getUser();if(error||!data.user)return;
   const companies=await cargarMisEmpresas(),active=resolverEmpresaActiva(companies,leerEmpresaActivaGuardada(data.user.id),data.user.id);
   if(!active||!['owner','admin'].includes(active.rol))return;
   const settings=await readConfig(active.empresa_id,c.signal);
   if(g!==generation.current||c.signal.aborted||!resolveMayoristaAccess({empresaId:active.empresa_id,rol:active.rol},settings).enabled)return;
   setCompany(active);setConfig(settings);
  }catch{/* La ausencia del módulo no afecta la operación Minorista. */}
 },[]);
 useEffect(()=>{
  void refresh();const update=()=>void refresh();
  window.addEventListener('sigo:empresa-activa-cambiada',update);window.addEventListener('sigo:mayorista-config-changed',update);
  const {data}=supabase.auth.onAuthStateChange(event=>{if(['SIGNED_OUT','SIGNED_IN'].includes(event))window.setTimeout(update,0);});
  return()=>{generation.current++;controller.current?.abort();data.subscription.unsubscribe();window.removeEventListener('sigo:empresa-activa-cambiada',update);window.removeEventListener('sigo:mayorista-config-changed',update);};
 },[refresh]);
 useEffect(()=>{const find=()=>{const next=document.querySelector<HTMLElement>('.sigo-operation-only .sidebar .menu')??document.querySelector<HTMLElement>('.sigo-context-actions');setHost(old=>old===next?old:next);};find();const observer=new MutationObserver(find);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!page)return;const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setPage(null);if(e.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button,a,input,select,[tabindex="0"]');if(!items?.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[Boolean(page)]);
 if(!company||!config)return null;
 return <>{host&&createPortal(<details className="mayorista-menu-section"><summary>MAYORISTA / DISTRIBUIDORA</summary><nav aria-label="Mayorista / Distribuidora">{mayoristaPages.map(item=><button key={item.id} className="menu-item" type="button" onClick={()=>setPage(item.id)}>{item.label}</button>)}</nav></details>,host)}{page&&<div className="mayorista-page-overlay" role="dialog" aria-modal="true" aria-label="Mayorista / Distribuidora" tabIndex={-1} ref={dialog}><header className="mayorista-page-header"><button type="button" className="admin-button" onClick={()=>setPage(null)}>← Volver a SIGO</button><strong>{company.empresa_nombre}</strong><a className="admin-button" href={config.vendedorUrl} target="_blank" rel="noopener noreferrer">App Vendedor</a></header><main className="mayorista-page-content"><MayoristaWorkspace key={company.empresa_id} origin={config.origenAprobado} empresaId={company.empresa_id} page={page} sharedRpc={commerceRpc}/></main></div>}</>;
}
