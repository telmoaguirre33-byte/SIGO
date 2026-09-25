import ArcaPreflight from "./ArcaPreflight";
import ModulosControlPanel from "./ModulosControlPanel";
import type { EmpresaOperativa } from "./tenant";
import { etiquetaRol } from "./workspacePermissions";

export default function ConfiguracionOperativa({ empresa }: { empresa: EmpresaOperativa }) {
  const [nombreTicket,setNombreTicket]=useState(empresa.empresa_nombre);
  const [direccionTicket,setDireccionTicket]=useState("");
  const [logoTicket,setLogoTicket]=useState<string|null>(null);
  const [mensajeTicket,setMensajeTicket]=useState("");
  useEffect(()=>{let activo=true;void leerConfigTicket(empresa.empresa_id).then(config=>{if(!activo)return;setNombreTicket(config?.nombre_negocio||empresa.empresa_nombre);setDireccionTicket(config?.direccion||"");setLogoTicket(config?.logo_data_url||null);}).catch(err=>{if(activo)setMensajeTicket(err instanceof Error?err.message:"No se pudo cargar el ticket.");});return()=>{activo=false;};},[empresa.empresa_id,empresa.empresa_nombre]);
  async function cargarLogo(file?:File){if(!file)return;if(!file.type.startsWith("image/")||file.size>100_000){setMensajeTicket("Elegí una imagen JPG o PNG menor a 100 KB.");return;}const reader=new FileReader();reader.onload=()=>setLogoTicket(String(reader.result));reader.readAsDataURL(file);}
  return (
    <div className="products-page sigo-settings-page">
      <div className="page-header">
        <div>
          <h2>Configuración</h2>
          <p>Parámetros generales, módulos, control fiscal y estado operativo de la empresa activa.</p>
        </div>
      </div>

      <section className="panel">
        <div className="sigo-detail-title"><span>⚙</span><h3>Empresa activa</h3></div>
        <div className="stats-grid">
          <div className="stat-card">
            <span>Empresa</span>
            <strong>{empresa.empresa_nombre}</strong>
            <small>Contexto de datos actualmente seleccionado</small>
          </div>
          <div className="stat-card">
            <span>Perfil</span>
            <strong>{etiquetaRol(empresa.rol)}</strong>
            <small>Los permisos se aplican por empresa y usuario</small>
          </div>
        </div>
      </section>

      <ModulosControlPanel empresa={empresa} />

      <section className="panel">
        <h3>Ticket de venta</h3>
        <p>Se imprime para consumidor final como comprobante no fiscal. Para facturar con ARCA, usá el módulo ARCA.</p>
        <div className="form-grid"><div className="form-group"><label>Nombre del negocio</label><input maxLength={120} value={nombreTicket} onChange={e=>setNombreTicket(e.target.value)}/></div><div className="form-group"><label>Dirección</label><input maxLength={240} value={direccionTicket} onChange={e=>setDireccionTicket(e.target.value)}/></div><div className="form-group"><label>Logo o foto del negocio</label><input type="file" accept="image/png,image/jpeg" onChange={e=>void cargarLogo(e.target.files?.[0])}/></div></div>
        {logoTicket&&<img src={logoTicket} alt="Vista previa del logo" style={{maxWidth:160,maxHeight:100,objectFit:"contain"}}/>}
        <div className="form-actions"><button type="button" className="primary-button" onClick={()=>{setMensajeTicket("Guardando…");void guardarConfigTicket({empresa_id:empresa.empresa_id,nombre_negocio:nombreTicket.trim(),direccion:direccionTicket.trim(),logo_data_url:logoTicket}).then(()=>setMensajeTicket("Configuración del ticket guardada.")).catch(err=>setMensajeTicket(err instanceof Error?err.message:"No se pudo guardar."));}}>Guardar configuración del ticket</button></div>
        {mensajeTicket&&<p role="status">{mensajeTicket}</p>}
      </section>

      <section className="panel">
        <div className="sigo-detail-title"><span>◫</span><h3>Control de stock</h3></div>
        <p className="sigo-stock-risk-note">
          SIGO usa ventas confirmadas para proyectar cobertura. La configuración operativa actual marca quiebre urgente hasta 7 días, próximo quiebre hasta 15 días y objetivo de reposición a 30 días.
        </p>
        <div className="stats-grid">
          <div className="stat-card"><span>Urgente</span><strong>≤ 7 días</strong><small>Prioridad máxima de reposición</small></div>
          <div className="stat-card"><span>Próximo quiebre</span><strong>≤ 15 días</strong><small>Planificar compra</small></div>
          <div className="stat-card"><span>Cobertura objetivo</span><strong>30 días</strong><small>Base para compra sugerida</small></div>
        </div>
      </section>

      <section className="panel">
        <div className="sigo-detail-title"><span>AF</span><h3>Facturación electrónica · ARCA</h3></div>
        <p>Desde acá podés verificar si la empresa está técnicamente preparada para facturar antes de intentar una emisión real.</p>
        <ArcaPreflight empresaId={empresa.empresa_id} />
      </section>

      <section className="panel">
        <div className="sigo-detail-title"><span>✓</span><h3>Seguridad operativa</h3></div>
        <p>
          SIGO mantiene los datos separados por empresa activa. Los cambios de productos, ventas, compras, clientes y usuarios se validan también en backend según el rol del usuario.
        </p>
      </section>
    </div>
  );
}
import { useEffect, useState } from "react";
import { guardarConfigTicket, leerConfigTicket } from "./ticketVenta";
