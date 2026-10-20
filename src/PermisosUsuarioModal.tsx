import { useMemo, useState } from "react";
import { can, type SigoPermission } from "./permissions";
import { actualizarPermisosUsuarioEmpresaSigo, type UsuarioEmpresaSigo } from "./usuarios";

type DefPermiso = {
  permiso: SigoPermission;
  titulo: string;
  detalle: string;
  grupo: "sensible" | "operacion" | "administracion";
  soloRevocar?: boolean;
};

const PERMISOS: DefPermiso[] = [
  { permiso: "costs.read", titulo: "Ver costos / precios de compra", detalle: "Costo actual y costo de última compra de productos.", grupo: "sensible" },
  { permiso: "margins.read", titulo: "Ver márgenes y rentabilidad", detalle: "Ganancia y porcentaje de margen.", grupo: "sensible" },
  { permiso: "price_lists.read", titulo: "Ver listas de precios", detalle: "Acceso comercial amplio a precios. Una venta puede seguir mostrando el precio necesario para cobrar.", grupo: "sensible" },
  { permiso: "reports.read", titulo: "Ver informes gerenciales", detalle: "Indicadores consolidados del negocio.", grupo: "sensible" },
  { permiso: "arca.configure", titulo: "Configurar ARCA", detalle: "Configuración fiscal de la empresa. Otorgar sólo a personal de máxima confianza.", grupo: "sensible" },

  { permiso: "products.read", titulo: "Ver productos", detalle: "Consultar catálogo de productos.", grupo: "operacion" },
  { permiso: "products.write", titulo: "Editar productos", detalle: "Alta y modificación del maestro de productos.", grupo: "operacion" },
  { permiso: "stock.read", titulo: "Ver stock", detalle: "Consultar existencias y mínimos/máximos.", grupo: "operacion" },
  { permiso: "stock.write", titulo: "Modificar stock", detalle: "Permite operaciones que cambian existencias.", grupo: "operacion" },
  { permiso: "sales.read", titulo: "Ver ventas", detalle: "Consultar historial y detalle de ventas.", grupo: "operacion" },
  { permiso: "sales.write", titulo: "Realizar ventas", detalle: "Usar carrito, confirmar ventas, devoluciones y anulaciones autorizadas.", grupo: "operacion" },
  { permiso: "purchases.read", titulo: "Ver compras", detalle: "Las compras contienen importes y costos de adquisición.", grupo: "operacion" },
  { permiso: "purchases.write", titulo: "Registrar compras", detalle: "Cargar facturas/compras y actualizar stock/costos.", grupo: "operacion" },
  { permiso: "clients.read", titulo: "Ver clientes / cuentas", detalle: "Consultar clientes y saldos.", grupo: "operacion" },
  { permiso: "clients.write", titulo: "Editar clientes / cobrar", detalle: "Modificar clientes y registrar operaciones autorizadas.", grupo: "operacion" },
  { permiso: "suppliers.read", titulo: "Ver proveedores", detalle: "Consultar proveedores.", grupo: "operacion" },
  { permiso: "suppliers.write", titulo: "Editar proveedores", detalle: "Alta y modificación de proveedores.", grupo: "operacion" },
  { permiso: "invoices.issue", titulo: "Emitir comprobantes", detalle: "Facturación/CAE cuando ARCA esté configurado.", grupo: "operacion" },

  { permiso: "users.manage", titulo: "Administrar usuarios", detalle: "En Administrador viene por rol; el Propietario puede revocarlo. No se puede otorgar por excepción a otros roles.", grupo: "administracion", soloRevocar: true },
];

const DEPENDENCIAS_WRITE: Partial<Record<SigoPermission, SigoPermission>> = {
  "products.write": "products.read",
  "stock.write": "stock.read",
  "sales.write": "sales.read",
  "purchases.write": "purchases.read",
  "clients.write": "clients.read",
  "suppliers.write": "suppliers.read",
};

function rolNombre(rol: UsuarioEmpresaSigo["rol"]) {
  return ({ owner: "Propietario", admin: "Administrador", seller: "Vendedor", warehouse: "Depósito", client: "Cliente", superadmin: "Superadmin" } as Record<string, string>)[rol] ?? rol;
}

