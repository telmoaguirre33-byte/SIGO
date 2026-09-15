import ArcaPreflight from "./ArcaPreflight";
import ModulosControlPanel from "./ModulosControlPanel";
import type { EmpresaOperativa } from "./tenant";
import { etiquetaRol } from "./workspacePermissions";

export default function ConfiguracionOperativa({ empresa }: { empresa: EmpresaOperativa }) {
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
