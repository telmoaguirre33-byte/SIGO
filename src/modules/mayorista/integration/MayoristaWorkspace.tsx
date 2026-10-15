import {useEffect,useRef,useState} from 'react';
import './workspace.css';
import {createSharedCommerce} from './shared-commerce.mjs';
export default function MayoristaWorkspace({origin,empresaId,sharedRpc,page='panel',getSigoToken}:{origin:string;empresaId:string;page?:string;sharedRpc?:(name:string,args:Record<string,unknown>)=>Promise<any>;getSigoToken?:()=>Promise<string>}){
  const pageRef=useRef(page);pageRef.current=page;
  const portalRef=useRef<{showPage:(page:string)=>void;destroy:()=>Promise<void>}|undefined>(undefined);
  const host=useRef<HTMLDivElement>(null),[error,setError]=useState('');
  useEffect(()=>{
    let disposed=false,logout:(()=>Promise<void>)|undefined;
    const child=document.createElement('div');host.current?.replaceChildren(child);setError('');
    void import('../admin/operational-portal.mjs').then(({mountOperationalPortal})=>{
      if(disposed)return;
      const portal=mountOperationalPortal(child,{enabled:true,baseUrl:origin,integrated:true,expectedEmpresaId:empresaId,initialPage:pageRef.current,...(getSigoToken?{getSigoToken}:{}),...(sharedRpc?{sharedCommerce:createSharedCommerce({empresaId,rpc:sharedRpc,sourceMode:'sigo'})}:{})});
      portalRef.current=portal;logout=()=>portal?.destroy()??Promise.resolve();
    }).catch(()=>{if(!disposed)setError('No se pudo abrir Mayorista. Volvé a intentar.');});
    return()=>{disposed=true;portalRef.current=undefined;void logout?.().catch(()=>{});child.remove();};
  },[origin,empresaId,sharedRpc,getSigoToken]);
  useEffect(()=>{portalRef.current?.showPage(page);},[page]);
  return <section className="sigo-mayorista-workspace" aria-label="Mayorista / Distribuidora">{error&&<p role="alert">{error}</p>}<div ref={host}/></section>;
}
