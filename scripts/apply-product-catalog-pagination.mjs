import fs from "node:fs";

const path = "src/productos.ts";
let source = fs.readFileSync(path, "utf8");

const oldBlock = `export async function listarProductosSigo(empresaId: string): Promise<ProductoSigo[]> {
  if (!empresaId) throw new Error("EMPRESA_REQUIRED");

  const { data, error } = await supabase.rpc("listar_productos_sigo", {
    p_empresa_id: empresaId,
  });

  if (error) throw new Error(mensajeErrorBackend(error, "No se pudieron cargar los productos."));
  return (data ?? []) as ProductoSigo[];
}`;

const newBlock = `export async function listarProductosSigo(empresaId: string): Promise<ProductoSigo[]> {
  if (!empresaId) throw new Error("EMPRESA_REQUIRED");

  // PostgREST/Supabase puede limitar una respuesta a 1000 filas. El catálogo de SIGO
  // supera ese tamaño, por eso una sola llamada dejaba productos fuera de Ventas.
  // La función SQL ya ordena por nombre, así que paginamos ese resultado de forma estable.
  const pageSize = 1000;
  const productos: ProductoSigo[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .rpc("listar_productos_sigo", { p_empresa_id: empresaId })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(mensajeErrorBackend(error, "No se pudieron cargar los productos."));

    const pagina = (data ?? []) as ProductoSigo[];
    productos.push(...pagina);
    if (pagina.length < pageSize) break;
  }

  return productos;
}`;

if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, newBlock);
} else if (!source.includes("PostgREST/Supabase puede limitar una respuesta a 1000 filas")) {
  throw new Error("PRODUCT_CATALOG_PAGINATION_TARGET_NOT_FOUND");
}

fs.writeFileSync(path, source, "utf8");
console.log("SIGO_PRODUCT_CATALOG_PAGINATION_OK");
