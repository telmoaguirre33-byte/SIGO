import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const [matrix, migration] = await Promise.all([
  readFile(path.join(repoRoot, "src/MatrizAdmin.tsx"), "utf8"),
  readFile(path.join(repoRoot, "supabase/migrations/20261013090000_mayorista_modulo_matriz.sql"), "utf8"),
]);
assert.match(matrix, /Agregar módulo Mayorista/, "la acción debe mostrarse en Empresas clientes");
assert.match(matrix, /mayorista_habilitado \? "Mayorista: Activo" : "Agregar módulo Mayorista"/, "la etiqueta debe reflejar el estado");
assert.match(matrix, /p_modulo_clave: "mayorista_distribuidora"/, "la activación debe usar la clave aislada del módulo");
assert.match(matrix, /p_empresa_id: empresa\.empresa_id/, "la activación debe limitarse a la empresa seleccionada");
assert.match(matrix, /disabled=\{!mayoristaDisponible \|\| workingId === empresa\.empresa_id\}/, "debe fallar cerrado si falta la migración");
assert.match(migration, /'mayorista_distribuidora'[\s\S]*true, false, 130/, "el catálogo debe quedar disponible y opcional");
assert.match(migration, /select e\.id, 'mayorista_distribuidora', false/, "el valor inicial debe ser desactivado");
assert.match(migration, /security definer[\s\S]*set search_path = public[\s\S]*AUTH_REQUIRED[\s\S]*SUPERADMIN_REQUIRED/, "la lectura debe requerir sesión y Superadmin");
assert.match(migration, /revoke all on function public\.matriz_listar_mayorista_modulos_sigo\(\) from public/, "el RPC no debe ser público");
console.log("Contrato de toggle Mayorista en Matriz: 9 controles aprobados.");
