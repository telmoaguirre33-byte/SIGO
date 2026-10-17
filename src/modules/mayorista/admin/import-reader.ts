// Lector CSV/XLSX reutilizado de src/stockImportExcel.ts. Sin sus escritores de SIGO.
type MatrizExcel = string[][];
const decoder = new TextDecoder('utf-8');
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
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{while(true){const item=await reader.read();if(item.done)break;total+=item.value.length;if(total>32*1024*1024){await reader.cancel();throw new Error("La hoja supera 32 MB descomprimidos.");}chunks.push(item.value);}}finally{reader.releaseLock();}
  const salida=new Uint8Array(total);let cursor=0;for(const chunk of chunks){salida.set(chunk,cursor);cursor+=chunk.length;}
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
  if(cantidad>1000)throw new Error("El libro tiene demasiadas entradas. Exportá sólo la hoja a importar.");
  let totalDeclarado=0,totalReal=0;
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
    totalDeclarado+=descomprimido;if(descomprimido>32*1024*1024||totalDeclarado>100*1024*1024)throw new Error("El Excel descomprimido es demasiado grande.");
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
    const inflated=await descomprimirZipEntrada(datos,metodo,descomprimido);totalReal+=inflated.length;if(totalReal>100*1024*1024)throw new Error("El contenido real del Excel supera 100 MB.");
    archivos.set(nombre,inflated);
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
    if(numero>10001)throw new Error("Usá hasta 10.000 filas de datos.");
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
      const col=indiceColumna(ref);if(col>=100)throw new Error("Usá hasta 100 columnas.");fila[col] = valor;
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
  if(quoted)throw new Error("CSV inválido: comillas sin cerrar.");
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

