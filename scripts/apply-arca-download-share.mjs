import fs from "node:fs";

const path = "src/ArcaCaeEmission.tsx";
let source = fs.readFileSync(path, "utf8");

if (!source.includes("function crearArchivoComprobante()")) {
  const marker = "  function compartirWhatsApp() {";
  if (!source.includes(marker)) throw new Error("ARCA_DOWNLOAD_SHARE_FUNCTION_TARGET_NOT_FOUND");
  source = source.replace(marker, `  function nombreArchivoComprobante() {
    if (!ultimoComprobante) return "comprobante-sigo.html";
    const c = ultimoComprobante;
    return \`SIGO-\${tipoComprobanteLabel(c.tipoCbteSeleccionado).replace(/\\s+/g, "-")}-\${String(c.punto_venta).padStart(4, "0")}-\${String(c.numero_cbte).padStart(8, "0")}.html\`;
  }

  function crearArchivoComprobante() {
    const html = construirHtmlImpresion("a4");
    if (!html) return null;
    return new File([html], nombreArchivoComprobante(), { type: "text/html;charset=utf-8" });
  }

  function descargarComprobante() {
    const archivo = crearArchivoComprobante();
    if (!archivo) return;
    const url = URL.createObjectURL(archivo);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = archivo.name;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function compartirWhatsApp() {`);
}

const oldOpen = "    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, \"_blank\", \"noopener,noreferrer\");\n  }";
const newOpen = `    const archivo = crearArchivoComprobante();
    if (archivo && typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ files: [archivo] }))) {
      try {
        await navigator.share({
          title: \`\${tipoComprobanteLabel(c.tipoCbteSeleccionado)} \${String(c.punto_venta).padStart(4, "0")}-\${String(c.numero_cbte).padStart(8, "0")}\`,
          text: texto,
          files: [archivo],
        });
        return;
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
      }
    }

    // En escritorio, WhatsApp Web no permite adjuntar un archivo local automáticamente.
    // SIGO descarga el comprobante y abre el mensaje para que el usuario lo adjunte en un paso.
    descargarComprobante();
    window.open(\`https://wa.me/?text=\${encodeURIComponent(texto + "\\n\\nSIGO descargó el comprobante para adjuntarlo a este chat.")}\`, "_blank", "noopener,noreferrer");
  }`;
if (source.includes(oldOpen)) source = source.replace(oldOpen, newOpen);
else if (!source.includes("SIGO descargó el comprobante para adjuntarlo")) throw new Error("ARCA_DOWNLOAD_SHARE_WHATSAPP_TARGET_NOT_FOUND");

const oldButtons = `          <button className="admin-button" type="button" onClick={() => imprimir("a4")}>🖨 Imprimir A4</button>
          <button className="admin-button" type="button" onClick={() => imprimir("80")}>🧾 Ticket 80 mm</button>
          <button className="admin-button" type="button" onClick={() => imprimir("58")}>🧾 Ticket 58 mm</button>
          <button className="primary-button" type="button" onClick={compartirWhatsApp}>WhatsApp</button>`;
const newButtons = `          <button className="admin-button" type="button" onClick={() => imprimir("a4")}>🖨 Imprimir A4</button>
          <button className="admin-button" type="button" onClick={descargarComprobante}>⬇ Descargar comprobante</button>
          <button className="admin-button" type="button" onClick={() => imprimir("80")}>🧾 Ticket 80 mm</button>
          <button className="admin-button" type="button" onClick={() => imprimir("58")}>🧾 Ticket 58 mm</button>
          <button className="primary-button" type="button" onClick={() => void compartirWhatsApp()}>WhatsApp / Compartir</button>`;
if (source.includes(oldButtons)) source = source.replace(oldButtons, newButtons);
else if (!source.includes("Descargar comprobante")) throw new Error("ARCA_DOWNLOAD_SHARE_BUTTON_TARGET_NOT_FOUND");

fs.writeFileSync(path, source, "utf8");
console.log("SIGO_ARCA_DOWNLOAD_SHARE_OK");
