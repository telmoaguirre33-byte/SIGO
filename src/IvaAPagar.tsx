import { useState } from "react";
import { calcularPosicionIva } from "./calculoIva";
import type { CompraSigo } from "./compras";
import type { ResumenIngresosDiariosSigo } from "./ingresosDiarios";

const pesos = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

export default function IvaAPagar({ compras, ventas }: { compras: CompraSigo[]; ventas: ResumenIngresosDiariosSigo | null }) {
  const [valores, setValores] = useState(["", "", "", "", "", "0"]);
  const [confirmado, setConfirmado] = useState(false);
  const campos = ["IVA débito fiscal verificado", "IVA crédito fiscal computable", "Retenciones computables", "Percepciones computables", "Saldo a favor anterior", "Otros ajustes (+/-)"];
  const completos = valores.slice(0, 5).every(v => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0);
  const calculo = completos ? (() => {
    try { return calcularPosicionIva({ debitoFiscal: Number(valores[0]), creditoFiscalComputable: Number(valores[1]), retencionesComputables: Number(valores[2]), percepcionesComputables: Number(valores[3]), saldoAFavorAnterior: Number(valores[4]), otrosAjustes: Number(valores[5]), conciliado: confirmado }); }
    catch { return null; }
  })() : null;
  const totalCompras = compras.reduce((sum, compra) => sum + Number(compra.total || 0), 0);
  return <section aria-label="IVA a pagar">
    <h3>¿Cuánto IVA tengo que pagar?</h3>
    <p><strong>Importe a ingresar: pendiente de determinar.</strong></p>
    <p>La tabla actual de comprobantes ARCA guarda CAE y referencias, pero no un desglose fiscal completo por alícuota. Por eso aún no se puede obtener un débito fiscal confiable automáticamente.</p>
    <p>SIGO registra {ventas?.cantidadVentas ?? 0} ventas por {pesos(ventas?.totalVentas ?? 0)} y {compras.length} compras por {pesos(totalCompras)} en el período seleccionado.</p>
    <p>Estos importes incluyen operaciones comerciales, pero no identifican por sí solos el IVA a ingresar.</p>
    <div style={{ padding: 12, border: "1px solid #a1a1aa", borderRadius: 8 }}>
      <h4>Simulador con importes fiscales verificados</h4>
      <p>Completá los valores de IVA Simple o los importes confirmados por tu contador. No uses totales de ventas o compras como IVA.</p>
      {campos.map((campo, i) => <label key={campo} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", marginBottom: 8 }}>
        <span>{campo}</span><input aria-label={campo} type="number" min={i === 5 ? undefined : "0"} step="0.01" value={valores[i]} onChange={e => { setConfirmado(false); setValores(prev => prev.map((v, j) => i === j ? e.target.value : v)); }} style={{ maxWidth: 160 }} />
      </label>)}
      <label style={{ display: "block", margin: "12px 0" }}><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} /> Confirmo que estos importes fiscales fueron revisados y corresponden al mismo período.</label>
      <p><strong>{calculo?.importeEstimado == null ? "Estimación: pendiente de datos verificados" : `IVA estimado a ingresar: ${pesos(calculo.importeEstimado)}`}</strong></p>
      {calculo?.saldoAFavorEstimado != null && calculo.saldoAFavorEstimado > 0 && <p>Saldo a favor estimado: {pesos(calculo.saldoAFavorEstimado)}</p>}
      <small>Simulación informativa, no declaración ni importe definitivo. No se guarda ni envía información.</small>
    </div>
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
