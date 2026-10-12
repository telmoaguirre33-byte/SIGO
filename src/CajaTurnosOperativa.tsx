import { useCallback, useEffect, useMemo, useState } from "react";
import {
  abrirTurnoCajaSigo, ajustarEfectivoCajaSigo, cerrarTurnoCajaSigo,
  listarMovimientosTurnoSigo, listarTurnosSigo, obtenerTurnoAbiertoSigo,
  type CajaMovimientoSigo, type CajaTurnoSigo,
} from "./cajaTurnos";
import { descargarTablaExcel } from "./excelProductos";
import { supabase } from "./supabase";

const CAJA_ID = "principal";
const dinero = (valor: number | string | null | undefined) => `$ ${Number(valor || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (valor: string | null | undefined) => valor ? new Date(valor).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Cordoba" }) : "—";
const clave = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function numeroARS(valor: string) {
  const limpio = valor.trim().replace(/\s/g, "");
  if (!limpio) return NaN;
  const normalizado = limpio.includes(",")
    ? limpio.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(limpio) ? limpio.replace(/\./g, "") : limpio;
  return Number(normalizado);
}

export default function CajaTurnosOperativa({ empresaId, puedeOperar }: { empresaId: string; puedeOperar: boolean }) {
  const [turno, setTurno] = useState<CajaTurnoSigo | null>(null);
  const [historial, setHistorial] = useState<CajaTurnoSigo[]>([]);
  const [movimientos, setMovimientos] = useState<CajaMovimientoSigo[]>([]);
  const [turnoDetalleId, setTurnoDetalleId] = useState("");
  const [movimientosHistorial, setMovimientosHistorial] = useState<CajaMovimientoSigo[]>([]);
  const [fondo, setFondo] = useState("");
  const [contado, setContado] = useState("");
  const [motivoDiferencia, setMotivoDiferencia] = useState("");
  const [importeAjuste, setImporteAjuste] = useState("");
  const [motivoAjuste, setMotivoAjuste] = useState("");
  const [tipoAjuste, setTipoAjuste] = useState<"ingreso" | "retiro">("ingreso");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [responsable, setResponsable] = useState("");
  const [seccion, setSeccion] = useState<"apertura" | "ajuste" | "cierre">("apertura");
  const [claveApertura, setClaveApertura] = useState(clave);
  const [claveAjuste, setClaveAjuste] = useState(clave);
  const [claveCierre, setClaveCierre] = useState(clave);

  const recargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [actual, lista] = await Promise.all([
        obtenerTurnoAbiertoSigo(empresaId, CAJA_ID), listarTurnosSigo(empresaId),
      ]);
      setTurno(actual);
      setHistorial(lista);
      setMovimientos(actual ? await listarMovimientosTurnoSigo(empresaId, actual.id) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el estado de caja.");
    } finally { setCargando(false); }
  }, [empresaId]);

  useEffect(() => {
    void recargar();
    void supabase.auth.getUser().then(({ data }) => setResponsable(data.user?.email || data.user?.id || "Usuario activo"));
  }, [recargar]);

  const resumen = useMemo(() => {
    const porMedio = new Map<string, number>();
    for (const mov of movimientos) {
      const signo = mov.tipo === "egreso" ? -1 : 1;
      porMedio.set(mov.medio_pago, (porMedio.get(mov.medio_pago) ?? 0) + signo * Number(mov.importe || 0));
    }
    const efectivoMovimientos = movimientos.filter((m) => m.medio_pago === "efectivo")
      .reduce((total, m) => total + (m.tipo === "egreso" ? -1 : 1) * Number(m.importe || 0), 0);
    return { porMedio, esperado: Number(turno?.fondo_inicial || 0) + efectivoMovimientos };
  }, [movimientos, turno]);

  async function abrir() {
    const monto = numeroARS(fondo);
    if (!Number.isFinite(monto) || monto < 0) { setError("Ingresá un fondo inicial válido."); return; }
    setOcupado(true); setError(""); setExito("");
    try {
      await abrirTurnoCajaSigo(empresaId, monto, claveApertura, CAJA_ID);
      setFondo(""); setClaveApertura(clave()); setExito("Caja abierta correctamente."); await recargar();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo abrir la caja."); }
    finally { setOcupado(false); }
  }

  async function ajustar() {
    if (!turno) return;
    const monto = numeroARS(importeAjuste);
    if (!Number.isFinite(monto) || monto <= 0) { setError("Ingresá un importe mayor a cero."); return; }
    if (motivoAjuste.trim().length < 3) { setError("Describí el motivo del movimiento."); return; }
    setOcupado(true); setError(""); setExito("");
    try {
      await ajustarEfectivoCajaSigo({ empresaId, turnoId: turno.id, tipo: tipoAjuste, importe: monto, motivo: motivoAjuste.trim(), claveIdempotencia: claveAjuste });
      setImporteAjuste(""); setMotivoAjuste(""); setClaveAjuste(clave()); setExito(tipoAjuste === "ingreso" ? "Ingreso de efectivo registrado." : "Retiro de efectivo registrado."); await recargar();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo registrar el movimiento."); }
    finally { setOcupado(false); }
  }

  async function cerrar() {
    if (!turno) return;
    const monto = numeroARS(contado);
    if (!Number.isFinite(monto) || monto < 0) { setError("Ingresá el efectivo contado para cerrar."); return; }
    const diferencia = Math.round((monto - resumen.esperado) * 100) / 100;
    if (Math.abs(diferencia) >= 0.01 && motivoDiferencia.trim().length < 3) { setError("Explicá la diferencia del arqueo antes de cerrar."); return; }
    setOcupado(true); setError(""); setExito("");
    try {
      const resultado = await cerrarTurnoCajaSigo({ empresaId, turnoId: turno.id, efectivoContado: monto, motivoDiferencia: motivoDiferencia.trim(), claveIdempotencia: claveCierre });
      setClaveCierre(clave()); setExito(`Cierre registrado. Diferencia: ${dinero(resultado.diferencia)}.`); setContado(""); setMotivoDiferencia(""); await recargar();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo cerrar la caja."); }
    finally { setOcupado(false); }
  }

  function exportar() {
    const filas = historial.map((t) => [t.id, t.caja_id, t.estado === "abierta" ? "Abierta" : "Cerrada", fecha(t.fecha_apertura), t.usuario_apertura, fecha(t.fecha_cierre), t.usuario_cierre || "", dinero(t.fondo_inicial), dinero(t.efectivo_esperado), dinero(t.efectivo_contado), dinero(t.diferencia), t.motivo_diferencia || ""]);
    descargarTablaExcel("Turnos", ["ID de turno", "Caja", "Estado", "Apertura", "Responsable apertura (ID)", "Cierre", "Responsable cierre (ID)", "Fondo inicial", "Efectivo esperado", "Efectivo contado", "Diferencia", "Motivo"], filas, `SIGO-historial-caja-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  async function verDetalle(turnoId: string) {
    if (turnoDetalleId === turnoId) { setTurnoDetalleId(""); setMovimientosHistorial([]); return; }
    setError("");
    try {
      const lista = await listarMovimientosTurnoSigo(empresaId, turnoId);
      setMovimientosHistorial(lista); setTurnoDetalleId(turnoId);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo leer el detalle del turno."); }
  }

  return <div className="sigo-cash-page">
    <header className="sigo-cash-head"><div><h2>▣ Apertura y cierre de caja</h2><p>Turno por empresa · Caja principal · importes en pesos argentinos.</p></div><button className="admin-button" onClick={() => void recargar()} disabled={cargando}>Actualizar</button></header>
    {error && <p className="form-error" role="alert">{error}</p>}{exito && <p className="sigo-cash-success" role="status">{exito}</p>}
    {cargando ? <p className="table-empty">Cargando caja…</p> : <>
      <section className="sigo-cash-status" aria-live="polite"><span className={turno ? "is-open" : "is-closed"}>{turno ? "TURNO ABIERTO" : "CAJA CERRADA"}</span><div><strong>{turno ? `Abierta ${fecha(turno.fecha_apertura)}` : "No hay un turno activo"}</strong><small>{turno ? `Fondo inicial ${dinero(turno.fondo_inicial)} · Responsable ${responsable || turno.usuario_apertura}` : "Abrí un turno para registrar ventas y cobros."}</small></div></section>
      {turno && <>
        <section className="sigo-cash-summary"><div><small>Efectivo esperado</small><strong>{dinero(resumen.esperado)}</strong></div>{[...resumen.porMedio.entries()].map(([medio, monto]) => <div key={medio}><small>{medio === "efectivo" ? "Efectivo neto" : medio.replaceAll("_", " ")}</small><strong>{dinero(monto)}</strong></div>)}</section>
        <div className="sigo-cash-tabs"><button className={seccion === "ajuste" ? "active" : ""} onClick={() => setSeccion("ajuste")}>Ingreso / retiro</button><button className={seccion === "cierre" ? "active" : ""} onClick={() => setSeccion("cierre")}>Arqueo y cierre</button></div>
        {seccion === "ajuste" && <section className="sigo-cash-form"><h3>Registrar movimiento de efectivo</h3><div className="sigo-cash-fields"><label>Tipo<select value={tipoAjuste} onChange={(e) => setTipoAjuste(e.target.value as "ingreso" | "retiro")}><option value="ingreso">Ingreso</option><option value="retiro">Retiro</option></select></label><label>Importe recibido / retirado<input inputMode="decimal" type="text" value={importeAjuste} onChange={(e) => setImporteAjuste(e.target.value)} /></label><label className="wide">Motivo<input value={motivoAjuste} maxLength={300} onChange={(e) => setMotivoAjuste(e.target.value)} placeholder="Ej.: cambio para caja, pago de flete…" /></label><button className="primary-button" disabled={!puedeOperar || ocupado} onClick={() => void ajustar()}>Registrar movimiento</button></div></section>}
        {seccion === "cierre" && <section className="sigo-cash-form"><h3>Arqueo de efectivo</h3><div className="sigo-cash-close-math"><span>Efectivo esperado <strong>{dinero(resumen.esperado)}</strong></span><label>Efectivo contado<input autoComplete="off" inputMode="decimal" type="text" value={contado} onChange={(e) => setContado(e.target.value)} /></label><span>Diferencia <strong>{contado === "" || !Number.isFinite(numeroARS(contado)) ? "—" : dinero(numeroARS(contado) - resumen.esperado)}</strong></span><label>Motivo (obligatorio si hay diferencia)<input value={motivoDiferencia} maxLength={300} onChange={(e) => setMotivoDiferencia(e.target.value)} /></label></div><button className="primary-button" disabled={!puedeOperar || ocupado || contado === ""} onClick={() => void cerrar()}>Cerrar turno</button></section>}
        <section className="sigo-cash-table"><h3>Movimientos del turno</h3><div className="table-wrapper"><table className="products-table"><thead><tr><th>Hora</th><th>Movimiento</th><th>Medio</th><th>Concepto</th><th>Importe</th></tr></thead><tbody>{movimientos.map((m,i)=><tr key={`${m.created_at}-${i}`}><td>{fecha(m.created_at)}</td><td>{m.tipo === "egreso" ? "Egreso" : "Ingreso"}</td><td>{m.medio_pago.replaceAll("_"," ")}</td><td>{m.concepto}</td><td>{m.tipo === "egreso" ? "−" : ""}{dinero(m.importe)}</td></tr>)}{movimientos.length === 0 && <tr><td colSpan={5}>Todavía no hay movimientos.</td></tr>}</tbody></table></div></section>
      </>}
      {!turno && <section className="sigo-cash-form"><h3>Abrir turno</h3><div className="sigo-cash-fields"><label>Fondo inicial en efectivo<input autoFocus inputMode="decimal" type="text" value={fondo} onChange={(e) => setFondo(e.target.value)} placeholder="0,00" /></label><button className="primary-button" disabled={!puedeOperar || ocupado || fondo === ""} onClick={() => void abrir()}>Abrir caja</button></div>{!puedeOperar && <small>Tu perfil puede consultar el historial, pero no operar la caja.</small>}</section>}
      <section className="sigo-cash-history"><div><h3>Historial de aperturas y cierres</h3><button className="admin-button" disabled={!historial.length} onClick={exportar}>Exportar a Excel</button></div><div className="table-wrapper"><table className="products-table"><thead><tr><th>Estado</th><th>Apertura</th><th>Responsable (ID)</th><th>Cierre</th><th>Fondo inicial</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th>Detalle</th></tr></thead><tbody>{historial.map((t)=><tr key={t.id}><td>{t.estado === "abierta" ? "Abierta" : "Cerrada"}</td><td>{fecha(t.fecha_apertura)}</td><td>{t.usuario_apertura}</td><td>{fecha(t.fecha_cierre)}</td><td>{dinero(t.fondo_inicial)}</td><td>{dinero(t.efectivo_esperado)}</td><td>{dinero(t.efectivo_contado)}</td><td>{dinero(t.diferencia)}</td><td><button className="admin-button" type="button" onClick={() => void verDetalle(t.id)}>{turnoDetalleId === t.id ? "Ocultar" : "Ver"}</button></td></tr>)}{historial.length === 0 && <tr><td colSpan={9}>Todavía no hay turnos registrados.</td></tr>}</tbody></table></div>{turnoDetalleId && <div className="sigo-cash-detail"><h4>Desglose del turno</h4><div className="table-wrapper"><table className="products-table"><thead><tr><th>Hora</th><th>Movimiento</th><th>Medio</th><th>Concepto</th><th>Importe</th></tr></thead><tbody>{movimientosHistorial.map((m,i)=><tr key={`${m.created_at}-${i}`}><td>{fecha(m.created_at)}</td><td>{m.tipo === "egreso" ? "Egreso" : "Ingreso"}</td><td>{m.medio_pago.replaceAll("_"," ")}</td><td>{m.concepto}</td><td>{m.tipo === "egreso" ? "−" : ""}{dinero(m.importe)}</td></tr>)}{movimientosHistorial.length === 0 && <tr><td colSpan={5}>Sin movimientos.</td></tr>}</tbody></table></div></div>}</section>
    </>}
  </div>;
}
