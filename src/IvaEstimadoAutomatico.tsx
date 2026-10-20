import type { CompraSigo } from "./compras";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type FilaFiscal = { iva: number | null; total: number | null; tipo_comprobante: string | null };
const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

export default function IvaEstimadoAutomatico({ empresaId, periodo, compras, totalVentas }: { empresaId: string; periodo: string; compras: CompraSigo[]; totalVentas: number }) {
  const [datos, setDatos] = useState<{ ivaCompras: number; comprobantes: number; sinDesglose: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let activo = true;
    setDatos(null);
    setError("");
    const desde = periodo + "-01";
    const [anio, mes] = periodo.split("-").map(Number);
    const hasta = new Date(anio, mes, 0).toISOString().slice(0, 10);
    void (async () => {
      // Legacy fiscal purchase invoices only; operational purchases are not automatically tax credits.
      const { data, error: fallo } = await supabase.from("compras")
        .select("iva,total,tipo_comprobante")
        .eq("empresa_id", empresaId)
        .gte("fecha_compra", desde)
        .lte("fecha_compra", hasta + "T23:59:59")
        .limit(1000);
      if (fallo) throw fallo;
      const filas = (data ?? []) as FilaFiscal[];
      const validas = filas.filter(f => f.iva != null && Number.isFinite(Number(f.iva)) && Number(f.iva) >= 0);
      if (activo) setDatos({
        ivaCompras: validas.reduce((s, f) => s + Number(f.iva), 0),
        comprobantes: validas.length,
        sinDesglose: filas.length - validas.length,
      });
    })().catch(e => { if (activo) setError(e instanceof Error ? e.message : "No se pudo consultar el IVA registrado."); });
    return () => { activo = false; };
  }, [empresaId, periodo]);
  const comprasActuales = compras.filter(c => c.fecha_compra.slice(0, 7) === periodo);
  const totalActual = comprasActuales.reduce((n, c) => n + Number(c.total || 0), 0);
  // A separate illustrative scenario, never a fiscal determination.
  const venta21 = Number.isFinite(totalVentas) && totalVentas >= 0 ? totalVentas * 21 / 121 : null;
  const compra21 = Number.isFinite(totalActual) && totalActual >= 0 ? totalActual * 21 / 121 : null;
  const escenario = venta21 !== null && compra21 !== null ? Math.max(0, venta21 - compra21) : null;
  return <section style={{ padding: 12, border: "1px solid #94a3b8", borderRadius: 8, marginBottom: 12 }}>
    <h4>Estimación automática del período</h4>
    <p><strong>IVA fiscal a ingresar: pendiente de información suficiente.</strong></p>
    <div style={{ background: "#fff7ed", border: "1px solid #f59e0b", padding: 12, borderRadius: 8, color: "#78350f" }}>
      <strong>Proyección orientativa (NO es el IVA a pagar): {escenario === null ? "sin datos" : pesos(escenario)}</strong>
      <p>Escenario hipotético: todas las ventas y compras incluyen IVA del 21%, todo el IVA de compras sería computable y no hay saldos, retenciones ni percepciones. Estas condiciones NO están verificadas y pueden cambiar mucho el resultado.</p>
      <small>No utilizar esta cifra para declarar, pagar impuestos ni decidir cuánto reservar sin revisión del contador.</small>
    </div>
    <p>Compras actuales de SIGO: {comprasActuales.length} por {pesos(totalActual)}. No se confunden con compras fiscales históricas.</p>
    {error ? <p role="alert">No se pudo verificar el IVA de compras: {error}</p> : datos ? <>
      <p>IVA discriminado en compras históricas: {pesos(datos.ivaCompras)} ({datos.comprobantes} comprobantes con importe IVA registrado).</p>
      <p>Compras sin IVA discriminado: {datos.sinDesglose}.</p>
    </> : <p>Consultando comprobantes…</p>}
    <p>Las compras actuales de SIGO no registran un desglose de IVA por alícuota: no se les atribuye crédito fiscal automáticamente.</p>
    <p>No se puede calcular IVA neto a ingresar sin el débito fiscal de ventas, créditos computables validados y ajustes. Los importes de compras mostrados no se descuentan automáticamente hasta verificar su tratamiento fiscal.</p>
  </section>;
}
