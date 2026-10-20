import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { ResumenIngresosDiariosSigo } from "./ingresosDiarios";

type Comprobante = { venta_id: string | null; cae: string | null; tipo_cbte: number | null; numero_cbte: number | null };
const dinero = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

export default function ConciliacionFiscal({ empresaId, ventas }: { empresaId: string; ventas: ResumenIngresosDiariosSigo | null }) {
  const [emitidos, setEmitidos] = useState<Comprobante[]>([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let activo = true;
    setCargando(true);
    setError("");
    void (async () => {
      const { data, error: fallo } = await supabase.from("arca_comprobantes")
        .select("venta_id,cae,tipo_cbte,numero_cbte")
        .eq("empresa_id", empresaId)
        .not("cae", "is", null)
        .limit(1000);
      if (fallo) throw fallo;
      if (activo) setEmitidos((data ?? []) as Comprobante[]);
    })().catch(e => {
      if (activo) { setEmitidos([]); setError(e instanceof Error ? e.message : "No se pudieron consultar comprobantes."); }
    }).finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [empresaId]);
  const vinculados = new Set(emitidos.filter(c => c.venta_id).map(c => c.venta_id));
  return <section aria-label="Conciliación fiscal">
    <h3>Conciliación fiscal</h3>
    <p>Ventas comerciales del período: {ventas?.cantidadVentas ?? 0} · {dinero(ventas?.totalVentas ?? 0)}</p>
    {cargando ? <p>Consultando comprobantes ARCA…</p> : error ? <p role="alert">No se pudo conciliar: {error}</p> : <>
      <p>Comprobantes ARCA con CAE encontrados para la empresa: {emitidos.length}.</p>
      <p>Ventas vinculadas a comprobantes con CAE: {vinculados.size} (histórico consultado, no necesariamente del período seleccionado).</p>
      <p>Operaciones sin comprobante asociado: pendientes de cotejar venta por venta. No se deduce una diferencia fiscal de totales agregados.</p>
    </>}
    <p>Esta consulta es de solo lectura. No emite comprobantes, no cambia ventas ni stock y no determina IVA.</p>
  </section>;
}
