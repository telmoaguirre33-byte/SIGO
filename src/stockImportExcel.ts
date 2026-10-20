import type { ProductoSigo } from "./productos";
import { guardarProductoSigo } from "./productos";

export type EstadoFilaImportacion = "lista" | "revisar" | "error";
export type AccionFilaImportacion = "nuevo" | "actualizar";

export type FilaImportacionStock = {
  fila: number;
  nombre: string;
  codigoInterno: string | null;
  codigoBarras: string | null;
  stockActual: number | null;
  stockMinimo: number | null;
  costoCompra: number | null;
  precioVenta: number | null;
  categoria: string | null;
  marca: string | null;
  productoId: string | null;
  accion: AccionFilaImportacion;
  estado: EstadoFilaImportacion;
  mensajes: string[];
};

export type ResumenImportacionStock = {
  filas: FilaImportacionStock[];
  columnasDetectadas: Record<string, string | null>;
  total: number;
  listas: number;
  revisar: number;
  errores: number;
  nuevos: number;
  actualizaciones: number;
};

export type ResultadoCargaStock = {
  ok: boolean;
  fila: number;
  nombre: string;
  accion: AccionFilaImportacion;
  mensaje?: string;
};

type CanonicalKey =
  | "nombre"
  | "codigoInterno"
  | "codigoBarras"
  | "stockActual"
  | "stockMinimo"
  | "costoCompra"
  | "precioVenta"
  | "categoria"
  | "marca";

type MatrizExcel = string[][];

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

const ALIAS: Record<CanonicalKey, string[]> = {
  nombre: ["producto", "articulo", "nombre", "descripcion", "detalle", "item", "mercaderia"],
  codigoInterno: ["codigo interno", "codigo producto", "sku", "codigo", "cod producto", "cod"],
  codigoBarras: ["codigo de barras", "codigo barras", "cod barras", "barcode", "ean", "gtin"],
  stockActual: ["stock actual", "stock", "existencia", "existencias", "cantidad", "cant", "saldo", "unidades"],
  stockMinimo: ["stock minimo", "minimo", "punto reposicion", "reposicion", "stock seguridad"],
  costoCompra: ["precio de compra", "precio compra", "costo unitario", "costo actual", "costo", "p compra"],
  precioVenta: ["precio de venta", "precio venta", "venta", "p venta", "pventa", "precio publico", "precio final"],
  categoria: ["categoria", "rubro", "familia", "departamento", "grupo"],
  marca: ["marca", "brand", "fabricante"],
};

