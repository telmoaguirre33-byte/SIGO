import type { ProductoSigo } from "./productos";

type Celda = string | number | null | undefined;

type Columna = {
  titulo: string;
  ancho: number;
  valor: (producto: ProductoSigo) => Celda;
};

const COLUMNAS: Columna[] = [
  { titulo: "Código interno", ancho: 18, valor: (p) => p.codigo_interno },
  { titulo: "Código de barras", ancho: 20, valor: (p) => p.codigo_barras },
  { titulo: "Producto", ancho: 34, valor: (p) => p.nombre },
  { titulo: "Descripción", ancho: 34, valor: (p) => p.descripcion },
  { titulo: "Categoría", ancho: 22, valor: (p) => p.categoria },
  { titulo: "Marca", ancho: 20, valor: (p) => p.marca },
  { titulo: "Proveedor", ancho: 24, valor: (p) => p.proveedor },
  { titulo: "Costo actual", ancho: 16, valor: (p) => p.costo_actual },
  { titulo: "Costo última compra", ancho: 19, valor: (p) => p.costo_ultima_compra },
  { titulo: "Margen %", ancho: 13, valor: (p) => p.margen_porcentaje },
  { titulo: "Margen $", ancho: 14, valor: (p) => p.margen_ganancia },
  { titulo: "Precio de venta", ancho: 17, valor: (p) => p.precio_venta },
  { titulo: "Stock actual", ancho: 14, valor: (p) => p.stock_actual },
  { titulo: "Stock mínimo", ancho: 14, valor: (p) => p.stock_minimo },
  { titulo: "Stock máximo", ancho: 14, valor: (p) => p.stock_maximo },
];

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

function hojaProductos(productos: ProductoSigo[]) {
  const filas: string[] = [];
  const encabezado = COLUMNAS.map((col, indice) => celdaXml(col.titulo, `${columnaExcel(indice + 1)}1`, true)).join("");
  filas.push(`<row r="1">${encabezado}</row>`);

  productos.forEach((producto, indiceFila) => {
    const numeroFila = indiceFila + 2;
    const celdas = COLUMNAS.map((col, indiceCol) => {
      const referencia = `${columnaExcel(indiceCol + 1)}${numeroFila}`;
      const valor = col.valor(producto);
      // Códigos se fuerzan a texto para preservar ceros a la izquierda.
      if (indiceCol <= 1 && valor != null) return celdaXml(String(valor), referencia);
      return celdaXml(valor, referencia);
    }).join("");
    filas.push(`<row r="${numeroFila}">${celdas}</row>`);
  });

  const ultimaColumna = columnaExcel(COLUMNAS.length);
  const ultimaFila = Math.max(1, productos.length + 1);
  const columnas = COLUMNAS.map((col, indice) => `<col min="${indice + 1}" max="${indice + 1}" width="${col.ancho}" customWidth="1"/>`).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${ultimaColumna}${ultimaFila}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columnas}</cols>
  <sheetData>${filas.join("")}</sheetData>
  <autoFilter ref="A1:${ultimaColumna}${ultimaFila}"/>
</worksheet>`;
}

function libroXlsx(productos: ProductoSigo[]) {
  const hoja = hojaProductos(productos);
  return crearZip([
    {
      nombre: "[Content_Types].xml",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      nombre: "_rels/.rels",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: "xl/workbook.xml",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Productos" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      nombre: "xl/styles.xml",
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    { nombre: "xl/worksheets/sheet1.xml", contenido: hoja },
  ]);
}

export function descargarProductosExcel(productos: ProductoSigo[]) {
  const bytes = libroXlsx(productos);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const hoy = new Date().toISOString().slice(0, 10);
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `SIGO-productos-${hoy}.xlsx`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(enlace.href), 1500);
}
