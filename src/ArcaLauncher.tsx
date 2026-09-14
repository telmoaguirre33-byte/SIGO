import { useCallback, useEffect, useState } from "react";
import ArcaEmisionVendedor from "./ArcaEmisionVendedor";
import ArcaFacturacion from "./ArcaFacturacion";
import { cargarMisEmpresas, leerEmpresaActivaGuardada, type EmpresaOperativa } from "./tenant";
import { supabase } from "./supabase";

export default function ArcaLauncher() {
  const [empresa, setEmpresa] = useState<EmpresaOperativa | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaOperativa[]>([]);
  const [productosPorEmpresa, setProductosPorEmpresa] = useState<Record<string, number | null>>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const resolverEmpresa = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        setEmpresa(null);
        return null;
      }
      const disponibles = (await cargarMisEmpresas()).filter((item) => ["owner", "admin", "seller"].includes(item.rol));
      const preferida = leerEmpresaActivaGuardada(user.id);
      const activaAnterior = empresa?.empresa_id;
      const activa = disponibles.find((item) => item.empresa_id === activaAnterior)
        ?? disponibles.find((item) => item.empresa_id === preferida)
        ?? disponibles[0]
        ?? null;
      if (!activa) {
        setEmpresas([]);
        setEmpresa(null);
        return null;
      }
      setEmpresas(disponibles);
      setEmpresa(activa);
      void Promise.all(disponibles.map(async (item) => {
        const { count, error } = await supabase
          .from("productos")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", item.empresa_id)
          .eq("activo", true);
        return [item.empresa_id, error ? null : count ?? 0] as const;
      })).then((pares) => setProductosPorEmpresa(Object.fromEntries(pares)));
      return activa;
    } catch (error) {
      console.warn("No se pudo resolver empresa para Facturación ARCA", error);
      setEmpresa(null);
      return null;
    }
  }, [empresa?.empresa_id]);

  useEffect(() => {
    void resolverEmpresa();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void resolverEmpresa();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [resolverEmpresa]);

  async function abrir() {
    setLoading(true);
    const activa = await resolverEmpresa();
    setLoading(false);
    if (activa) setOpen(true);
  }

  if (!empresa) return null;
  const esVendedor = empresa.rol === "seller";

  return (
    <>
      <button className="arca-launcher" type="button" onClick={() => void abrir()} disabled={loading} aria-label="Abrir Facturación ARCA">
        <span className="arca-launcher-icon" aria-hidden="true">A</span>
        <span><strong>ARCA</strong><small>{esVendedor ? "Emitir" : "Facturar"}</small></span>
      </button>

      {open && empresa ? (
        <div className="arca-overlay" role="dialog" aria-modal="true" aria-label="Facturación ARCA">
          <div className="arca-overlay-topbar">
            <button type="button" className="admin-button" onClick={() => setOpen(false)}>← Volver</button>
            <div>
              <strong>Facturación ARCA</strong>
              <small>{esVendedor ? "Perfil Vendedor: sólo emisión de comprobantes." : "Elegí la misma empresa donde están los productos y las ventas."}</small>
            </div>
            <label className="form-group arca-company-picker">
              <span>Empresa que va a facturar</span>
              <select
                value={empresa.empresa_id}
                onChange={(event) => {
                  const siguiente = empresas.find((item) => item.empresa_id === event.target.value) ?? null;
                  if (siguiente) setEmpresa(siguiente);
                }}
              >
                {empresas.map((item) => (
                  <option key={item.empresa_id} value={item.empresa_id}>
                    {item.empresa_nombre}{productosPorEmpresa[item.empresa_id] != null ? ` · ${productosPorEmpresa[item.empresa_id]} productos` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <main className="arca-overlay-content">
            {esVendedor ? (
              <ArcaEmisionVendedor
                key={empresa.empresa_id}
                empresaId={empresa.empresa_id}
                empresaNombre={empresa.empresa_nombre}
              />
            ) : (
              <ArcaFacturacion
                key={empresa.empresa_id}
                empresaId={empresa.empresa_id}
                empresaNombre={empresa.empresa_nombre}
                empresas={empresas.filter((item) => ["owner", "admin"].includes(item.rol))}
                productosCount={productosPorEmpresa[empresa.empresa_id] ?? null}
              />
            )}
          </main>
        </div>
      ) : null}
    </>
  );
}
