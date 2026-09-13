import { supabase } from "./supabase";

export type EmpresaReadinessRef = {
  empresa_id: string;
  nombre: string;
  activa: boolean;
};

type ImportRow = {
  import_key: string;
  empresa_id: string;
  source_rows: number | null;
  inserted_rows: number | null;
  skipped_existing: number | null;
  verified_rows: number | null;
};

type CatalogRow = {
  id: string;
  nombre: string;
  codigo_interno: string | null;
  codigo_barras: string | null;
  activo: boolean | null;
  precio_venta: number | null;
  stock_actual: number | null;
};

export type ReadinessTestProduct = {
  id: string;
  nombre: string;
  codigo: string;
  stock: number;
  precio: number;
};

export type OperationalReadinessResult = {
  ok: boolean;
  checkedAt: string;
  empresaId: string | null;
  empresaNombre: string;
  empresasSigoAdministracion: number;
  libreriaSource: number;
  libreriaVerified: number;
  libreriaLotes: number;
  computacionSource: number;
  computacionVerified: number;
  computacionLotes: number;
  totalSource: number;
  totalVerified: number;
  totalLotes: number;
  lotesDuplicados: number;
  lotesInconsistentes: number;
  empresasImportadas: number;
  catalogoProductos: number;
  catalogoLeido: number;
  costosActualesNull: number;
  identidadesDuplicadas: number;
  legacyDupPendientes: number;
  productosSinCodigo: number;
  stockNegativo: number;
  stockNull: number;
  vendiblesConStock: number;
  productoPrueba: ReadinessTestProduct | null;
  bloqueosIdentidad: string[];
  issues: string[];
  evidence: string;
};

const MAIN_COMPANY = "sigo administración";
const LIBRERIA_PATTERN = "resguardo-stock-sigo-2026-09-09-libreria-%";
const COMPUTACION_PATTERN = "resguardo-stock-sigo-2026-09-09-sertec-%";
const LIBRERIA_LOTES_ESPERADOS = 10;
const COMPUTACION_LOTES_ESPERADOS = 5;
const TOTAL_LOTES_ESPERADOS = LIBRERIA_LOTES_ESPERADOS + COMPUTACION_LOTES_ESPERADOS;
const PAGE_SIZE = 1000;
const LEGACY_DUP_PREFIX = "LEGACY-DUP-";
const MAX_BLOQUEOS_EVIDENCIA = 5;

function sumar(rows: ImportRow[], key: "source_rows" | "verified_rows") {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function normalizarNombre(nombre: string) {
  return nombre.trim().toLocaleLowerCase("es-AR");
}

function normalizarCodigo(valor: string | null) {
  return (valor ?? "").trim().toUpperCase();
}

function codigoPreferido(row: CatalogRow) {
  return normalizarCodigo(row.codigo_barras) || normalizarCodigo(row.codigo_interno);
}

function describirProducto(row: CatalogRow) {
  const codigo = codigoPreferido(row) || "SIN-CODIGO";
  const nombre = row.nombre.trim() || "Producto sin nombre";
  return `${codigo}:${nombre}`;
}

async function leerCatalogoCompleto(empresaId: string): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  for (let desde = 0; ; desde += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("productos")
      .select("id,nombre,codigo_interno,codigo_barras,activo,precio_venta,stock_actual")
      .eq("empresa_id", empresaId)
      .order("id", { ascending: true })
      .range(desde, desde + PAGE_SIZE - 1);
    if (error) throw error;
    const pagina = (data ?? []) as CatalogRow[];
    rows.push(...pagina);
    if (pagina.length < PAGE_SIZE) break;
  }
  return rows;
}

function mapaIdentidades(rows: CatalogRow[]) {
  const porCodigo = new Map<string, Map<string, CatalogRow>>();
  for (const row of rows) {
    const codigos = new Set([
      normalizarCodigo(row.codigo_barras),
      normalizarCodigo(row.codigo_interno),
    ].filter(Boolean));
    for (const codigo of codigos) {
      const productos = porCodigo.get(codigo) ?? new Map<string, CatalogRow>();
      productos.set(row.id, row);
      porCodigo.set(codigo, productos);
    }
  }
  return porCodigo;
}

