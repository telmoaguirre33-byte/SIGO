import { useMemo } from "react";
import type { ResumenIngresosDiariosSigo } from "./ingresosDiarios";

const dinero = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

export default function ConciliacionFiscal({ ventas }: { ventas: ResumenIngresosDiariosSigo | null }) {
  const cantidad = useMemo(() => ventas?.cantidadVentas ?? 0, [ventas]);
  return <section aria-label="Conciliación fiscal">
    <h3>Conciliación fiscal</h3>
    <p>Ventas comerciales registradas: {cantidad} · {dinero(ventas?.totalVentas ?? 0)}</p>
    <p>Comprobantes fiscales conciliados: pendiente de vinculación con ARCA.</p>
    <p>Para clasificar operaciones se deben verificar tipo y número de comprobante, CAE, fecha, importe y notas de crédito.</p>
    <p>No se determina automáticamente qué operaciones están documentadas ni se calcula IVA sin esos datos.</p>
  </section>;
}