function normalizar(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function limpiarTexto(value: unknown): string | null {
  const texto = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return texto ? texto.slice(0, 180) : null;
}

function limpiarCodigo(value: unknown): string | null {
  const texto = String(value ?? "").trim().replace(/^'+/, "").replace(/\.0$/, "");
  return texto ? texto.slice(0, 80) : null;
}

function numeroArgentino(value: unknown): { value: number | null; error: string | null } {
  const original = String(value ?? "").trim();
  if (!original) return { value: null, error: null };
  let limpio = original.replace(/[$€£ARSars\s]/g, "").replace(/[^0-9,.-]/g, "");
  if (!limpio) return { value: null, error: `“${original}” no parece un número.` };

  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    if (ultimaComa > ultimoPunto) limpio = limpio.replace(/\./g, "").replace(",", ".");
    else limpio = limpio.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    const decimales = limpio.length - ultimaComa - 1;
    limpio = decimales === 3 && /^-?\d{1,3}(,\d{3})+$/.test(limpio)
      ? limpio.replace(/,/g, "")
      : limpio.replace(",", ".");
  } else if (ultimoPunto >= 0) {
    const decimales = limpio.length - ultimoPunto - 1;
    if (decimales === 3 && /^-?\d{1,3}(\.\d{3})+$/.test(limpio)) limpio = limpio.replace(/\./g, "");
  }

  const numero = Number(limpio);
  if (!Number.isFinite(numero)) return { value: null, error: `“${original}” no parece un número válido.` };
  if (numero < 0) return { value: null, error: `“${original}” no puede ser negativo.` };
  return { value: numero, error: null };
}

function puntajeAlias(encabezado: string, alias: string) {
  if (encabezado === alias) return 100;
  if (encabezado.startsWith(`${alias} `) || encabezado.endsWith(` ${alias}`)) return 85;
  if (encabezado.includes(alias)) return Math.max(55, 80 - Math.abs(encabezado.length - alias.length));
  if (alias.includes(encabezado) && encabezado.length >= 4) return 45;
  return 0;
}

function detectarColumnas(encabezados: string[]) {
  const usados = new Set<number>();
  const resultado = {} as Record<CanonicalKey, number | null>;
  const claves = Object.keys(ALIAS) as CanonicalKey[];

  for (const clave of claves) {
    let mejorIndice: number | null = null;
    let mejorPuntaje = 0;
    encabezados.forEach((encabezado, indice) => {
      if (usados.has(indice)) return;
      const limpio = normalizar(encabezado);
      for (const alias of ALIAS[clave]) {
        const score = puntajeAlias(limpio, normalizar(alias));
        if (score > mejorPuntaje) {
          mejorPuntaje = score;
          mejorIndice = indice;
        }
      }
    });
    resultado[clave] = mejorPuntaje >= 45 ? mejorIndice : null;
    if (resultado[clave] != null) usados.add(resultado[clave]!);
  }
  return resultado;
}

function valorCelda(fila: string[], indice: number | null) {
  return indice == null ? "" : String(fila[indice] ?? "").trim();
}

function indicePorIdentidad(productos: ProductoSigo[]) {
  const porBarra = new Map<string, ProductoSigo[]>();
  const porInterno = new Map<string, ProductoSigo[]>();
  const porNombre = new Map<string, ProductoSigo[]>();
  const agregar = (mapa: Map<string, ProductoSigo[]>, clave: string, producto: ProductoSigo) => {
    if (!clave) return;
    const lista = mapa.get(clave) ?? [];
    lista.push(producto);
    mapa.set(clave, lista);
  };
  for (const producto of productos) {
    agregar(porBarra, normalizar(producto.codigo_barras), producto);
    agregar(porInterno, normalizar(producto.codigo_interno), producto);
    agregar(porNombre, normalizar(producto.nombre), producto);
  }
  return { porBarra, porInterno, porNombre };
}

function buscarExistente(
  indices: ReturnType<typeof indicePorIdentidad>,
  codigoBarras: string | null,
  codigoInterno: string | null,
  nombre: string,
): { producto: ProductoSigo | null; error: string | null } {
  const candidatos = new Map<string, ProductoSigo>();
  const sumar = (items: ProductoSigo[] | undefined) => items?.forEach((item) => candidatos.set(item.id, item));
  if (codigoBarras) sumar(indices.porBarra.get(normalizar(codigoBarras)));
  if (codigoInterno) sumar(indices.porInterno.get(normalizar(codigoInterno)));

  if (candidatos.size > 1) {
    return { producto: null, error: "El código coincide con más de un producto. Revisalo antes de cargar." };
  }
  if (candidatos.size === 1) return { producto: [...candidatos.values()][0], error: null };

  const porNombre = indices.porNombre.get(normalizar(nombre)) ?? [];
  if (porNombre.length === 1) return { producto: porNombre[0], error: null };
  if (porNombre.length > 1) return { producto: null, error: "Hay más de un producto con ese nombre. Agregá un código para identificarlo." };
  return { producto: null, error: null };
}

export function prepararImportacionStock(matriz: MatrizExcel, productos: ProductoSigo[]): ResumenImportacionStock {
  const noVacias = matriz.filter((fila) => fila.some((celda) => String(celda ?? "").trim()));
  if (noVacias.length < 2) throw new Error("El archivo no tiene productos para cargar.");

  const encabezados = noVacias[0].map((item) => String(item ?? "").trim());
  const columnas = detectarColumnas(encabezados);
  if (columnas.nombre == null) throw new Error("No encontré la columna Producto/Artículo. Usá la plantilla de SIGO o revisá el encabezado.");
  if (columnas.stockActual == null) throw new Error("No encontré la columna Stock/Existencia. Usá la plantilla de SIGO o revisá el encabezado.");

  const indices = indicePorIdentidad(productos);
  const barrasVistas = new Map<string, number>();
  const internosVistos = new Map<string, number>();

  const filas = noVacias.slice(1).map((fila, indice): FilaImportacionStock | null => {
    const filaExcel = indice + 2;
    const nombre = limpiarTexto(valorCelda(fila, columnas.nombre)) ?? "";
    if (!nombre && !fila.some((celda) => String(celda ?? "").trim())) return null;

    const codigoInterno = limpiarCodigo(valorCelda(fila, columnas.codigoInterno));
    const codigoBarras = limpiarCodigo(valorCelda(fila, columnas.codigoBarras));
    const stock = numeroArgentino(valorCelda(fila, columnas.stockActual));
    const stockMinimo = numeroArgentino(valorCelda(fila, columnas.stockMinimo));
    const costo = numeroArgentino(valorCelda(fila, columnas.costoCompra));
    const venta = numeroArgentino(valorCelda(fila, columnas.precioVenta));
    const categoria = limpiarTexto(valorCelda(fila, columnas.categoria));
    const marca = limpiarTexto(valorCelda(fila, columnas.marca));
    const mensajes: string[] = [];
    let estado: EstadoFilaImportacion = "lista";

    const errorNumerico = [stock.error, stockMinimo.error, costo.error, venta.error].find(Boolean);
    if (errorNumerico) {
      estado = "error";
      mensajes.push(errorNumerico);
    }
    if (!nombre) {
      estado = "error";
      mensajes.push("Falta el nombre del producto.");
    }
    if (stock.value == null) {
      estado = "error";
      mensajes.push("Falta el stock actual.");
    }
    if (venta.value === 0) {
      estado = estado === "error" ? estado : "revisar";
      mensajes.push("El precio de venta está en $0. Podés cargarlo y completarlo después.");
    }
    if (costo.value != null && venta.value != null && venta.value > 0 && venta.value < costo.value) {
      estado = estado === "error" ? estado : "revisar";
      mensajes.push("El precio de venta es menor al precio de compra. Revisalo.");
    }

    const coincidencia = buscarExistente(indices, codigoBarras, codigoInterno, nombre);
    if (coincidencia.error) {
      estado = "error";
      mensajes.push(coincidencia.error);
    }

    if (codigoBarras) {
      const clave = normalizar(codigoBarras);
      if (barrasVistas.has(clave)) {
        estado = "error";
        mensajes.push(`Código de barras repetido también en la fila ${barrasVistas.get(clave)}.`);
      } else barrasVistas.set(clave, filaExcel);
    }
    if (codigoInterno) {
      const clave = normalizar(codigoInterno);
      if (internosVistos.has(clave)) {
        estado = "error";
        mensajes.push(`Código interno repetido también en la fila ${internosVistos.get(clave)}.`);
      } else internosVistos.set(clave, filaExcel);
    }

    if (!codigoBarras && !codigoInterno && !coincidencia.producto) {
      estado = estado === "error" ? estado : "revisar";
      mensajes.push("Producto nuevo sin código. SIGO lo puede crear, pero un código ayuda a evitar duplicados.");
    }

    return {
      fila: filaExcel,
      nombre,
      codigoInterno,
      codigoBarras,
      stockActual: stock.value,
      stockMinimo: stockMinimo.value,
      costoCompra: costo.value,
      precioVenta: venta.value,
      categoria,
      marca,
      productoId: coincidencia.producto?.id ?? null,
      accion: coincidencia.producto ? "actualizar" : "nuevo",
      estado,
      mensajes,
    };
  }).filter((fila): fila is FilaImportacionStock => fila != null && Boolean(fila.nombre || fila.stockActual != null));

  const columnasDetectadas = Object.fromEntries((Object.keys(columnas) as CanonicalKey[]).map((clave) => [
    clave,
    columnas[clave] == null ? null : encabezados[columnas[clave]!],
  ]));

  return {
    filas,
    columnasDetectadas,
    total: filas.length,
    listas: filas.filter((fila) => fila.estado === "lista").length,
    revisar: filas.filter((fila) => fila.estado === "revisar").length,
    errores: filas.filter((fila) => fila.estado === "error").length,
    nuevos: filas.filter((fila) => fila.accion === "nuevo" && fila.estado !== "error").length,
    actualizaciones: filas.filter((fila) => fila.accion === "actualizar" && fila.estado !== "error").length,
  };
}

function u16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function u32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

async function descomprimirZipEntrada(bytes: Uint8Array, metodo: number, esperado: number) {
  if (metodo === 0) return bytes;
  if (metodo !== 8) throw new Error("Este Excel usa una compresión no compatible. Guardalo nuevamente como .xlsx e intentá otra vez.");
  if (!("DecompressionStream" in window)) throw new Error("Este dispositivo no puede abrir este Excel comprimido. Probá con la plantilla oficial de SIGO.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw" as any));
  const salida = new Uint8Array(await new Response(stream).arrayBuffer());
  if (esperado > 0 && salida.length !== esperado) {
    // Algunos editores no informan el tamaño exacto; el XML sigue siendo validado después.
  }
  return salida;
}

