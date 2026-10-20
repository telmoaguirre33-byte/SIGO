import IvaAPagar from "./IvaAPagar";
import ConciliacionFiscal from "./ConciliacionFiscal";
import { useEffect, useState } from "react";
import { listarComprasSigo, type CompraSigo } from "./compras";
import { cargarIngresosDiariosSigo, type ResumenIngresosDiariosSigo } from "./ingresosDiarios";

type Tab = "IVA Compras" | "IVA Ventas" | "Resumen IVA" | "Gastos" | "Informes" | "Conciliación fiscal" | "IVA a pagar";
const tabs: Tab[] = ["IVA Compras", "IVA Ventas", "Resumen IVA", "Gastos", "Informes", "Conciliación fiscal", "IVA a pagar"];
const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

export default function Contabilidad({ empresaId }: { empresaId: string }) {
  const [tab, setTab] = useState<Tab>("Resumen IVA");
  const [periodo, setPeriodo] = useState(() => new Date().toLocaleDateString("en-CA").slice(0, 7));
  const [compras, setCompras] = useState<CompraSigo[]>([]);
  const [ventas, setVentas] = useState<ResumenIngresosDiariosSigo | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let activo = true;
    const desde = `${periodo}-01`;
    const [anio, mes] = periodo.split("-").map(Number);
    const hasta = new Date(anio, mes, 0).toLocaleDateString("en-CA");
    setCargando(true);
    setError("");
    void Promise.all([listarComprasSigo(empresaId), cargarIngresosDiariosSigo(empresaId, desde, hasta)])
      .then(([datosCompras, datosVentas]) => {
        if (!activo) return;
        setCompras(datosCompras.filter(c => c.fecha_compra.slice(0, 7) === periodo));
        setVentas(datosVentas);
      })
      .catch(e => { if (activo) { setCompras([]); setVentas(null); setError(e instanceof Error ? e.message : "No se pudieron consultar los movimientos."); } })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [empresaId, periodo]);
  const totalCompras = compras.reduce((s, c) => s + Number(c.total || 0), 0);
  return <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
    <h2>Contabilidad</h2>
    <p>Movimientos operativos de la empresa. Los importes NO constituyen libros IVA ni declaración jurada.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {tabs.map(t => <button type="button" key={t} aria-pressed={tab === t} onClick={() => setTab(t)} style={{ padding: "8px 10px", border: "1px solid #a1a1aa", borderRadius: 8, background: t === tab ? "#dbeafe" : "transparent", color: "inherit" }}>{t}</button>)}
    </div>
    <label style={{ display: "block", margin: "12px 0" }}>Período <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} /></label>
    {cargando ? <p>Consultando movimientos…</p> : error ? <p role="alert">{error}</p> : <section style={{ border: "1px solid #a1a1aa", borderRadius: 8, padding: 14 }}>
      <h3>{tab}</h3>
      {(tab === "IVA Compras" || tab === "Resumen IVA") && <p>Compras registradas: {compras.length} · Total comercial: {pesos(totalCompras)}</p>}
      {(tab === "IVA Ventas" || tab === "Resumen IVA") && <p>Ventas registradas: {ventas?.cantidadVentas ?? 0} · Total comercial: {pesos(ventas?.totalVentas ?? 0)}</p>}
      {tab === "IVA Compras" && <div style={{ overflowX: "auto" }}><table><thead><tr><th>Fecha</th><th>Comprobante</th><th>Total comercial</th></tr></thead><tbody>{compras.map(c => <tr key={c.id}><td>{c.fecha_compra}</td><td>{c.tipo_comprobante || "Sin tipo"} {c.numero_comprobante || ""}</td><td>{pesos(Number(c.total || 0))}</td></tr>)}</tbody></table></div>}
      {tab === "IVA a pagar" && <IvaAPagar compras={compras} ventas={ventas} />}
      {tab === "Conciliación fiscal" && <ConciliacionFiscal empresaId={empresaId} ventas={ventas} />}
      {tab === "IVA Ventas" && <p>Resumen operativo del período. Falta discriminar comprobantes fiscales y notas de crédito.</p>}
      {(tab === "Resumen IVA" || tab === "Informes" || tab === "Gastos") && <p>IVA débito, IVA crédito y saldo fiscal: pendientes de conciliación de comprobantes, alícuotas y condición tributaria. No se estiman aplicando 21% a los totales.</p>}
      <p><strong>Revisión fiscal pendiente:</strong> CUIT, tipo de comprobante, netos, alícuotas, exentos, notas de crédito y retenciones/percepciones.</p>
    </section>}
  </div>;
}
