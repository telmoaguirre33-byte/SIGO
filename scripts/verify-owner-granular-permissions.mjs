import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = path.join(root, "supabase", "migrations", "20260913223000_permisos_owner_configurables.sql");
const apiPath = path.join(root, "src", "usuarios.ts");
const modalPath = path.join(root, "src", "PermisosUsuarioModal.tsx");
const usersPath = path.join(root, "src", "UsuariosOperativos.tsx");
const productsMigrationPath = path.join(root, "supabase", "migrations", "20260913203500_desactivar_servicios_no_vendibles.sql");

for (const file of [migrationPath, apiPath, modalPath, usersPath, productsMigrationPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing granular permission file: ${path.relative(root, file)}`);
}

const migration = fs.readFileSync(migrationPath, "utf8");
const api = fs.readFileSync(apiPath, "utf8");
const modal = fs.readFileSync(modalPath, "utf8");
const users = fs.readFileSync(usersPath, "utf8");
const products = fs.readFileSync(productsMigrationPath, "utf8");

for (const required of [
  "actualizar_permisos_usuario_empresa_sigo",
  "v_actor_rol is distinct from 'owner'",
  "OWNER_PERMISSION_REQUIRED",
  "OWNER_MEMBERSHIP_IMMUTABLE",
  "PERMISSION_GRANT_FORBIDDEN",
  "permisos_extra = v_extra",
  "permisos_denegados = v_denegados",
]) {
  if (!migration.includes(required)) throw new Error(`Owner permission backend safeguard missing: ${required}`);
}

if (!api.includes("actualizarPermisosUsuarioEmpresaSigo")) throw new Error("Granular permission API missing");
for (const required of [
  "Ver costos / precios de compra",
  "Ver márgenes y rentabilidad",
  "Ver listas de precios",
  "Ocultar costos y rentabilidad",
  "Ver compras",
  "Configurar ARCA",
  "Administrar usuarios",
]) {
  if (!modal.includes(required)) throw new Error(`Permission UI missing: ${required}`);
}

if (!users.includes("PermisosUsuarioModal") || !users.includes("Control del Propietario")) {
  throw new Error("Owner granular permission editor not wired into Usuarios");
}

for (const required of [
  "tiene_permiso_empresa(p_empresa_id, 'costs.read')",
  "tiene_permiso_empresa(p_empresa_id, 'margins.read')",
]) {
  if (!products.includes(required)) throw new Error(`Sensitive product masking missing: ${required}`);
}

console.log("Owner granular permissions verified: owner-only overrides, explicit denies and sensitive product masking are protected by CI.");
