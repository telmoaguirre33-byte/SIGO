import { useMemo, useState } from "react";
import JsBarcode from "jsbarcode";
import type { ProductoSigo } from "./productos";

type Props = {
  productos: ProductoSigo[];
};

type Formato = "a4" | "termica";

function html(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dinero(valor: number | null | undefined) {
  if (valor == null || !Number.isFinite(Number(valor))) return "SIN PRECIO";
  return `$ ${Number(valor).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function codigoProducto(producto: ProductoSigo) {
  return String(producto.codigo_barras || producto.codigo_interno || "").trim();
}

function barcodeSvg(codigo: string) {
  if (!codigo) return '<div class="sin-codigo">SIN CÓDIGO</div>';
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const numeric = /^\d+$/.test(codigo);
  const formato = numeric && codigo.length === 13
    ? "EAN13"
    : numeric && codigo.length === 8
      ? "EAN8"
      : numeric && codigo.length === 12
        ? "UPC"
        : "CODE128";
  try {
    JsBarcode(svg, codigo, {
      format: formato,
      displayValue: true,
      fontSize: 12,
      height: 42,
      margin: 0,
      width: 1.45,
      background: "#ffffff",
      lineColor: "#111111",
    });
  } catch {
    try {
      JsBarcode(svg, codigo, {
        format: "CODE128",
        displayValue: true,
        fontSize: 12,
        height: 42,
        margin: 0,
        width: 1.35,
        background: "#ffffff",
        lineColor: "#111111",
      });
    } catch {
      return `<div class="sin-codigo">CÓDIGO: ${html(codigo)}</div>`;
    }
  }
  return svg.outerHTML;
}

export default function EtiquetasPrecios({ productos }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [seleccionados, setSeleccionados] = useState<Set<string>>(() => new Set());
  const [formato, setFormato] = useState<Formato>("a4");
  const [copias, setCopias] = useState("1");
  const [error, setError] = useState("");

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter((p) => [p.nombre, p.codigo_barras, p.codigo_interno, p.marca, p.categoria]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q));
  }, [productos, busqueda]);

  function toggle(id: string) {
    setSeleccionados((actual) => {
      const next = new Set(actual);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function seleccionarVisibles() {
    setSeleccionados((actual) => {
      const next = new Set(actual);
      visibles.forEach((p) => next.add(p.id));
      return next;
    });
  }

  function imprimir() {
    setError("");
    const cantidadCopias = Math.max(1, Math.min(20, Number(copias) || 1));
    const elegidos = productos.filter((p) => seleccionados.has(p.id));
    if (elegidos.length === 0) {
      setError("Seleccioná al menos un producto para imprimir etiquetas.");
      return;
    }

    const etiquetas = elegidos.flatMap((producto) => Array.from({ length: cantidadCopias }, () => producto));
    const contenido = etiquetas.map((producto) => {
      const codigo = codigoProducto(producto);
      return `<article class="etiqueta">
        <div class="nombre">${html(producto.nombre)}</div>
        ${producto.marca ? `<div class="marca">${html(producto.marca)}</div>` : ""}
        <div class="precio">${html(dinero(producto.precio_venta))}</div>
        <div class="barcode">${barcodeSvg(codigo)}</div>
      </article>`;
    }).join("");

    const cssFormato = formato === "termica"
      ? `@page { size: 58mm auto; margin: 2mm; }
         body { width: 54mm; margin: 0; }
         .hoja { display: block; width: 54mm; }
         .etiqueta { width: 52mm; min-height: 29mm; margin: 0 0 2mm; padding: 2mm; box-sizing: border-box; page-break-inside: avoid; }`
      : `@page { size: A4 portrait; margin: 8mm; }
         body { margin: 0; }
         .hoja { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
         .etiqueta { min-height: 34mm; padding: 2.5mm; box-sizing: border-box; page-break-inside: avoid; }`;

    const ventana = window.open("", "_blank", "width=980,height=760");
    if (!ventana) {
      setError("El navegador bloqueó la ventana de impresión. Habilitá ventanas emergentes para SIGO y volvé a intentar.");
      return;
    }
    ventana.opener = null;
    ventana.document.open();
    ventana.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>SIGO · Etiquetas</title><style>
      ${cssFormato}
      * { font-family: Arial, Helvetica, sans-serif; }
      .etiqueta { border: 1px solid #cfd5df; border-radius: 2mm; text-align: center; overflow: hidden; background: #fff; color: #111; }
      .nombre { font-size: 12px; font-weight: 700; line-height: 1.15; max-height: 28px; overflow: hidden; }
      .marca { font-size: 10px; margin-top: 1mm; color: #555; }
      .precio { font-size: 22px; line-height: 1; font-weight: 800; margin: 1.5mm 0 1mm; }
      .barcode { display: flex; justify-content: center; align-items: center; min-height: 15mm; overflow: hidden; }
      .barcode svg { max-width: 100%; height: 15mm; }
      .sin-codigo { font-size: 10px; border: 1px dashed #888; padding: 2mm; width: 100%; box-sizing: border-box; }
      @media print { .etiqueta { break-inside: avoid; } }
    </style></head><body><main class="hoja">${contenido}</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));<\/script></body></html>`);
    ventana.document.close();
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button className="admin-button" type="button" disabled={productos.length === 0} onClick={() => setAbierto((v) => !v)}>
        🏷️ Imprimir etiquetas
      </button>

      {abierto && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="page-header">
            <div>
              <h3>Etiquetas de código de barras y precio</h3>
              <p>Seleccioná productos y generá etiquetas listas para imprimir en hoja A4 o impresora térmica.</p>
            </div>
            <strong>{seleccionados.size} seleccionados</strong>
          </div>

          <div className="form-grid">
            <div className="form-group form-span-2">
              <label htmlFor="etiqueta-buscar">Buscar productos</label>
              <input id="etiqueta-buscar" type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Producto, código o marca" />
            </div>
            <div className="form-group">
              <label htmlFor="etiqueta-formato">Formato</label>
              <select id="etiqueta-formato" value={formato} onChange={(e) => setFormato(e.target.value as Formato)}>
                <option value="a4">Hoja A4 · grilla</option>
                <option value="termica">Térmica 58 mm</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="etiqueta-copias">Copias por producto</label>
              <input id="etiqueta-copias" type="number" min="1" max="20" step="1" value={copias} onChange={(e) => setCopias(e.target.value)} />
            </div>
          </div>

          <div className="form-actions" style={{ justifyContent: "flex-start", marginTop: 10 }}>
            <button className="admin-button" type="button" onClick={seleccionarVisibles}>Seleccionar visibles ({visibles.length})</button>
            <button className="admin-button" type="button" onClick={() => setSeleccionados(new Set())}>Limpiar selección</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, maxHeight: 360, overflow: "auto", marginTop: 12 }}>
            {visibles.map((p) => {
              const codigo = codigoProducto(p);
              const activo = seleccionados.has(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  aria-pressed={activo}
                  className={activo ? "primary-button" : "admin-button"}
                  style={{ textAlign: "left", minHeight: 84, whiteSpace: "normal" }}
                >
                  <strong>{p.nombre}</strong><br />
                  <span>{codigo || "Sin código"}</span><br />
                  <span>{dinero(p.precio_venta)}</span>
                </button>
              );
            })}
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions" style={{ marginTop: 14 }}>
            <button className="primary-button" type="button" disabled={seleccionados.size === 0} onClick={imprimir}>
              Imprimir {seleccionados.size || ""} etiqueta{seleccionados.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
