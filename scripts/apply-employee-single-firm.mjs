import fs from "node:fs";

const path = "src/tenant.ts";
let source = fs.readFileSync(path, "utf8");

if (!source.includes("function filtrarEmpresasVistaEmpleado")) {
  const marker = "export async function cargarMisEmpresas(): Promise<EmpresaOperativa[]> {";
  if (!source.includes(marker)) throw new Error("EMPLOYEE_SINGLE_FIRM_TARGET_NOT_FOUND");
  source = source.replace(marker, `function filtrarEmpresasVistaEmpleado(empresas: EmpresaOperativa[]): EmpresaOperativa[] {
  if (empresas.length <= 1) return empresas;

  const normalizarNombre = (valor: string) => valor.trim().toLocaleLowerCase("es-AR");
  const principal = empresas.find((empresa) =>
    normalizarNombre(empresa.nombre) === "sigo administración"
    || normalizarNombre(empresa.empresa_nombre) === "sigo administración"
  );

  if (!principal) return empresas;

  // Lápiz y Papel y Sertec se crearon como tenants técnicos para la carga histórica.
  // No son firmas separadas para la operación diaria y no deben aparecer en el selector.
  const tenantsTecnicos = new Set(["lápiz y papel", "lapiz y papel", "sertec"]);
  const visibles = empresas.filter((empresa) => {
    const nombre = normalizarNombre(empresa.nombre);
    const nombreVisible = normalizarNombre(empresa.empresa_nombre);
    return !tenantsTecnicos.has(nombre) && !tenantsTecnicos.has(nombreVisible);
  });

  // Mantener visibles otras empresas reales (por ejemplo una cuenta cliente abierta desde Matriz en modo soporte).
  return visibles.length > 0 ? visibles : [principal];
}

${marker}`);
}

source = source.replace(
`  try {\n    return await cargarMisEmpresasUnaVez();`,
`  try {\n    return filtrarEmpresasVistaEmpleado(await cargarMisEmpresasUnaVez());`,
);
source = source.replace(
`    return cargarMisEmpresasUnaVez();\n  }\n}`,
`    return filtrarEmpresasVistaEmpleado(await cargarMisEmpresasUnaVez());\n  }\n}`,
);

fs.writeFileSync(path, source, "utf8");
console.log("SIGO_EMPLOYEE_SINGLE_FIRM_OK");
