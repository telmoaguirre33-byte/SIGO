import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { listarProductosSigo, type ProductoSigo } from "./productos";

type Venta = { id: string };
type Detalle = { producto_id: string; cantidad: number };
const PERIODO = 30;
const OBJETIVO = 15;
const formato = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });

export default function ComprasSugeridas({ empresaId }: { empresaId: string }) {
  const [productos, setProductos] = useState<ProductoSigo[]>([]);
  const [vendidos, setVendidos] = useState<Record<string, number>>({});
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [estado, setEstado] = useState("todos");
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [incompleto, setIncompleto] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      setCargando(true); setError(""); setIncompleto(false);
      try {
        const catalogo = await listarProductosSigo(empresaId);
        const desde = new Date(Date.now() - PERIODO * 86400000).toISOString();
        const ventas: Venta[] = [];
        let offset = 0;
        let limiteAlcanzado = false;
        for (let i = 0; i < 30; i++) {
          const { data, error: e } = await supabase.from("ventas_sigo")
            .select("id").eq("empresa_id", empresaId).eq("estado", "confirmada")
            .gte("created_at", desde).order("created_at", { ascending: false }).range(offset, offset + 999);
          if (e) throw e;
          const lote = (data ?? []) as Venta[];
          ventas.push(...lote);
          if (lote.length < 1000) break;
          offset += lote.length;
          if (i === 29) limiteAlcanzado = true;
        }
        const mapa: Record<string, number> = {};
        for (let i = 0; i < ventas.length; i += 100) {
          const ids = ventas.slice(i, i + 100).map(v => v.id);
          const { data, error: e } = await supabase.from("venta_items_sigo")
            .select("producto_id,cantidad").eq("empresa_id", empresaId).in("venta_id", ids);
          if (e) throw e;
          for (const item of (data ?? []) as Detalle[]) {
            mapa[item.producto_id] = (mapa[item.producto_id] ?? 0) + Number(item.cantidad || 0);
          }
        }
        if (activo) { setProductos(catalogo); setVendidos(mapa); setIncompleto(limiteAlcanzado); }
      } catch (e) { if (activo) setError(e instanceof Error ? e.message : "No se pudieron calcular las compras sugeridas."); }
      finally { if (activo) setCargando(false); }
    }
    void cargar();
    return () => { activo = false; };
  }, [empresaId, revision]);

  const categorias = useMemo(() => [...new Set(productos.map(p => p.categoria?.trim()).filter((x): x is string => Boolean(x)))].sort((a,b)=>a.localeCompare(b,"es")), [productos]);
  const filas = useMemo(() => productos.map(p => {
    const stock = Math.max(0, Number(p.stock_actual ?? 0));
    const promedio = (vendidos[p.id] ?? 0) / PERIODO;
    const dias = promedio > 0 ? stock / promedio : null;
    const comprar = promedio > 0 ? Math.max(0, Math.ceil(promedio * OBJETIVO - stock)) : 0;
    return { ...p, stock, promedio, dias, comprar };
  }).filter(p => {
    const q = busqueda.trim().toLocaleLowerCase("es");
    return (!q || [p.nombre,p.codigo_interno,p.codigo_barras,p.marca].some(x => x?.toLocaleLowerCase("es").includes(q)))
      && (!categoria || p.categoria === categoria)
      && (estado === "todos" || (estado === "urgentes" ? p.dias !== null && p.dias <= 3 : estado === "bien" ? p.dias !== null && p.dias > 3 : p.dias === null));
  }).sort((a,b) => (a.dias ?? Infinity) - (b.dias ?? Infinity) || a.nombre.localeCompare(b.nombre,"es")), [productos,vendidos,busqueda,categoria,estado]);
  const paginas = Math.max(1, Math.ceil(filas.length / 50));
  const actual = Math.min(pagina, paginas - 1);
  function exportar() {
    const cabecera = ["Producto","Código","Segmento","Stock","Días cobertura","Cantidad sugerida"];
    const csv = [cabecera,...filas.map(p => [p.nombre,p.codigo_barras || p.codigo_interno || "",p.categoria || "",p.stock,p.dias === null ? "Sin ventas" : formato(p.dias),p.comprar])]
      .map(row => row.map(x => '"' + String(x).replaceAll('"','""') + '"').join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFFsep=;\r\n" + csv], { type:"text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href=url; a.download="SIGO-compras-sugeridas.csv"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="products-page" style={{maxWidth:"100%",overflowX:"auto"}}>
    <div className="page-header"><div><h2>Compras sugeridas</h2><p>Reposición estimada con ventas confirmadas de los últimos 30 días. Objetivo: 15 días de cobertura.</p></div><button className="admin-button" onClick={()=>setRevision(n=>n+1)}>Actualizar</button></div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"12px 0"}}>
      <input aria-label="Buscar productos" placeholder="Buscar nombre o código" value={busqueda} onChange={e=>{setBusqueda(e.target.value);setPagina(0);}} style={{flex:"1 1 190px",minWidth:0}} />
      <select aria-label="Filtrar segmento" value={categoria} onChange={e=>{setCategoria(e.target.value);setPagina(0);}}><option value="">Todos los segmentos</option>{categorias.map(c=><option key={c} value={c}>{c}</option>)}</select>
      <select aria-label="Filtrar estado" value={estado} onChange={e=>{setEstado(e.target.value);setPagina(0);}}><option value="todos">Todos</option><option value="urgentes">🔴 Urgentes</option><option value="bien">🟢 Suficientes</option><option value="sinventas">Sin ventas recientes</option></select>
      <button className="admin-button" onClick={exportar} disabled={cargando || !!error}>Exportar Excel (CSV)</button>
    </div>
    {error && <p role="alert" style={{color:"#b91c1c"}}>{error}</p>}
    {incompleto && <p role="alert">Hay más de 30.000 ventas en el período. El cálculo es parcial: no confirmes pedidos basados en este resultado.</p>}
    {cargando ? <p>Cargando productos y ventas…</p> : !error && <>
      <p>{filas.length.toLocaleString("es-AR")} productos · Página {actual+1} de {paginas}</p>
      <div style={{overflowX:"auto",width:"100%"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr>{["Producto","Segmento","Stock","Días de stock","Comprar"].map(h=><th key={h} style={{textAlign:"left",padding:"9px 7px",borderBottom:"1px solid #cbd5e1"}}>{h}</th>)}</tr></thead>
        <tbody>{filas.slice(actual*50,(actual+1)*50).map(p=><tr key={p.id} style={{borderBottom:"1px solid #e2e8f0"}}>
          <td style={{padding:"8px 7px"}}><strong>{p.nombre}</strong><div style={{fontSize:11,opacity:.7}}>{p.codigo_barras || p.codigo_interno || "Sin código"}</div></td>
          <td style={{padding:7}}>{p.categoria || "Sin segmento"}</td>
          <td style={{padding:7}}>{formato(p.stock)}</td>
          <td style={{padding:7,fontWeight:700,color:p.dias === null ? "#64748b" : p.dias <= 3 ? "#dc2626" : "#15803d"}}>{p.dias === null ? "Sin ventas" : formato(p.dias)+" días"}</td>
          <td style={{padding:7,fontWeight:700}}>{p.comprar}</td>
        </tr>)}</tbody>
      </table></div>
      <div style={{display:"flex",gap:8,alignItems:"center",marginTop:12}}><button className="admin-button" disabled={actual===0} onClick={()=>setPagina(n=>Math.max(0,n-1))}>Anterior</button><span>{actual+1} / {paginas}</span><button className="admin-button" disabled={actual>=paginas-1} onClick={()=>setPagina(n=>n+1)}>Siguiente</button></div>
      <p style={{fontSize:12,opacity:.75}}>Rojo: hasta 3 días. Verde: más de 3 días. Sin ventas recientes: no se puede estimar cobertura. Este informe no modifica stock ni genera compras automáticamente.</p>
    </>}
  </div>;
}
