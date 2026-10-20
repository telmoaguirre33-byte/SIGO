import type { CompraSigo } from "./compras";
import type { ResumenIngresosDiariosSigo } from "./ingresosDiarios";

const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

export default function IvaAPagar({ compras, ventas }: { compras: CompraSigo[]; ventas: ResumenIngresosDiariosSigo | null }) {
  const totalCompras = compras.reduce((sum, compra) => sum + Number(compra.total || 0), 0);
  return <section aria-label="IVA a pagar">
    <h3>¿Cuánto IVA tengo que pagar?</h3>
    <p><strong>Importe a ingresar: pendiente de determinar.</strong></p>
    <p>La tabla actual de comprobantes ARCA guarda CAE y referencias, pero no un desglose fiscal completo por alícuota. Por eso aún no se puede obtener un débito fiscal confiable automáticamente.</p>
    <p>SIGO registra {ventas?.cantidadVentas ?? 0} ventas por {pesos(ventas?.totalVentas ?? 0)} y {compras.length} compras por {pesos(totalCompras)} en el período seleccionado.</p>
    <p>Estos importes incluyen operaciones comerciales, pero no identifican por sí solos el IVA a ingresar.</p>
    <h4>Para obtener el importe real</h4>
    <ol>
      <li>Conciliar las ventas con comprobantes fiscales y revisar operaciones pendientes de documentación.</li>
      <li>Identificar netos gravados, alícuotas y notas de crédito para calcular el IVA débito.</li>
      <li>Validar facturas de proveedores y créditos fiscales computables.</li>
      <li>Aplicar retenciones, percepciones, saldos a favor y otros ajustes según corresponda.</li>
      <li>Contrastar el resultado con ARCA / IVA Simple antes de presentar la declaración.</li>
    </ol>
    <p><strong>Importante:</strong> no se calcula IVA aplicando 21% al total vendido ni se excluyen ventas por no tener factura asociada.</p>
    <p>Esta pantalla es informativa, de solo lectura, y no presenta ni paga impuestos.</p>
  </section>;
}
