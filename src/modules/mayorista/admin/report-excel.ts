// Exportador XLSX reutilizado de src/excelProductos.ts; celdas de texto sin fórmulas.
type Celda = string | number | null | undefined;
const encoder = new TextEncoder();

function xml(valor: string) {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnaExcel(numero: number) {
  let n = numero;
  let salida = "";
  while (n > 0) {
    n -= 1;
    salida = String.fromCharCode(65 + (n % 26)) + salida;
    n = Math.floor(n / 26);
  }
  return salida;
}

function u16(valor: number) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, valor, true);
  return out;
}

function u32(valor: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, valor >>> 0, true);
  return out;
}

function unir(partes: Uint8Array[]) {
  const total = partes.reduce((suma, parte) => suma + parte.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) {
    out.set(parte, offset);
    offset += parte.length;
  }
  return out;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fechaDos(fecha = new Date()) {
  const anio = Math.max(1980, fecha.getFullYear());
  const hora = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | Math.floor(fecha.getSeconds() / 2);
  const dia = ((anio - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
  return { hora, dia };
}

function crearZip(archivos: Array<{ nombre: string; contenido: string }>) {
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let offset = 0;
  const dos = fechaDos();

  for (const archivo of archivos) {
    const nombre = encoder.encode(archivo.nombre);
    const datos = encoder.encode(archivo.contenido);
    const crc = crc32(datos);

    const local = unir([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(dos.hora), u16(dos.dia),
      u32(crc), u32(datos.length), u32(datos.length), u16(nombre.length), u16(0), nombre, datos,
    ]);
    locales.push(local);

    const central = unir([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dos.hora), u16(dos.dia),
      u32(crc), u32(datos.length), u32(datos.length), u16(nombre.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nombre,
    ]);
    centrales.push(central);
    offset += local.length;
  }

  const directorio = unir(centrales);
  const fin = unir([
    u32(0x06054b50), u16(0), u16(0), u16(archivos.length), u16(archivos.length),
    u32(directorio.length), u32(offset), u16(0),
  ]);
  return unir([...locales, directorio, fin]);
}

function celdaXml(valor: Celda, referencia: string, encabezado = false) {
  const estilo = encabezado ? ' s="1"' : "";
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `<c r="${referencia}"${estilo}><v>${valor}</v></c>`;
  }
  const texto = valor == null ? "" : String(valor);
  return `<c r="${referencia}" t="inlineStr"${estilo}><is><t>${xml(texto)}</t></is></c>`;
}

export function descargarTablaExcel(nombreHoja: string, encabezados: string[], filas: Array<Array<Celda>>, nombreArchivo: string) {
  const filasXml = [
    `<row r="1">${encabezados.map((valor, indice) => celdaXml(valor, `${columnaExcel(indice + 1)}1`, true)).join("")}</row>`,
    ...filas.map((fila, indiceFila) => `<row r="${indiceFila + 2}">${encabezados.map((_, indiceCol) => {
      const valor = fila[indiceCol];
      const referencia = `${columnaExcel(indiceCol + 1)}${indiceFila + 2}`;
      return celdaXml(valor, referencia);
    }).join("")}</row>`),
  ];
  const ultimaColumna = columnaExcel(Math.max(1, encabezados.length));
  const ultimaFila = Math.max(1, filas.length + 1);
  const columnas = encabezados.map((_, indice) => `<col min="${indice + 1}" max="${indice + 1}" width="20" customWidth="1"/>`).join("");
  const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${ultimaColumna}${ultimaFila}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columnas}</cols><sheetData>${filasXml.join("")}</sheetData><autoFilter ref="A1:${ultimaColumna}${ultimaFila}"/></worksheet>`;
  const contenido = crearZip([
    { nombre: "[Content_Types].xml", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { nombre: "_rels/.rels", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nombre: "xl/workbook.xml", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(nombreHoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nombre: "xl/_rels/workbook.xml.rels", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nombre: "xl/styles.xml", contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    { nombre: "xl/worksheets/sheet1.xml", contenido: hoja },
  ]);
  const blob = new Blob([contenido], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(enlace.href), 1500);
}

