import { useEffect, useMemo, useState } from "react";
import type { ProductoSigo } from "./productos";
import { guardarOfertasProductos, hoyArgentina, listarOfertasProductos, precioConOferta, type OfertaGuardar } from "./ofertasProductos";
import "./productos-oferta.css";

type Fila = { clave: string; productoId: string; consulta: string; inicio: string; fin: string; descuento: string };
type Props = { empresaId: string; productos: ProductoSigo[] };

function nuevaFila(): Fila {
  return { clave: crypto.randomUUID(), productoId: "", consulta: "", inicio: hoyArgentina(), fin: "", descuento: "" };
}

function dinero(valor: number) {
  return `$ ${valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizar(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-AR").trim();
}

export default function ProductosOferta({ empresaId, productos }: Props) {
  const [filas, setFilas] = useState<Fila[]>([nuevaFila()]);
  const [cargando, setCargando] = useState(true);
  const [cargaValida, setCargaValida] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const catalogo = useMemo(() => new Map(productos.map((producto) => [producto.id, producto])), [productos]);

  useEffect(() => {
    let activo = true;
    setCargando(true);
    setCargaValida(false);
    setError("");
    setMensaje("");
    void listarOfertasProductos(empresaId).then((ofertas) => {
      if (!activo) return;
      setCargaValida(true);
      setFilas(ofertas.length ? ofertas.map((oferta) => ({
        clave: oferta.id,
        productoId: oferta.producto_id,
        consulta: "",
        inicio: oferta.fecha_inicio,
        fin: oferta.fecha_fin,
        descuento: String(oferta.descuento_porcentaje),
      })) : [nuevaFila()]);
    }).catch((err: unknown) => {
      if (activo) setError(err instanceof Error ? err.message : "No se pudieron cargar las ofertas.");
    }).finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [empresaId]);

  function cambiar(clave: string, cambio: Partial<Fila>) {
    setFilas((actual) => actual.map((fila) => fila.clave === clave ? { ...fila, ...cambio } : fila));
    setMensaje("");
    setError("");
  }

  function quitar(clave: string) {
    setFilas((actual) => {
      const restantes = actual.filter((fila) => fila.clave !== clave);
      return restantes.length ? restantes : [nuevaFila()];
    });
    setAbierta(null);
    setMensaje("");
    setError("");
  }

  async function guardar() {
    if (guardando || cargando || !cargaValida) return;
    setError("");
    setMensaje("");
    const vacias = filas.filter((fila) => !fila.productoId && !fila.consulta.trim() && !fila.fin && !fila.descuento);
    const completas = filas.filter((fila) => !vacias.includes(fila));
    const ofertas: OfertaGuardar[] = [];
    for (let indice = 0; indice < completas.length; indice++) {
      const fila = completas[indice];
      const producto = catalogo.get(fila.productoId);
      const descuento = Number(fila.descuento.replace(",", "."));
      if (!producto) { setError(`Oferta ${indice + 1}: seleccioná un producto de la lista.`); return; }
      if (!fila.inicio || !fila.fin || fila.fin < fila.inicio) { setError(`Oferta ${indice + 1}: revisá las fechas de inicio y finalización.`); return; }
      if (!fila.descuento.trim() || !Number.isFinite(descuento) || descuento <= 0 || descuento >= 100) { setError(`Oferta ${indice + 1}: ingresá un descuento mayor a 0% y menor a 100%.`); return; }
      if (producto.precio_venta == null || Number(producto.precio_venta) <= 0 || precioConOferta(Number(producto.precio_venta), descuento) <= 0) {
        setError(`Oferta ${indice + 1}: el producto necesita un precio de venta válido.`); return;
      }
      if (ofertas.some((otra) => otra.producto_id === fila.productoId && otra.fecha_inicio <= fila.fin && otra.fecha_fin >= fila.inicio)) {
        setError(`Oferta ${indice + 1}: ya hay otra oferta para ese producto en las mismas fechas.`); return;
      }
      ofertas.push({ producto_id: fila.productoId, fecha_inicio: fila.inicio, fecha_fin: fila.fin, descuento_porcentaje: descuento });
    }
    setGuardando(true);
    let guardado = false;
    try {
      await guardarOfertasProductos(empresaId, ofertas);
      guardado = true;
      const guardadas = await listarOfertasProductos(empresaId);
      setFilas(guardadas.length ? guardadas.map((oferta) => ({
        clave: oferta.id, productoId: oferta.producto_id, consulta: "", inicio: oferta.fecha_inicio,
        fin: oferta.fecha_fin, descuento: String(oferta.descuento_porcentaje),
      })) : [nuevaFila()]);
      setAbierta(null);
      setMensaje(`${guardadas.length} oferta${guardadas.length === 1 ? "" : "s"} guardada${guardadas.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(guardado ? "Las ofertas se guardaron, pero no se pudo actualizar la pantalla. Recargá SIGO antes de volver a guardar." : err instanceof Error ? err.message : "No se pudieron guardar las ofertas.");
      if (guardado) setCargaValida(false);
    } finally { setGuardando(false); }
  }

  return <section className="panel productos-oferta" aria-label="Productos de oferta">
    <div className="page-header"><div><h3>Productos de oferta</h3><p>Elegí el producto, las fechas y el descuento. Agregá tantas ofertas como necesites.</p></div></div>
    {cargando ? <p>Cargando ofertas…</p> : !cargaValida ? <p className="form-error" role="alert">{error || "No se pudieron cargar las ofertas. Actualizá la página."}</p> : <>
      <div className="ofertas-filas">
        {filas.map((fila, indice) => {
          const producto = catalogo.get(fila.productoId);
          const descuento = Number(fila.descuento.replace(",", "."));
          const precio = Number(producto?.precio_venta ?? 0);
          const opciones = abierta === fila.clave ? productos.filter((p) => {
            const q = normalizar(fila.consulta);
            return q.length >= 2 && normalizar([p.nombre, p.codigo_barras, p.codigo_interno, p.marca].filter(Boolean).join(" ")).includes(q);
          }).slice(0, 12) : [];
          return <div className="oferta-fila" key={fila.clave}>
            <strong className="oferta-numero">Oferta {indice + 1}</strong>
            <div className="form-group oferta-producto">
              <label htmlFor={`oferta-producto-${fila.clave}`}>Producto</label>
              <input id={`oferta-producto-${fila.clave}`} type="search" autoComplete="off" value={abierta === fila.clave ? fila.consulta : producto?.nombre ?? fila.consulta}
                placeholder="Buscar por nombre o código" onFocus={() => { setAbierta(fila.clave); cambiar(fila.clave, { consulta: "" }); }}
                onChange={(event) => cambiar(fila.clave, { consulta: event.target.value, productoId: "" })} disabled={guardando} />
              {abierta === fila.clave && fila.consulta.length >= 2 && <div className="oferta-opciones" role="listbox" aria-label="Productos encontrados">
                {opciones.map((opcion) => <button type="button" role="option" aria-selected={false} key={opcion.id} onClick={() => { cambiar(fila.clave, { productoId: opcion.id, consulta: "" }); setAbierta(null); }}>
                  {opcion.nombre} <small>{opcion.codigo_barras || opcion.codigo_interno || ""} · {dinero(Number(opcion.precio_venta ?? 0))}</small>
                </button>)}
                {opciones.length === 0 && <span>No se encontraron productos.</span>}
              </div>}
            </div>
            <div className="form-group"><label htmlFor={`oferta-inicio-${fila.clave}`}>Fecha de inicio</label><input id={`oferta-inicio-${fila.clave}`} type="date" value={fila.inicio} onChange={(event) => cambiar(fila.clave, { inicio: event.target.value })} disabled={guardando} /></div>
            <div className="form-group"><label htmlFor={`oferta-fin-${fila.clave}`}>Fecha de finalización</label><input id={`oferta-fin-${fila.clave}`} type="date" value={fila.fin} min={fila.inicio} onChange={(event) => cambiar(fila.clave, { fin: event.target.value })} disabled={guardando} /></div>
            <div className="form-group"><label htmlFor={`oferta-descuento-${fila.clave}`}>Descuento %</label><input id={`oferta-descuento-${fila.clave}`} type="number" min="0.01" max="99.99" step="0.01" inputMode="decimal" value={fila.descuento} onChange={(event) => cambiar(fila.clave, { descuento: event.target.value })} disabled={guardando} /></div>
            <div className="form-group"><label>Precio de oferta</label><output>{producto && precio > 0 && descuento > 0 && descuento < 100 ? dinero(precioConOferta(precio, descuento)) : "—"}</output></div>
            <button className="admin-button oferta-quitar" type="button" onClick={() => quitar(fila.clave)} disabled={guardando} aria-label={`Quitar oferta ${indice + 1}`}>Quitar</button>
          </div>;
        })}
      </div>
      <div className="ofertas-acciones">
        <button className="admin-button" type="button" onClick={() => { setFilas((actual) => [...actual, nuevaFila()]); setMensaje(""); }} disabled={guardando}>＋ Agregar oferta</button>
        <button className="primary-button" type="button" onClick={() => void guardar()} disabled={guardando}>{guardando ? "Guardando…" : "Guardar ofertas"}</button>
      </div>
      {mensaje && <p role="status">{mensaje}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    </>}
  </section>;
}
