import {useEffect, useId, useState} from "react";
import {mayoristaPages} from './navigation.mjs';
import MayoristaWorkspace from './MayoristaWorkspace';
import {resolveMayoristaAccess, type CompanyAccessConfig} from "./access-policy";

type Props = {
  empresaId: string;
  rol: string;
  getSigoToken?:()=>Promise<string>;
  sharedRpc?: (name:string,args:Record<string,unknown>)=>Promise<any>;
  // Future isolated, authenticated feature API. Absent provider means disabled, with zero requests.
  obtenerConfig?: (empresaId: string, signal: AbortSignal) => Promise<CompanyAccessConfig | null>;
};
export default function MayoristaAdministrarAccess({empresaId, rol, obtenerConfig, sharedRpc,getSigoToken}: Props) {
  const [config, setConfig] = useState<CompanyAccessConfig | null>(null);
  const [status, setStatus] = useState("");
  const [page,setPage]=useState('panel');
  const [expanded, setExpanded] = useState(false);
  const descriptionId = useId();
  useEffect(() => {
    const controller = new AbortController();
    setConfig(null); setStatus(""); setExpanded(false);
    if (obtenerConfig && ["owner", "admin"].includes(rol)) {
      obtenerConfig(empresaId, controller.signal)
        .then(value => {if (!controller.signal.aborted) setConfig(value);})
        .catch(() => {if (!controller.signal.aborted) setStatus("No se pudo verificar el acceso a Mayorista.");});
    }
    return () => controller.abort();
  }, [empresaId, rol, obtenerConfig]);
  const decision = resolveMayoristaAccess({empresaId, rol}, obtenerConfig ? config : null);
  if(!decision.enabled)return null;
  return <section className="panel" aria-label="Mayorista / Distribuidora">
    <h3>Mayorista / Distribuidora</h3>
    <p id={descriptionId}>{status || decision.reason}</p>
    <nav aria-label="Secciones Mayorista" className="mayorista-access-grid">{mayoristaPages.map(item=><button key={item.id} type="button" className="admin-button" aria-pressed={expanded&&page===item.id} onClick={()=>{setPage(item.id);setExpanded(true);}}>{item.label}</button>)}</nav>
    {expanded && decision.enabled ? <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:12}}>
      <MayoristaWorkspace origin={config!.origenAprobado} empresaId={empresaId} page={page} sharedRpc={sharedRpc} getSigoToken={getSigoToken}/>
      <a className="admin-button" href={decision.sellerUrl} target="_blank" rel="noopener noreferrer">App Vendedor</a>
    </div> : null}
  </section>;
}
