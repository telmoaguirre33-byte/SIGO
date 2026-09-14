import fs from "node:fs";

const path = "src/tenant.ts";
let source = fs.readFileSync(path, "utf8");

if (!source.includes("function filtrarEmpresasVistaEmpleado")) {
  const marker = "export async function cargarMisEmpresas(): Promise<EmpresaOperativa[]> {";
  if (!source.includes(marker)) throw new Error("EMPLOYEE_SINGLE_FIRM_TARGET_NOT_FOUND");
  source = source.replace(marker, `function filtrarEmpresasVistaEmpleado(empresas: EmpresaOperativa[]): EmpresaOperativa[] {
  if (empresas.length <= 1) return empresas;

  // Owner/admin mantienen la vista multiempresa para soporte y administración.
  const usuarioAdministrativo = empresas.some((empresa) => empresa.rol === "owner" || empresa.rol === "admin");
  if (usuarioAdministrativo) return empresas;

  // Para vendedor/depósito/cliente, las empresas técnicas usadas para importar stock
  // no deben aparecer como negocios distintos. Si existe la firma operativa principal,
  // el empleado trabaja siempre allí y accede a su catálogo consolidado.
  const principal = empresas.find((empresa) =>
    empresa.nombre.trim().toLocaleLowerCase("es-AR") === "sigo administración"
    || empresa.empresa_nombre.trim().toLocaleLowerCase("es-AR") === "sigo administración"
  );

  return principal ? [principal] : empresas;
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
