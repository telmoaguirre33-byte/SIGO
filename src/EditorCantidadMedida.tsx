import { useState } from "react";
import { cantidadPorMedida, subtotalMedida, UNIDADES_VENTA, type UnidadVenta } from "./ventaPorMedidas";

/** Editor aislado para una línea de venta por medida.
 * Integrar únicamente tras validar soporte decimal en RPC de ventas y stock.
 */
export default function EditorCantidadMedida({
  nombre, unidad, precio, stockDisponible, onConfirmar, onCancelar,
}: {
  nombre: string;
  unidad: UnidadVenta;
  precio: number;
  stockDisponible?: number | null;
  onConfirmar: (cantidad: number) => void;
  onCancelar: () => void;
}) {
  const [entrada, setEntrada] = useState("1");
  let cantidad: number | null = null;
  let error = "";
  try {
    cantidad = cantidadPorMedida(entrada, unidad);
    if (stockDisponible != null && cantidad > stockDisponible) error = "La cantidad supera el stock disponible.";
  } catch {
    error = "Ingresá una cantidad válida para esta unidad.";
  }
  const subtotal = cantidad == null ? null : subtotalMedida(cantidad, precio);
  return (
    <form className="sigo-medida-editor" onSubmit={(event) => {
      event.preventDefault();
      if (cantidad != null && !error) onConfirmar(cantidad);
    }}>
      <strong>{nombre}</strong>
      <label htmlFor="sigo-cantidad-medida">Cantidad ({UNIDADES_VENTA[unidad].nombre})</label>
      <input id="sigo-cantidad-medida" autoFocus inputMode="decimal" value={entrada}
        onChange={(event) => setEntrada(event.target.value)} aria-invalid={Boolean(error)} />
      {unidad === "kg" && <div>
        {[0.25, 0.5, 1, 1.25, 1.5].map((valor) =>
          <button type="button" key={valor} onClick={() => setEntrada(String(valor))}>{valor.toLocaleString("es-AR")} kg</button>)}
      </div>}
      <div>Precio por {unidad}: ${precio.toLocaleString("es-AR")}</div>
      <strong>Subtotal: {subtotal == null ? "—" : subtotal.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}</strong>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={cantidad == null || Boolean(error)}>Agregar — Enter</button>
      <button type="button" onClick={onCancelar}>Cancelar</button>
    </form>
  );
}