function detectarIdentidadesDuplicadas(rows: CatalogRow[]) {
  return [...mapaIdentidades(rows).entries()]
    .filter(([, productos]) => productos.size > 1)
    .sort(([a], [b]) => a.localeCompare(b));
}

function resultadoVacio(
  checkedAt: string,
  empresasSigoAdministracion: number,
  issues: string[],
): OperationalReadinessResult {
  return {
    ok: false,
    checkedAt,
    empresaId: null,
    empresaNombre: "SIGO Administración",
    empresasSigoAdministracion,
    libreriaSource: 0,
    libreriaVerified: 0,
    libreriaLotes: 0,
    computacionSource: 0,
    computacionVerified: 0,
    computacionLotes: 0,
    totalSource: 0,
    totalVerified: 0,
    totalLotes: 0,
    lotesDuplicados: 0,
    lotesInconsistentes: 0,
    empresasImportadas: 0,
    catalogoProductos: 0,
    catalogoLeido: 0,
    costosActualesNull: 0,
    identidadesDuplicadas: 0,
    legacyDupPendientes: 0,
    productosSinCodigo: 0,
    stockNegativo: 0,
    stockNull: 0,
    vendiblesConStock: 0,
    productoPrueba: null,
    bloqueosIdentidad: [],
    issues,
    evidence: `SIGO_LIVE_READINESS_REVIEW tenant_count=${empresasSigoAdministracion} checked_at=${checkedAt}`,
  };
}