async function leerZip(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no parece ser un Excel .xlsx válido.");
  const cantidad = u16(bytes, eocd + 10);
  const centralOffset = u32(bytes, eocd + 16);
  let offset = centralOffset;
  const archivos = new Map<string, Uint8Array>();

  for (let n = 0; n < cantidad; n += 1) {
    if (u32(bytes, offset) !== 0x02014b50) throw new Error("El Excel está dañado o incompleto.");
    const flags = u16(bytes, offset + 8);
    if (flags & 0x1) throw new Error("No se pueden importar Excel protegidos con contraseña.");
    const metodo = u16(bytes, offset + 10);
    const comprimido = u32(bytes, offset + 20);
    const descomprimido = u32(bytes, offset + 24);
    const largoNombre = u16(bytes, offset + 28);
    const largoExtra = u16(bytes, offset + 30);
    const largoComentario = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const nombre = decoder.decode(bytes.slice(offset + 46, offset + 46 + largoNombre));

    if (u32(bytes, localOffset) !== 0x04034b50) throw new Error("El Excel tiene una entrada interna inválida.");
    const localNombre = u16(bytes, localOffset + 26);
    const localExtra = u16(bytes, localOffset + 28);
    const inicio = localOffset + 30 + localNombre + localExtra;
    const datos = bytes.slice(inicio, inicio + comprimido);
    archivos.set(nombre, await descomprimirZipEntrada(datos, metodo, descomprimido));
    offset += 46 + largoNombre + largoExtra + largoComentario;
  }
  return archivos;
}

