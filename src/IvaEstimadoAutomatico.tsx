import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type FilaFiscal = { iva: number | null; total: number | null; tipo_comprobante: string | null };
const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

export default function IvaEstimadoAutomatico({ empresaId, periodo }: { empresaId: string; periodo: string }) {
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
  return <section style={{ padding: 12, border: "1px solid #94a3b8", borderRadius: 8, marginBottom: 12 }}>
    <h4>Estimación automática del período</h4>
    <p><strong>IVA estimado a pagar: pendiente de información fiscal suficiente.</strong></p>
    {error ? <p role="alert">No se pudo verificar el IVA de compras: {error}</p> : datos ? <>
      <p>IVA informado en compras históricas: {pesos(datos.ivaCompras)} ({datos.comprobantes} comprobantes con importe IVA registrado).</p>
      <p>Compras sin IVA discriminado: {datos.sinDesglose}.</p>
    </> : <p>Consultando comprobantes…</p>}
    <p>No se puede calcular IVA neto a ingresar sin el débito fiscal de ventas, créditos computables validados y ajustes. Los importes de compras mostrados no se descuentan automáticamente hasta verificar su tratamiento fiscal.</p>
  </section>;
}
