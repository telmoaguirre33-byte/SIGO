import { useEffect, useMemo, useRef, useState } from "react";
import { cargarPortalClienteSigo, type PortalClienteProducto } from "./portalCliente";

const SEMAFORO_LABELS: Record<PortalClienteProducto["semaforo"], string> = {
  VERDE: "Cobertura saludable",
  AMARILLO: "Revisar reposición",
  ROJO: "Reposición prioritaria",
  SIN_DATOS: "Sin consumo estimado",
};

export default function PortalCliente({ empresaId }: { empresaId: string }) {
  const [productos, setProductos] = useState<PortalClienteProducto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const requestRef = useRef(0);

  async function cargar() {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const data = await cargarPortalClienteSigo(empresaId);
      if (requestId !== requestRef.current) return;
      setProductos(data);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setProductos([]);
      setError(err instanceof Error ? err.message : "No se pudo cargar el portal.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void cargar();
    return () => { requestRef.current += 1; };
  }, [empresaId]);

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((producto) => [producto.nombre, producto.marca, producto.categoria, producto.codigo_interno, producto.codigo_barras]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q));
  }, [productos, search]);

  return (
    <div className="products-page">
      <div className="page-header">
        <div>
          <h2>Portal Cliente</h2>
          <p>Información comercial publicada exclusivamente para tu cuenta. SIGO no expone costos, márgenes ni datos internos de la empresa.</p>
        </div>
        <button className="admin-button" onClick={() => void cargar()} disabled={loading}>Actualizar</button>
      </div>

      {error ? (
        <div className="panel" role="alert"><h3>Portal no disponible</h3><p>{error}</p></div>
      ) : (
        <>
          <div className="panel">
            <div className="product-tools">
              <input type="search" placeholder="Buscar producto, marca o código…" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <p>{loading ? "Actualizando información…" : `${productos.length} productos publicados para tu cuenta.`}</p>
          </div>

          <div className="panel">
            <div className="table-wrapper">
              <table className="products-table">
                <thead><tr><th>Producto</th><th>Stock publicado</th><th>Cobertura</th><th>Estado</th><th>Sugerencia</th></tr></thead>
                <tbody>
                  {filtrados.map((producto) => (
                    <tr key={producto.producto_id}>
                      <td><strong>{producto.nombre}</strong><small>{[producto.marca, producto.codigo_interno].filter(Boolean).join(" · ") || "Sin código"}</small></td>
                      <td>{producto.stock_comercial == null ? "Sin dato" : producto.stock_comercial.toLocaleString("es-AR")}</td>
                      <td>{producto.dias_cobertura == null ? "Sin dato" : `${producto.dias_cobertura.toLocaleString("es-AR")} días`}</td>
                      <td><strong>{SEMAFORO_LABELS[producto.semaforo]}</strong></td>
                      <td>{producto.sugerencia_compra > 0 ? `Sugerido ${producto.sugerencia_compra.toLocaleString("es-AR")}` : "Sin reposición sugerida"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && filtrados.length === 0 ? <div className="table-empty">No hay productos publicados para mostrar.</div> : null}
              {loading ? <div className="table-empty">Cargando portal…</div> : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
