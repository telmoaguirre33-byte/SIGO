import { useEffect, useRef, useState } from "react";
import { cantidadManualMedida, consolidarCantidadMedida, formatoCantidadMedida, formatoStockMedida, subtotalMedida, UNIDADES_VENTA, type UnidadVenta } from "./ventaPorMedidas";

/** Entrada manual en la unidad base del producto; no recibe balanzas ni etiquetas. */
export default function EditorCantidadMedida({
  nombre, unidad, precio, stockDisponible, cantidadInicial, reemplazar = false, onConfirmar, onCancelar,
}: {
  nombre: string;
  unidad: UnidadVenta;
  precio: number;
  stockDisponible?: number | null;
  cantidadInicial?: number;
  reemplazar?: boolean;
  onConfirmar: (cantidad: number) => void;
  onCancelar: () => void;
}) {
  const [unidadEntrada, setUnidadEntrada] = useState<UnidadVenta>(unidad === "kg" ? "g" : unidad);
  const [entrada, setEntrada] = useState(cantidadInicial == null ? "" : String(unidad === "kg" ? Math.round(cantidadInicial * 1000) : cantidadInicial));
  const inputRef = useRef<HTMLInputElement>(null);
  const enviado = useRef(false);
  useEffect(() => {
    // Mientras se ingresa una cantidad, ninguna tecla fiscal/cobro puede cerrar otra venta.
    // Captura en window también protege si el foco sale momentáneamente del editor.
    const bloquearCobro = (event: KeyboardEvent) => {
      if (!["F9", "F10", "F11", "F12"].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", bloquearCobro, true);
    return () => window.removeEventListener("keydown", bloquearCobro, true);
  }, []);
  let cantidad: number | null = null;
  let error = "";
  try {
    cantidad = cantidadManualMedida(entrada, unidad, unidadEntrada);
    if (stockDisponible == null) error = "No se pudo verificar el stock disponible.";
    else consolidarCantidadMedida([cantidad], unidad, stockDisponible);
  } catch (err) {
    error = err instanceof Error && err.message === "STOCK_INSUFICIENTE"
      ? "La cantidad supera el stock disponible."
      : err instanceof Error && err.message === "STOCK_INVALIDO"
        ? "El stock no es válido para esta unidad. Revisá el producto."
        : `Ingresá una cantidad mayor a cero, con hasta ${UNIDADES_VENTA[unidadEntrada].decimales} decimales.`;
  }
  let subtotal: number | null = null;
  try { if (cantidad != null) subtotal = subtotalMedida(cantidad, precio); }
  catch { error = "Configurá un precio válido."; }
  if (!Number.isFinite(precio) || precio <= 0) error = "Configurá un precio válido.";
  return (
    <form className="panel sigo-medida-editor" style={{ display: "grid", gap: "0.6rem", width: "100%", maxWidth: "36rem", margin: "0 auto", padding: "1rem" }} aria-label={`Cantidad de ${nombre}`} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancelar(); }
    }} onSubmit={(event) => {
      event.preventDefault();
      if (cantidad != null && !error && !enviado.current) { enviado.current = true; onConfirmar(cantidad); }
    }}>
      <strong>{nombre}</strong>
      {unidad === "kg" && <div role="group" aria-label="Unidad de ingreso del peso" style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
        {(["g", "kg"] as const).map((opcion) => <button type="button" className={unidadEntrada === opcion ? "primary-button" : "admin-button"} key={opcion} aria-pressed={unidadEntrada === opcion} onClick={() => {
          if (opcion === unidadEntrada) { inputRef.current?.focus(); return; }
          setEntrada(cantidad == null ? "" : String(opcion === "g" ? Math.round(cantidad * 1000) : cantidad));
          setUnidadEntrada(opcion);
          inputRef.current?.focus();
        }}>{opcion === "g" ? "Gramos (g)" : "Kilos (kg)"}</button>)}
      </div>}
      <label htmlFor="sigo-cantidad-medida">Cantidad ({UNIDADES_VENTA[unidadEntrada].nombre})</label>
      <input style={{ width: "100%", minWidth: 0, padding: "0.6rem", fontSize: "1.6rem", border: "2px solid var(--primary)", borderRadius: "0.6rem" }} id="sigo-cantidad-medida" ref={inputRef} autoFocus inputMode={UNIDADES_VENTA[unidadEntrada].decimales ? "decimal" : "numeric"} autoComplete="off" placeholder={unidadEntrada === "g" && unidad === "kg" ? "Ej. 750" : unidad === "kg" ? "Ej. 0,750" : "Cantidad"} value={entrada}
        onFocus={(event) => event.currentTarget.select()} onChange={(event) => setEntrada(event.target.value)} aria-invalid={Boolean(entrada.trim() && error)} aria-describedby="sigo-medida-ayuda" />
      <small id="sigo-medida-ayuda">Ingreso manual. Precio y stock expresados en {unidad}. {stockDisponible != null && `Disponible: ${formatoStockMedida(stockDisponible, unidad)}.`}</small>
      {unidad === "kg" && cantidad != null && <div aria-live="polite">Equivale a {formatoCantidadMedida(cantidad, "kg")} ({Math.round(cantidad * 1000)} g)</div>}
      {unidad === "kg" && <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
        {[0.25, 0.5, 0.75, 1].map((valor) =>
          <button type="button" className="admin-button" key={valor} onClick={() => { setEntrada(String(unidadEntrada === "g" ? Math.round(valor * 1000) : valor)); inputRef.current?.focus(); }}>{valor < 1 ? `${valor * 1000} g` : "1 kg"}</button>)}
      </div>}
      <div>Precio por {unidad}: ${precio.toLocaleString("es-AR")}</div>
      <strong aria-live="polite">Subtotal: {subtotal == null ? "—" : subtotal.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}</strong>
      {entrada.trim() && error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary-button" disabled={cantidad == null || Boolean(error)}>{reemplazar ? "Actualizar" : "Agregar"} · Enter</button>
      <button type="button" className="admin-button" onClick={onCancelar}>Cancelar · Escape</button>
    </form>
  );
}