export default function PermisosUsuarioModal({
  empresaId,
  usuario,
  onClose,
  onSaved,
}: {
  empresaId: string;
  usuario: UsuarioEmpresaSigo;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [extra, setExtra] = useState<SigoPermission[]>(usuario.permisos_extra);
  const [denegados, setDenegados] = useState<SigoPermission[]>(usuario.permisos_denegados);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const efectivos = useMemo(() => {
    const mapa = new Map<SigoPermission, boolean>();
    for (const def of PERMISOS) mapa.set(def.permiso, can(usuario.rol, def.permiso, extra, denegados));
    return mapa;
  }, [usuario.rol, extra, denegados]);

  function aplicarUno(permiso: SigoPermission, habilitado: boolean) {
    const base = can(usuario.rol, permiso);
    setExtra((actual) => {
      const next = new Set(actual);
      if (habilitado && !base) next.add(permiso);
      else next.delete(permiso);
      return [...next];
    });
    setDenegados((actual) => {
      const next = new Set(actual);
      if (!habilitado && base) next.add(permiso);
      else next.delete(permiso);
      return [...next];
    });
  }

  function cambiar(permiso: SigoPermission, habilitado: boolean) {
    const def = PERMISOS.find((item) => item.permiso === permiso);
    const base = can(usuario.rol, permiso);
    if (habilitado && def?.soloRevocar && !base) return;

    aplicarUno(permiso, habilitado);

    const lectura = DEPENDENCIAS_WRITE[permiso];
    if (habilitado && lectura) aplicarUno(lectura, true);

    if (!habilitado) {
      for (const [write, read] of Object.entries(DEPENDENCIAS_WRITE) as Array<[SigoPermission, SigoPermission]>) {
        if (read === permiso) aplicarUno(write, false);
      }
    }
  }

  function ocultarDatosSensibles() {
    for (const permiso of ["costs.read", "margins.read", "price_lists.read"] as SigoPermission[]) aplicarUno(permiso, false);
    // Compras revela costos de adquisición por naturaleza. Se bloquea también para garantizar ocultamiento completo.
    aplicarUno("purchases.read", false);
    aplicarUno("purchases.write", false);
  }

  function restablecerRol() {
    setExtra([]);
    setDenegados([]);
  }

  async function guardar() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await actualizarPermisosUsuarioEmpresaSigo(empresaId, usuario.membresia_id, extra, denegados);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los permisos.");
    } finally {
      setSaving(false);
    }
  }

  const grupos = [
    ["sensible", "Información sensible", "Costos, márgenes, informes y configuración fiscal."],
    ["operacion", "Operación", "Qué módulos puede consultar o modificar."],
    ["administracion", "Administración", "Permisos de gestión del equipo."],
  ] as const;

  return (
    <div className="modal-backdrop sigo-permission-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="modal sigo-permission-modal" role="dialog" aria-modal="true" aria-labelledby="permisos-title">
        <div className="page-header modal-header">
          <div>
            <h2 id="permisos-title">Permisos de {usuario.email || "usuario"}</h2>
            <p>{rolNombre(usuario.rol)} · Las restricciones se aplican también en backend, no sólo en pantalla.</p>
          </div>
          <button className="admin-button" type="button" onClick={onClose} disabled={saving}>Cerrar</button>
        </div>

        <div className="sigo-permission-presets">
          <button className="admin-button" type="button" onClick={ocultarDatosSensibles} disabled={saving}>Ocultar costos y rentabilidad</button>
          <button className="admin-button" type="button" onClick={restablecerRol} disabled={saving}>Restablecer permisos del rol</button>
        </div>

        {!efectivos.get("costs.read") && efectivos.get("purchases.read") ? (
          <div className="sigo-permission-warning" role="alert">
            <strong>Atención:</strong> este usuario no tiene permiso general de costos, pero todavía puede ver Compras. Las compras contienen costos de adquisición. Desactivá “Ver compras” para ocultarlos completamente.
          </div>
        ) : null}

        <div className="sigo-permission-groups">
          {grupos.map(([grupo, titulo, detalle]) => (
            <section className="sigo-permission-group" key={grupo}>
              <div><h3>{titulo}</h3><p>{detalle}</p></div>
              <div className="sigo-permission-list">
                {PERMISOS.filter((item) => item.grupo === grupo).map((item) => {
                  const base = can(usuario.rol, item.permiso);
                  const habilitado = efectivos.get(item.permiso) ?? false;
                  const grantBloqueado = Boolean(item.soloRevocar && !base);
                  return (
                    <label className={`sigo-permission-row${grantBloqueado ? " disabled" : ""}`} key={item.permiso}>
                      <span>
                        <strong>{item.titulo}</strong>
                        <small>{item.detalle}</small>
                        <em>{base ? "Incluido por rol" : extra.includes(item.permiso) ? "Otorgado especialmente" : denegados.includes(item.permiso) ? "Revocado por el propietario" : "No incluido"}</em>
                      </span>
                      <input
                        type="checkbox"
                        checked={habilitado}
                        disabled={saving || grantBloqueado || usuario.rol === "client"}
                        onChange={(event) => cambiar(item.permiso, event.target.checked)}
                        aria-label={`${item.titulo}: ${habilitado ? "habilitado" : "deshabilitado"}`}
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {usuario.rol === "client" ? <p className="sigo-permission-warning">El rol Cliente permanece limitado al Portal Cliente. Para darle funciones internas, cambiale primero el rol.</p> : null}
        {error ? <p className="sigo-onboarding-error" role="alert">{error}</p> : null}

        <div className="form-actions sigo-permission-actions">
          <button className="admin-button" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="primary-button" type="button" onClick={() => void guardar()} disabled={saving}>{saving ? "Guardando permisos…" : "Guardar permisos"}</button>
        </div>
      </div>
    </div>
  );
}
