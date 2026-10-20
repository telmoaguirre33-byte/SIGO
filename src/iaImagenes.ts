const TIPOS = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export function leerDocumentoIA(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => { reader.abort(); reject(new Error("Se agotó el tiempo de lectura del archivo. Volvé a seleccionarlo.")); }, 15_000);
    reader.onload = () => { clearTimeout(timer); resolve(String(reader.result ?? "")); };
    reader.onerror = reader.onabort = () => { clearTimeout(timer); reject(new Error("No se pudo leer el archivo seleccionado.")); };
    reader.readAsDataURL(blob);
  });
}

// Presupuesto binario: base64 agrega aproximadamente un tercio al tamaño.
export async function prepararImagenIA(file: File, options: { maxBytes?: number; maxDimension?: number } = {}): Promise<string> {
  const tipo = (file.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" } as Record<string, string>)[file.name.split(".").pop()?.toLowerCase() ?? ""] || "").replace("image/jpg", "image/jpeg");
  if (!TIPOS.has(tipo)) throw new Error("Usá JPG, PNG o WebP. Para HEIC/HEIF necesitás un navegador que pueda abrir ese formato, o convertirlo a JPG.");
  if (!file.size) throw new Error("La imagen está vacía.");
  if (file.size > 15 * 1024 * 1024) throw new Error("La imagen supera 15 MB. Reducí su tamaño antes de cargarla.");
  const maxBytes = options.maxBytes ?? 1_500_000;
  const maxDimension = options.maxDimension ?? 2200;
  if (maxBytes < 1024 || maxDimension < 320) throw new Error("El límite de imagen no es válido.");
  const original = await leerDocumentoIA(file.slice(0, file.size, tipo));
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { img.src = ""; reject(new Error("Se agotó el tiempo al abrir la imagen. Volvé a seleccionarla.")); }, 15_000);
    img.onload = () => { clearTimeout(timer); resolve(); };
    img.onerror = () => { clearTimeout(timer); reject(new Error(/heic|heif/.test(tipo) ? "Este navegador no puede abrir HEIC/HEIF. Convertí la foto a JPG o elegí formato compatible en la cámara." : "El archivo no se pudo abrir como imagen. Volvé a seleccionarlo.")); };
    img.src = original;
  });
  if (img.naturalWidth < 320 || img.naturalHeight < 320) throw new Error("La imagen debe medir al menos 320 × 320 píxeles.");
  let escala = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no pudo preparar la imagen. Volvé a intentarlo.");
  for (let intento = 0; intento < 5; intento++) {
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const calidad of [0.86, 0.74, 0.62]) {
      const data = canvas.toDataURL("image/jpeg", calidad);
      if (data.startsWith("data:image/jpeg;base64,") && Math.ceil((data.length - data.indexOf(",") - 1) * 3 / 4) <= maxBytes) return data;
    }
    escala *= 0.8;
  }
  throw new Error("No se pudo reducir la imagen al tamaño permitido. Elegí un archivo más pequeño.");
}
