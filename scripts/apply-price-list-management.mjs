import fs from "node:fs";

const file = new URL("../src/SigoApp.tsx", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const importAnchor = 'import BarcodeScanner from "./BarcodeScanner";';
const importLine = 'import ListaPreciosManager from "./ListaPreciosManager";';
if (!source.includes(importLine)) {
  if (!source.includes(importAnchor)) throw new Error("No se encontró el ancla de importación de BarcodeScanner en SigoApp.tsx");
  source = source.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

// Keep this transformation compatible with section types extended by other features
// (for example Stock vs Inventario). Those additions may appear before this script
// runs in the production build chain.
const sectionTypeMatch = source.match(/^type Section = ([^\n]+);$/m);
if (!sectionTypeMatch) throw new Error("No se encontró la declaración de Section en SigoApp.tsx");
if (!sectionTypeMatch[1].includes('"Lista de precios"')) {
  const updatedSectionType = `type Section = ${sectionTypeMatch[1]} | "Lista de precios";`;
  source = source.replace(sectionTypeMatch[0], updatedSectionType);
}

const sectionsMatch = source.match(/^const sections: Section\[\] = \[([^\n]*)\];$/m);
if (!sectionsMatch) throw new Error("No se encontró la lista de secciones en SigoApp.tsx");
if (!sectionsMatch[1].includes('"Lista de precios"')) {
  const updatedSections = `const sections: Section[] = [${sectionsMatch[1]}, "Lista de precios"];`;
  source = source.replace(sectionsMatch[0], updatedSections);
}

const productosRender = '          {section === "Productos" && <Productos empresaId={empresa.empresa_id} puedeEditar={puedeEditarProductos} />}';
const preciosRender = '          {section === "Lista de precios" && <ListaPreciosPage empresaId={empresa.empresa_id} puedeEditar={puedeEditarProductos} />}';
if (!source.includes(preciosRender)) {
  if (!source.includes(productosRender)) throw new Error("No se encontró el render de Productos en SigoApp.tsx");
  source = source.replace(productosRender, `${productosRender}\n${preciosRender}`);
}

const pendingRenderMatch = source.match(/^([ \t]*\{section !== "Inicio"[^\n]*<Pendiente title=\{section\} \/>\})$/m);
if (!pendingRenderMatch) throw new Error("No se encontró el fallback de secciones pendientes en SigoApp.tsx");
if (!pendingRenderMatch[1].includes('section !== "Lista de precios"')) {
  const updatedPendingRender = pendingRenderMatch[1].replace(
    ' && <Pendiente title={section} />',
    ' && section !== "Lista de precios" && <Pendiente title={section} />',
  );
  source = source.replace(pendingRenderMatch[1], updatedPendingRender);
}

// Si una compilación anterior insertó el administrador dentro del maestro de Productos,
// lo retiramos: Productos y Lista de precios son pantallas separadas por decisión de UX.
const embeddedPriceManager = `      <ListaPreciosManager\n        empresaId={empresaId}\n        productos={productos}\n        puedeEditar={puedeEditar}\n        onUpdated={cargar}\n      />\n\n`;
source = source.replace(embeddedPriceManager, "");

if (!source.includes("function ListaPreciosPage(")) {
  const stockAnchor = 'function Stock({ empresaId }: { empresaId: string }) {';
  if (!source.includes(stockAnchor)) throw new Error("No se encontró el ancla de Stock para crear ListaPreciosPage");

  const page = `function ListaPreciosPage({ empresaId, puedeEditar }: { empresaId: string; puedeEditar: boolean }) {\n  const [productos, setProductos] = useState<ProductoSigo[]>([]);\n  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState(\"\");\n\n  async function cargar() {\n    setLoading(true);\n    setError(\"\");\n    try {\n      setProductos(await listarProductosSigo(empresaId));\n    } catch (err) {\n      setProductos([]);\n      setError(err instanceof Error ? err.message : \"No se pudieron cargar los productos para la lista de precios\");\n    } finally {\n      setLoading(false);\n    }\n  }\n\n  useEffect(() => {\n    void cargar();\n  }, [empresaId]);\n\n  return (\n    <div className=\"products-page\">\n      <div className=\"page-header\">\n        <div>\n          <h2>Lista de precios de venta</h2>\n          <p>Precios, márgenes, exportación y actualizaciones masivas en una pantalla separada del maestro de productos.</p>\n        </div>\n        <button className=\"admin-button\" type=\"button\" onClick={() => void cargar()} disabled={loading}>\n          {loading ? \"Actualizando…\" : \"Actualizar\"}\n        </button>\n      </div>\n\n      {loading && <div className=\"panel\"><p>Cargando lista de precios…</p></div>}\n      {!loading && error && <div className=\"panel\"><h3>No se pudo cargar la lista de precios</h3><p>{error}</p></div>}\n      {!loading && !error && (\n        <ListaPreciosManager\n          empresaId={empresaId}\n          productos={productos}\n          puedeEditar={puedeEditar}\n          onUpdated={cargar}\n        />\n      )}\n    </div>\n  );\n}\n\n`;

  source = source.replace(stockAnchor, `${page}${stockAnchor}`);
}

fs.writeFileSync(file, source);
console.log("SIGO separate Products and Price List pages applied");
