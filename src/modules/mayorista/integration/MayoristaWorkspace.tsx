import {useEffect,useRef,useState} from 'react';
import './workspace.css';
export default function MayoristaWorkspace({origin,empresaId}:{origin:string;empresaId:string}){
  const host=useRef<HTMLDivElement>(null),[error,setError]=useState('');
  useEffect(()=>{
    let disposed=false,logout:(()=>Promise<void>)|undefined;
    const child=document.createElement('div');host.current?.replaceChildren(child);setError('');
    void import('../admin/operational-portal.mjs').then(({mountOperationalPortal})=>{
      if(disposed)return;
      const portal=mountOperationalPortal(child,{enabled:true,baseUrl:origin,integrated:true,expectedEmpresaId:empresaId});
      logout=()=>portal?.client.logout()??Promise.resolve();
    }).catch(()=>{if(!disposed)setError('No se pudo abrir Mayorista. Volvé a intentar.');});
    return()=>{disposed=true;void logout?.().catch(()=>{});child.remove();};
  },[origin,empresaId]);
  return <section className="sigo-mayorista-workspace" aria-label="Mayorista / Distribuidora">{error&&<p role="alert">{error}</p>}<div ref={host}/></section>;
}