function textoXml(bytes: Uint8Array | undefined, nombre: string) {
  if (!bytes) throw new Error(`El Excel no contiene ${nombre}.`);
  return decoder.decode(bytes);
}

function sharedStrings(xml: string | null) {
  if (!xml) return [] as string[];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName("si")).map((si) =>
    Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""),
  );
}

function indiceColumna(referencia: string) {
  const letras = referencia.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let total = 0;
  for (const letra of letras) total = total * 26 + (letra.charCodeAt(0) - 64);
  return Math.max(0, total - 1);
}

function matrizDesdeHoja(xml: string, strings: string[]) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("No pude leer la hoja del Excel.");
  const salida: string[][] = [];
  const rows = Array.from(doc.getElementsByTagName("row"));
  rows.forEach((row, rowIndex) => {
    const numero = Math.max(1, Number(row.getAttribute("r") || rowIndex + 1));
    const fila: string[] = salida[numero - 1] ?? [];
    Array.from(row.getElementsByTagName("c")).forEach((celda) => {
      const ref = celda.getAttribute("r") || "A1";
      const type = celda.getAttribute("t");
      let valor = "";
      if (type === "inlineStr") {
        valor = Array.from(celda.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");
      } else {
        const raw = celda.getElementsByTagName("v")[0]?.textContent ?? "";
        valor = type === "s" ? strings[Number(raw)] ?? "" : raw;
      }
      fila[indiceColumna(ref)] = valor;
    });
    salida[numero - 1] = fila;
  });
  return salida;
}

function parseCsv(texto: string): MatrizExcel {
  const primera = texto.split(/\r?\n/, 1)[0] ?? "";
  const delimitador = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let quoted = false;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i];
    if (ch === '"') {
      if (quoted && texto[i + 1] === '"') { celda += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === delimitador && !quoted) {
      fila.push(celda); celda = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && texto[i + 1] === "\n") i += 1;
      fila.push(celda); filas.push(fila); fila = []; celda = "";
    } else celda += ch;
  }
  fila.push(celda);
  if (fila.some((item) => item.trim())) filas.push(fila);
  return filas;
}

