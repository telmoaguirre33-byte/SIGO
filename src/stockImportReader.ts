import { readSheet } from "read-excel-file/universal";
import { leerArchivoStock as leerArchivoStockLegacy } from "./stockImportExcel";

type MatrizExcel = string[][];

function celdaComoTexto(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return String(value).trim();
}

function validarMatriz(matriz: MatrizExcel, nombreArchivo: string): MatrizExcel {
  const noVacias = matriz.filter((fila) => fila.some((celda) => String(celda ?? "").trim()));
  if (noVacias.length < 2) throw new Error(`${nombreArchivo}: el archivo no tiene productos para cargar.`);
  return matriz;
}

export async function leerArchivoStockMovil(file: File): Promise<MatrizExcel> {
  const nombre = file.name.toLowerCase();
  if (file.size === 0) throw new Error("El archivo está vacío.");
  if (file.size > 25 * 1024 * 1024) throw new Error("El archivo supera 25 MB. Dividilo en partes e intentá nuevamente.");

  if (nombre.endsWith(".csv")) {
    return validarMatriz(await leerArchivoStockLegacy(file), file.name);
  }

  if (!nombre.endsWith(".xlsx")) {
    throw new Error("Usá un archivo .xlsx o .csv. Si tenés un .xls antiguo, abrilo y guardalo como .xlsx.");
  }

  try {
    // read-excel-file usa fflate y no depende de DecompressionStream del navegador.
    // Esto evita fallas en Android/WebView al abrir XLSX comprimidos.
    const filas = await readSheet(file);
    const matriz = filas.map((fila) => fila.map(celdaComoTexto));
    return validarMatriz(matriz, file.name);
  } catch (errorPrincipal) {
    // Conservamos el lector anterior como segundo camino para no perder compatibilidad
    // con archivos que ya funcionaban correctamente.
    try {
      return validarMatriz(await leerArchivoStockLegacy(file), file.name);
    } catch (errorLegacy) {
      console.error("SIGO XLSX mobile reader failed", { errorPrincipal, errorLegacy });
      const detalle = errorPrincipal instanceof Error ? errorPrincipal.message.trim() : "";
      throw new Error(
        detalle
          ? `No pude abrir ${file.name} en este dispositivo. ${detalle}`
          : `No pude abrir ${file.name} en este dispositivo. Volvé a guardarlo como .xlsx o probá con CSV.`,
      );
    }
  }
}
