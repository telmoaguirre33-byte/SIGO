import { useMemo, useRef, useState, type ChangeEvent } from "react";
import type { ProductoSigo } from "./productos";
import { analizarFacturaCompraSigo } from "./facturaIA";
import {
  descargarPlantillaStockSigo,
  importarFilasStockSigo,
  leerArchivoStock,
  prepararImportacionStock,
  type ResumenImportacionStock,
  type ResultadoCargaStock,
} from "./stockImportExcel";

export default function StockImportAssistant({
  empresaId,
  productos,
  onImported,
}: {
  empresaId: string;
  productos: ProductoSigo[];
  onImported: () => void | Promise<void>;
}) {
  const excelRef = useRef<HTMLInputElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [resumen, setResumen] = useState<ResumenImportacionStock | null>(null);
  const [archivo, setArchivo] = useState("");
  const [error, setError] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [progreso, setProgreso] = useState({ hechas: 0, total: 0 });
  const [resultados, setResultados] = useState<ResultadoCargaStock[] | null>(null);

  const cargables = useMemo(() => resumen?.filas.filter((fila) => fila.estado !== "error") ?? [], [resumen]);
  const fallasCarga = resultados?.filter((item) => !item.ok) ?? [];
  const exitosCarga = resultados?.filter((item) => item.ok) ?? [];

  function limpiar() {
    setResumen(null);
    setArchivo("");
    setError("");
    setResultados(null);
    setProgreso({ hechas: 0, total: 0 });
    if (excelRef.current) excelRef.current.value = "";
    if (fotoRef.current) fotoRef.current.value = "";
  }

  function cerrar() {
    if (leyendo || importando) return;
    setOpen(false);
    limpiar();
  }

  async function cargarExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLeyendo(true);
    setError("");
    setResultados(null);
    try {
      const matriz = await leerArchivoStock(file);
      const preparado = prepararImportacionStock(matriz, productos);
      setArchivo(file.name);
      setResumen(preparado);
    } catch (err) {
      setResumen(null);
      setError(err instanceof Error ? err.message : "No pude leer la planilla.");
    } finally {
      setLeyendo(false);
    }
  }

  async function cargarFotoFactura(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLeyendo(true);
    setError("");
    setResultados(null);
    try {
      const factura = await analizarFacturaCompraSigo(empresaId, file);
      const matriz = [
        ["Producto", "Código interno", "Código de barras", "Stock", "Precio de compra"],
        ...factura.items.map((item) => [
          item.descripcion,
          item.codigo ?? "",
          item.codigo_barras ?? "",
          String(item.cantidad),
          String(item.costo_unitario),
        ]),
      ];
      const preparado = prepararImportacionStock(matriz, productos);
      setArchivo(`Factura con IA · ${file.name}`);
      setResumen(preparado);
    } catch (err) {
      setResumen(null);
      setError(err instanceof Error ? err.message : "No pude leer la factura con IA.");
    } finally {
      setLeyendo(false);
    }
  }

  async function confirmarImportacion() {
    if (!resumen || cargables.length === 0 || importando) return;
    setImportando(true);
    setError("");
    setResultados(null);
    setProgreso({ hechas: 0, total: cargables.length });
    try {
      const resultado = await importarFilasStockSigo(
        empresaId,
        resumen.filas,
        productos,
        (hechas, total) => setProgreso({ hechas, total }),
      );
      setResultados(resultado);
      if (resultado.some((item) => item.ok)) await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la carga.");
    } finally {
      setImportando(false);
    }
  }

  return (
    <>
      <button className="primary-button stock-import-main-button" type="button" onClick={() => setOpen(true)}>
        Cargar mis productos
      </button>

      {open && (
        <div className="modal-backdrop stock-import-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cerrar(); }}>
          <div className="modal stock-import-modal" role="dialog" aria-modal="true" aria-labelledby="stock-import-title">
            <div className="page-header modal-header">
              <div>
                <h2 id="stock-import-title">Cargar mis productos</h2>
                <p>Subí lo que ya tenés. SIGO ordena la información y te muestra qué va a cargar antes de tocar tu stock.</p>
              </div>
              <button className="admin-button" type="button" onClick={cerrar} disabled={leyendo || importando}>Cerrar</button>
            </div>

            {!resumen && !resultados && (
              <div className="stock-import-start">
                <div className="stock-import-choice">
                  <span className="stock-import-icon">1</span>
                  <div><strong>¿Ya tenés un Excel?</strong><p>No importa si las columnas tienen otros nombres. SIGO intenta reconocer Producto, Stock, Costo y Precio.</p></div>
                  <button className="primary-button" type="button" onClick={() => excelRef.current?.click()} disabled={leyendo}>Subir mi Excel</button>
                </div>

                <div className="stock-import-choice">
                  <span className="stock-import-icon">2</span>
                  <div><strong>¿No tenés planilla?</strong><p>Descargá una planilla simple, completala y después subila acá.</p></div>
                  <button className="admin-button" type="button" onClick={descargarPlantillaStockSigo}>Descargar planilla simple</button>
                </div>

                <div className="stock-import-choice stock-import-ai-choice">
                  <span className="stock-import-icon">IA</span>
                  <div><strong>¿Tenés una factura?</strong><p>Sacale una foto. La IA puede preparar productos, cantidades y costo de compra para que vos sólo revises.</p></div>
                  <button className="admin-button" type="button" onClick={() => fotoRef.current?.click()} disabled={leyendo}>Foto de factura con IA</button>
                </div>

                <input ref={excelRef} className="stock-import-hidden" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(event) => void cargarExcel(event)} />
                <input ref={fotoRef} className="stock-import-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void cargarFotoFactura(event)} />
                {leyendo && <div className="stock-import-reading"><span className="stock-import-spinner" /> Preparando la información…</div>}
              </div>
            )}

            {error && <div className="stock-import-alert stock-import-alert-error" role="alert"><strong>Necesito que revisemos algo</strong><span>{error}</span></div>}

            {resumen && !resultados && (
              <div className="stock-import-review">
                <div className="stock-import-file-row">
                  <div><strong>{archivo}</strong><span>SIGO ya acomodó la información. Todavía no se modificó el stock.</span></div>
                  <button className="admin-button" type="button" onClick={limpiar} disabled={importando}>Usar otro archivo</button>
                </div>

                <div className="stock-import-stats">
                  <div><span>Encontrados</span><strong>{resumen.total}</strong></div>
                  <div><span>Listos</span><strong>{resumen.listas}</strong></div>
                  <div><span>Revisar</span><strong>{resumen.revisar}</strong></div>
                  <div><span>No se cargarán</span><strong>{resumen.errores}</strong></div>
                </div>

                <div className="stock-import-explain">
                  <strong>¿Qué hará SIGO?</strong>
                  <span>{resumen.nuevos} productos nuevos · {resumen.actualizaciones} productos existentes se actualizarán.</span>
                  <span>El valor de la columna Stock se tomará como el stock actual del comercio.</span>
                </div>

                <div className="table-wrapper stock-import-table-wrapper">
                  <table className="products-table stock-import-table">
                    <thead><tr><th>Producto</th><th>Stock</th><th>Compra</th><th>Venta</th><th>Qué hará</th><th>Estado</th></tr></thead>
                    <tbody>
                      {resumen.filas.slice(0, 80).map((fila) => (
                        <tr key={`${fila.fila}-${fila.nombre}`}>
                          <td><strong>{fila.nombre || `Fila ${fila.fila}`}</strong><small>{fila.codigoBarras || fila.codigoInterno || "Sin código"}</small></td>
                          <td>{fila.stockActual ?? "-"}</td>
                          <td>{fila.costoCompra == null ? "-" : `$ ${fila.costoCompra.toLocaleString("es-AR")}`}</td>
                          <td>{fila.precioVenta == null ? "-" : `$ ${fila.precioVenta.toLocaleString("es-AR")}`}</td>
                          <td>{fila.accion === "nuevo" ? "Crear" : "Actualizar"}</td>
                          <td>
                            <span className={`stock-import-status ${fila.estado}`}>{fila.estado === "lista" ? "Listo" : fila.estado === "revisar" ? "Revisar" : "Corregir"}</span>
                            {fila.mensajes.length > 0 && <small className="stock-import-message">{fila.mensajes.join(" ")}</small>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {resumen.filas.length > 80 && <p className="stock-import-muted">Mostramos los primeros 80 productos. Los {resumen.filas.length} fueron revisados.</p>}

                {importando && (
                  <div className="stock-import-progress">
                    <div><strong>Cargando productos…</strong><span>{progreso.hechas} de {progreso.total}</span></div>
                    <progress max={Math.max(1, progreso.total)} value={progreso.hechas} />
                  </div>
                )}

                <div className="form-actions stock-import-actions">
                  <button className="admin-button" type="button" onClick={cerrar} disabled={importando}>Cancelar</button>
                  <button className="primary-button" type="button" onClick={() => void confirmarImportacion()} disabled={importando || cargables.length === 0}>
                    {importando ? "Cargando…" : `Cargar ${cargables.length} producto${cargables.length === 1 ? "" : "s"}`}
                  </button>
                </div>
                {resumen.errores > 0 && <p className="stock-import-muted">Las filas marcadas “Corregir” quedan afuera. No frenan la carga de las que están bien.</p>}
              </div>
            )}

            {resultados && (
              <div className="stock-import-finish">
                <div className="stock-import-success-icon">✓</div>
                <h3>{fallasCarga.length === 0 ? "Listo. Tu stock ya está cargado." : "Carga terminada con algunas revisiones."}</h3>
                <p>{exitosCarga.length} producto{exitosCarga.length === 1 ? "" : "s"} se cargaron correctamente.</p>
                {fallasCarga.length > 0 && (
                  <div className="stock-import-alert stock-import-alert-error">
                    <strong>{fallasCarga.length} no pudieron cargarse</strong>
                    {fallasCarga.slice(0, 10).map((item) => <span key={`${item.fila}-${item.nombre}`}>Fila {item.fila} · {item.nombre}: {item.mensaje}</span>)}
                  </div>
                )}
                <div className="form-actions">
                  <button className="admin-button" type="button" onClick={limpiar}>Cargar otro archivo</button>
                  <button className="primary-button" type="button" onClick={cerrar}>Terminar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
