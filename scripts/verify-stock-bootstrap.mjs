import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const baseName = "20260912230000_stock_import_base.sql";
const repairName = "20260912230030_stock_import_single_tenant_fix.sql";
const constraintsName = "20260912230040_stock_import_constraints_and_collisions.sql";
const finalName = "20260912231600_stock_import_verify.sql";
const productCreateName = "20260912235500_productos_alta_costos_cero.sql";
const libreriaNames = Array.from({ length: 10 }, (_, index) => `2026091223${String(index + 1).padStart(2, "0")}00_stock_libreria_${String(index + 1).padStart(2, "0")}.sql`);
const sertecNames = Array.from({ length: 5 }, (_, index) => `2026091223${String(index + 11).padStart(2, "0")}00_stock_sertec_${String(index + 1).padStart(2, "0")}.sql`);
const files = [baseName, repairName, constraintsName, ...libreriaNames, ...sertecNames, finalName, productCreateName];

for (const file of files) {
  const full = path.join(migrationsDir, file);
  if (!fs.existsSync(full)) throw new Error(`Missing stock bootstrap migration: ${file}`);
}

// Supabase identifies migrations by the leading timestamp. Two files with the same
// version make production deployment ambiguous and must never reach main again.
const versions = new Map();
for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
  const match = file.match(/^(\d{14})_/);
  if (!match) continue;
  const same = versions.get(match[1]) ?? [];
  same.push(file);
  versions.set(match[1], same);
}
for (const [version, same] of versions) {
  if (same.length > 1) throw new Error(`Duplicate Supabase migration version ${version}: ${same.join(", ")}`);
}

const read = (file) => fs.readFileSync(path.join(migrationsDir, file), "utf8");
const base = read(baseName);
const repair = read(repairName);
const constraints = read(constraintsName);
const finalVerify = read(finalName);
const productCreate = read(productCreateName);
const libreria = libreriaNames.map(read).join("\n");
const sertec = sertecNames.map(read).join("\n");
const all = [base, repair, constraints, libreria, sertec, finalVerify, productCreate].join("\n");

function payloadRows(text) {
  return [...text.matchAll(/\$stock\$\n([\s\S]*?)\n\$stock\$/g)]
    .flatMap((match) => match[1].split("\n"))
    .filter((line) => line.trim().length > 0);
}

const libreriaRows = payloadRows(libreria);
const sertecRows = payloadRows(sertec);

if (libreriaRows.length !== 983) throw new Error(`Librería bootstrap row count mismatch: ${libreriaRows.length}/983`);
if (sertecRows.length !== 417) throw new Error(`Sertec bootstrap row count mismatch: ${sertecRows.length}/417`);
if (libreriaRows.length + sertecRows.length !== 1400) throw new Error("Stock bootstrap total must remain exactly 1400 rows");

for (const [label, rows] of [["Librería", libreriaRows], ["Sertec", sertecRows]]) {
  rows.forEach((line, index) => {
    const columns = line.split("\t");
    if (columns.length !== 9) throw new Error(`${label} row ${index + 1} has ${columns.length}/9 columns`);
    if (!columns[2].trim()) throw new Error(`${label} row ${index + 1} has no product name`);
    if (!columns[0].trim() && !columns[1].trim()) throw new Error(`${label} row ${index + 1} has no barcode/internal code`);
  });
}

for (const pattern of [
  /delete\s+from\s+public\.productos/i,
  /truncate\s+(table\s+)?public\.productos/i,
  /update\s+public\.productos\s+set\s+stock_actual/i,
]) {
  if (pattern.test(all)) throw new Error(`Destructive stock bootstrap pattern detected: ${pattern}`);
}

for (const required of [
  "sigo_importaciones_stock",
  "not exists",
  "verified_rows",
  "SIGO_STOCK_IMPORT_FINAL_OK",
  "LEGACY-6934274135608-328",
]) {
  if (!all.includes(required)) throw new Error(`Missing stock bootstrap safeguard: ${required}`);
}

for (const required of [
  "SIGO Administración",
  "request.jwt.claim.sub",
  "activa = false",
  "tenant único SIGO Administración",
]) {
  if (!repair.includes(required)) throw new Error(`Missing single-tenant stock repair safeguard: ${required}`);
}

for (const required of [
  "LEGACY-DUP-",
  "greatest(v_stock, 0)",
  "Código de origen repetido/no disponible para unicidad",
  "v_insert_codigo_interno",
]) {
  if (!constraints.includes(required)) throw new Error(`Missing legacy-constraint/collision safeguard: ${required}`);
}

for (const required of [
  "coalesce(p_stock_minimo, 0)",
  "greatest(coalesce(p_stock_actual, 0), coalesce(p_stock_minimo, 0))",
  "p_stock_minimo is not null",
  "p_stock_maximo is not null",
]) {
  if (!productCreate.includes(required)) throw new Error(`Product create/edit can violate legacy stock thresholds: ${required}`);
}

for (const required of [
  "v_empresas_importadas <> 1",
  "SIGO_STOCK_IMPORT_FINAL_TENANT_SPLIT_DETECTED",
  "Librería=983/983 Computación=417/417 Total=1400/1400 tenant=1",
]) {
  if (!finalVerify.includes(required)) throw new Error(`Missing final single-tenant verification: ${required}`);
}

for (const sentinel of [
  "\t0281\tCABLE NETMAK VGA 3M\t15600\t0",
  "1113060410601\t\tCable USB CA IPHONE\t7600\t3",
  "\t0290\tBoos chager\t27500\t0",
  "\tGN122BXL\tcartucho 122 negro\t52020\t1",
  "\t2EQI9400DS002\tmouse inalambrico yexa\t16000\t2",
  "\t0304\tauricular chico samsung\t3000\t3",
]) {
  if (!sertec.includes(sentinel)) throw new Error(`Sertec source safeguard missing/corrupt: ${sentinel}`);
}

console.log("Stock bootstrap verified: unique migration versions, one SIGO Administración tenant, Librería 983 + Computación 417 = 1400, collisions preserved and legacy stock constraints honored.");
