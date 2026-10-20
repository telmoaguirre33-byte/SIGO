import { useState } from "react";

type Tab = "IVA Compras" | "IVA Ventas" | "Resumen IVA" | "Gastos" | "Informes";
const tabs: Tab[] = ["IVA Compras", "IVA Ventas", "Resumen IVA", "Gastos", "Informes"];

export default function Contabilidad({ empresaId }: { empresaId: string }) {
  const [tab, setTab] = useState<Tab>("Resumen IVA");
  const [periodo, setPeriodo] = useState(new Date().toISOString().slice(0, 7));
  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 4px" }}>Contabilidad</h2>
      <p style={{ marginTop: 0, opacity: .75 }}>Libros IVA y control impositivo · Empresa {empresaId.slice(0, 8)}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {tabs.map(item => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)}
          style={{ padding: "7px 11px", borderRadius: 7, border: "1px solid #a1a1aa", background: tab === item ? "#dbeafe" : "transparent", color: "inherit", cursor: "pointer" }}>{item}</button>)}
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>Período
        <input type="month" value={periodo} onChange={event => setPeriodo(event.target.value)} />
      </label>
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #a1a1aa", borderRadius: 9 }}>
        <h3>{tab}</h3>
        <p>La integración fiscal está en preparación. Aún no hay comprobantes conciliados para este módulo.</p>
        <p>Los importes no se calculan hasta validar los comprobantes, alícuotas, condición tributaria y permisos de cada empresa.</p>
      </section>
    </div>
  );
}