export async function validarReadinessSigoAdministracion(
  empresas: EmpresaReadinessRef[],
): Promise<OperationalReadinessResult> {
  const checkedAt = new Date().toISOString();
  const principales = empresas.filter(
    (empresa) => empresa.activa && normalizarNombre(empresa.nombre) === MAIN_COMPANY,
  );
  const empresa = principales.length === 1 ? principales[0] : null;
  const issues: string[] = [];

  if (principales.length !== 1 || !empresa) {
    issues.push(`Se esperaba una única empresa activa SIGO Administración y se encontraron ${principales.length}.`);
    return resultadoVacio(checkedAt, principales.length, issues);
  }

  const [libreriaResp, computacionResp, productosResp, costosNullResp, catalogo] = await Promise.all([
    supabase
      .from("sigo_importaciones_stock")
      .select("import_key,empresa_id,source_rows,inserted_rows,skipped_existing,verified_rows")
      .like("import_key", LIBRERIA_PATTERN),
    supabase
      .from("sigo_importaciones_stock")
      .select("import_key,empresa_id,source_rows,inserted_rows,skipped_existing,verified_rows")
      .like("import_key", COMPUTACION_PATTERN),
    supabase
      .from("productos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresa.empresa_id),
    supabase
      .from("productos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresa.empresa_id)
      .is("costo_actual", null),
    leerCatalogoCompleto(empresa.empresa_id),
  ]);

  for (const response of [libreriaResp, computacionResp, productosResp, costosNullResp]) {
    if (response.error) throw response.error;
  }

  const libreria = (libreriaResp.data ?? []) as ImportRow[];
  const computacion = (computacionResp.data ?? []) as ImportRow[];
  const importaciones = [...libreria, ...computacion];
  const libreriaSource = sumar(libreria, "source_rows");
  const libreriaVerified = sumar(libreria, "verified_rows");
  const computacionSource = sumar(computacion, "source_rows");
  const computacionVerified = sumar(computacion, "verified_rows");
  const totalSource = libreriaSource + computacionSource;
  const totalVerified = libreriaVerified + computacionVerified;
  const totalLotes = importaciones.length;
  const lotesUnicos = new Set(importaciones.map((row) => row.import_key.trim()).filter(Boolean));
  const lotesDuplicados = totalLotes - lotesUnicos.size;
  const empresasImportadasSet = new Set(importaciones.map((row) => row.empresa_id));
  const empresasImportadas = empresasImportadasSet.size;
  const catalogoProductos = Number(productosResp.count ?? 0);
  const catalogoLeido = catalogo.length;
  const costosActualesNull = Number(costosNullResp.count ?? 0);
  const lotesInconsistentes = importaciones.filter((row) => {
    const source = Number(row.source_rows ?? 0);
    const inserted = Number(row.inserted_rows ?? 0);
    const skipped = Number(row.skipped_existing ?? 0);
    const verified = Number(row.verified_rows ?? 0);
    return inserted + skipped !== source || verified !== source;
  }).length;

  const identidadesDuplicadasDetalle = detectarIdentidadesDuplicadas(catalogo);
  const identidadesDuplicadas = identidadesDuplicadasDetalle.length;
  const legacyPendientes = catalogo
    .filter((row) => normalizarCodigo(row.codigo_interno).startsWith(LEGACY_DUP_PREFIX))
    .sort((a, b) => describirProducto(a).localeCompare(describirProducto(b)));
  const legacyDupPendientes = legacyPendientes.length;
  const productosSinCodigo = catalogo.filter(
    (row) => !normalizarCodigo(row.codigo_barras) && !normalizarCodigo(row.codigo_interno),
  ).length;
  const stockNegativo = catalogo.filter((row) => row.stock_actual != null && Number(row.stock_actual) < 0).length;
  const stockNull = catalogo.filter((row) => row.stock_actual == null).length;
  const vendibles = catalogo.filter((row) =>
    row.activo !== false
    && Number(row.precio_venta ?? 0) > 0
    && Number(row.stock_actual ?? 0) > 0
    && Boolean(codigoPreferido(row))
    && !normalizarCodigo(row.codigo_interno).startsWith(LEGACY_DUP_PREFIX),
  ).sort((a, b) => describirProducto(a).localeCompare(describirProducto(b)));
  const vendiblesConStock = vendibles.length;
  const candidato = vendibles[0] ?? null;
  const productoPrueba: ReadinessTestProduct | null = candidato ? {
    id: candidato.id,
    nombre: candidato.nombre.trim() || "Producto sin nombre",
    codigo: codigoPreferido(candidato),
    stock: Number(candidato.stock_actual ?? 0),
    precio: Number(candidato.precio_venta ?? 0),
  } : null;

  const bloqueosDuplicados = identidadesDuplicadasDetalle
    .slice(0, MAX_BLOQUEOS_EVIDENCIA)
    .map(([codigo, productos]) => `${codigo}=>${[...productos.values()].map(describirProducto).join("|")}`);
  const bloqueosLegacy = legacyPendientes
    .slice(0, MAX_BLOQUEOS_EVIDENCIA)
    .map((row) => `LEGACY=>${describirProducto(row)}`);
  const bloqueosIdentidad = [...bloqueosDuplicados, ...bloqueosLegacy].slice(0, MAX_BLOQUEOS_EVIDENCIA);

  if (libreria.length !== LIBRERIA_LOTES_ESPERADOS) {
    issues.push(`Librería tiene ${libreria.length} lotes; se esperaban ${LIBRERIA_LOTES_ESPERADOS}.`);
  }
  if (computacion.length !== COMPUTACION_LOTES_ESPERADOS) {
    issues.push(`Computación tiene ${computacion.length} lotes; se esperaban ${COMPUTACION_LOTES_ESPERADOS}.`);
  }
  if (totalLotes !== TOTAL_LOTES_ESPERADOS) {
    issues.push(`La carga inicial tiene ${totalLotes} lotes; se esperaban exactamente ${TOTAL_LOTES_ESPERADOS}.`);
  }
  if (lotesDuplicados !== 0) {
    issues.push(`Hay ${lotesDuplicados} clave(s) de lote repetida(s); no se puede certificar una carga inicial única.`);
  }
  if (lotesInconsistentes !== 0) {
    issues.push(`Hay ${lotesInconsistentes} lotes con inserted + skipped o verified distintos del origen.`);
  }
  if (libreriaSource !== 983 || libreriaVerified !== 983) {
    issues.push(`Librería no coincide con 983/983: ${libreriaSource}/${libreriaVerified}.`);
  }
  if (computacionSource !== 417 || computacionVerified !== 417) {
    issues.push(`Computación no coincide con 417/417: ${computacionSource}/${computacionVerified}.`);
  }
  if (totalSource !== 1400 || totalVerified !== 1400) {
    issues.push(`La carga total no coincide con 1400/1400: ${totalSource}/${totalVerified}.`);
  }
  if (empresasImportadas !== 1 || !empresasImportadasSet.has(empresa.empresa_id)) {
    issues.push("La carga inicial no pertenece exclusivamente a SIGO Administración.");
  }
  if (catalogoProductos < 1400) {
    issues.push(`El catálogo visible tiene ${catalogoProductos} productos; se esperaban al menos 1400.`);
  }
  if (catalogoLeido !== catalogoProductos) {
    issues.push(`La lectura completa obtuvo ${catalogoLeido} productos pero el conteo reporta ${catalogoProductos}.`);
  }
  if (costosActualesNull !== 0) {
    issues.push(`Hay ${costosActualesNull} productos con costo_actual NULL.`);
  }
  if (identidadesDuplicadas !== 0) {
    issues.push(`Hay ${identidadesDuplicadas} códigos repetidos entre productos; el scanner sería ambiguo. Ejemplos: ${bloqueosDuplicados.join(" · ") || "sin detalle"}.`);
  }
  if (legacyDupPendientes !== 0) {
    issues.push(`Hay ${legacyDupPendientes} producto(s) LEGACY-DUP pendiente(s) de revisar contra el código físico antes del go-live. Ejemplos: ${bloqueosLegacy.join(" · ") || "sin detalle"}.`);
  }
  if (productosSinCodigo !== 0) {
    issues.push(`Hay ${productosSinCodigo} productos sin código interno ni código de barras.`);
  }
  if (stockNegativo !== 0) {
    issues.push(`Hay ${stockNegativo} productos con stock negativo.`);
  }
  if (stockNull !== 0) {
    issues.push(`Hay ${stockNull} productos con stock_actual NULL; la caja necesita stock explícito antes del go-live.`);
  }
  if (vendiblesConStock === 0) {
    issues.push("No hay productos activos con código final, precio mayor a cero y stock positivo para una venta de prueba.");
  }

  const ok = issues.length === 0;
  const evidence = [
    ok ? "SIGO_LIVE_READINESS_OK" : "SIGO_LIVE_READINESS_REVIEW",
    `tenant=SIGO Administración`,
    `empresa_id=${empresa.empresa_id}`,
    `libreria=${libreriaVerified}/${libreriaSource}`,
    `libreria_lotes=${libreria.length}/${LIBRERIA_LOTES_ESPERADOS}`,
    `computacion=${computacionVerified}/${computacionSource}`,
    `computacion_lotes=${computacion.length}/${COMPUTACION_LOTES_ESPERADOS}`,
    `total=${totalVerified}/${totalSource}`,
    `total_lotes=${totalLotes}/${TOTAL_LOTES_ESPERADOS}`,
    `duplicate_batch_keys=${lotesDuplicados}`,
    `lotes_inconsistentes=${lotesInconsistentes}`,
    `catalog=${catalogoProductos}`,
    `catalog_loaded=${catalogoLeido}`,
    `costo_actual_null=${costosActualesNull}`,
    `duplicate_codes=${identidadesDuplicadas}`,
    `legacy_dup_pending=${legacyDupPendientes}`,
    `products_without_code=${productosSinCodigo}`,
    `negative_stock=${stockNegativo}`,
    `null_stock=${stockNull}`,
    `sellable_with_stock=${vendiblesConStock}`,
    `test_product_code=${productoPrueba?.codigo ?? "NONE"}`,
    `test_product_stock=${productoPrueba?.stock ?? 0}`,
    `test_product_price=${productoPrueba?.precio ?? 0}`,
    `identity_blockers=${bloqueosIdentidad.length}`,
    `import_tenants=${empresasImportadas}`,
    `checked_at=${checkedAt}`,
  ].join(" ");

  return {
    ok,
    checkedAt,
    empresaId: empresa.empresa_id,
    empresaNombre: empresa.nombre,
    empresasSigoAdministracion: principales.length,
    libreriaSource,
    libreriaVerified,
    libreriaLotes: libreria.length,
    computacionSource,
    computacionVerified,
    computacionLotes: computacion.length,
    totalSource,
    totalVerified,
    totalLotes,
    lotesDuplicados,
    lotesInconsistentes,
    empresasImportadas,
    catalogoProductos,
    catalogoLeido,
    costosActualesNull,
    identidadesDuplicadas,
    legacyDupPendientes,
    productosSinCodigo,
    stockNegativo,
    stockNull,
    vendiblesConStock,
    productoPrueba,
    bloqueosIdentidad,
    issues,
    evidence,
  };
}