export async function leerArchivoStock(file: File): Promise<MatrizExcel> {
  const nombre = file.name.toLowerCase();
  if (file.size <= 0) throw new Error("El archivo está vacío.");
  if (file.size > 20 * 1024 * 1024) throw new Error("El archivo supera 20 MB. Dividilo en dos planillas para cargarlo con seguridad.");
  if (nombre.endsWith(".csv")) return parseCsv(await file.text());
  if (!nombre.endsWith(".xlsx")) throw new Error("Usá un archivo .xlsx o .csv. Si tenés un .xls antiguo, abrilo y guardalo como .xlsx.");

  const zip = await leerZip(await file.arrayBuffer());
  const strings = sharedStrings(zip.has("xl/sharedStrings.xml") ? decoder.decode(zip.get("xl/sharedStrings.xml")!) : null);
  const hoja = zip.get("xl/worksheets/sheet1.xml") ?? [...zip.entries()].find(([nombreArchivo]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(nombreArchivo))?.[1];
  return matrizDesdeHoja(textoXml(hoja, "una hoja de productos"), strings);
}

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function bytesU16(value: number) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function bytesU32(value: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function unir(partes: Uint8Array[]) {
  const total = partes.reduce((suma, parte) => suma + parte.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) { out.set(parte, offset); offset += parte.length; }
  return out;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipSimple(archivos: Array<{ nombre: string; contenido: string }>) {
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let offset = 0;
  for (const archivo of archivos) {
    const nombre = encoder.encode(archivo.nombre);
    const datos = encoder.encode(archivo.contenido);
    const crc = crc32(datos);
    const local = unir([bytesU32(0x04034b50), bytesU16(20), bytesU16(0), bytesU16(0), bytesU16(0), bytesU16(0), bytesU32(crc), bytesU32(datos.length), bytesU32(datos.length), bytesU16(nombre.length), bytesU16(0), nombre, datos]);
    locales.push(local);
    centrales.push(unir([bytesU32(0x02014b50), bytesU16(20), bytesU16(20), bytesU16(0), bytesU16(0), bytesU16(0), bytesU16(0), bytesU32(crc), bytesU32(datos.length), bytesU32(datos.length), bytesU16(nombre.length), bytesU16(0), bytesU16(0), bytesU16(0), bytesU16(0), bytesU32(0), bytesU32(offset), nombre]));
    offset += local.length;
  }
  const central = unir(centrales);
  return unir([...locales, central, unir([bytesU32(0x06054b50), bytesU16(0), bytesU16(0), bytesU16(archivos.length), bytesU16(archivos.length), bytesU32(central.length), bytesU32(offset), bytesU16(0)])]);
}

export function descargarPlantillaStockSigo() {
  const encabezados = ["Producto", "Código de barras", "Código interno", "Stock", "Stock mínimo", "Precio de compra", "Precio de venta", "Categoría", "Marca"];
  const anchos = [34, 20, 18, 12, 14, 18, 18, 22, 20];
  const celdas = encabezados.map((titulo, index) => `<c r="${String.fromCharCode(65 + index)}1" t="inlineStr" s="1"><is><t>${xml(titulo)}</t></is></c>`).join("");
  const columnas = anchos.map((ancho, index) => `<col min="${index + 1}" max="${index + 1}" width="${ancho}" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columnas}</cols><sheetData><row r="1">${celdas}</row></sheetData><autoFilter ref="A1:I1"/></worksheet>`;
  const bytes = zipSimple([
    { nombre: "[Content_Types].xml", contenido: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { nombre: "_rels/.rels", contenido: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nombre: "xl/workbook.xml", contenido: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Stock" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nombre: "xl/_rels/workbook.xml.rels", contenido: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nombre: "xl/styles.xml", contenido: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>` },
    { nombre: "xl/worksheets/sheet1.xml", contenido: sheet },
  ]);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = "SIGO-plantilla-stock.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1500);
}

export async function importarFilasStockSigo(
  empresaId: string,
  filas: FilaImportacionStock[],
  productos: ProductoSigo[],
  onProgress?: (hechas: number, total: number) => void,
): Promise<ResultadoCargaStock[]> {
  const validas = filas.filter((fila) => fila.estado !== "error");
  const porId = new Map(productos.map((producto) => [producto.id, producto]));
  const resultados: ResultadoCargaStock[] = new Array(validas.length);
  let siguiente = 0;
  let terminadas = 0;
  const workers = Math.min(4, Math.max(1, validas.length));

  async function trabajar() {
    while (true) {
      const index = siguiente++;
      if (index >= validas.length) return;
      const fila = validas[index];
      const existente = fila.productoId ? porId.get(fila.productoId) ?? null : null;
      try {
        await guardarProductoSigo({
          empresaId,
          productoId: existente?.id ?? null,
          nombre: fila.nombre,
          codigoInterno: fila.codigoInterno ?? existente?.codigo_interno ?? null,
          codigoBarras: fila.codigoBarras ?? existente?.codigo_barras ?? null,
          descripcion: existente?.descripcion ?? null,
          categoria: fila.categoria ?? existente?.categoria ?? null,
          marca: fila.marca ?? existente?.marca ?? null,
          proveedor: existente?.proveedor ?? null,
          costoActual: fila.costoCompra,
          costoUltimaCompra: fila.costoCompra,
          precioVenta: fila.precioVenta,
          margenGanancia: null,
          margenPorcentaje: null,
          stockActual: fila.stockActual,
          stockMinimo: fila.stockMinimo,
          stockMaximo: null,
        });
        resultados[index] = { ok: true, fila: fila.fila, nombre: fila.nombre, accion: fila.accion };
      } catch (error) {
        resultados[index] = {
          ok: false,
          fila: fila.fila,
          nombre: fila.nombre,
          accion: fila.accion,
          mensaje: error instanceof Error ? error.message : "No se pudo cargar este producto.",
        };
      } finally {
        terminadas += 1;
        onProgress?.(terminadas, validas.length);
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => trabajar()));
  return resultados;
}
