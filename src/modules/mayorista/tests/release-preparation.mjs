/** Revisión local de artefactos. No importa clientes DB, no usa red y no aplica SQL. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const manifest=JSON.parse(await read('docs/mayorista/preproduccion/inventario-migraciones.json'));
export async function verifyInventory(input){
 assert.equal(input.classification,'review_inventory_not_executable_migrations');
 assert.equal(input.productionApproved,false);assert.equal(input.autoApply,false);assert.equal(input.target,null);
 assert.match(input.sourceHead,/^[a-f0-9]{40}$/);assert.match(input.mainReviewed,/^[a-f0-9]{40}$/);
 assert.equal(input.sources.length,20);const seen=new Set();
 for(const [i,item] of input.sources.entries()){
  assert.equal(item.order,i+1);assert.equal(item.dependsOnPrevious,i>0);
  assert.ok(/^(docs\/mayorista\/sql\/|src\/modules\/mayorista\/)/.test(item.path));
  assert.ok(!item.path.includes('..')&&!seen.has(item.path)&&!input.excluded.includes(item.path));seen.add(item.path);
  assert.ok(item.path.endsWith('.sql'));assert.equal(item.productionStatus,'blocked_pending_versioned_conversion_and_real_schema_rehearsal');
  const bytes=await readFile(new URL(item.path,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,'Deriva de artefacto: '+item.path);
 }
}
await verifyInventory(manifest);
const changed=structuredClone(manifest);changed.sources[0].sha256='0'.repeat(64);await assert.rejects(()=>verifyInventory(changed));
const duplicate=structuredClone(manifest);duplicate.sources[1].path=duplicate.sources[0].path;await assert.rejects(()=>verifyInventory(duplicate));
const seed=structuredClone(manifest);seed.sources[0].path=manifest.excluded[0];await assert.rejects(()=>verifyInventory(seed));
const enabled=structuredClone(manifest);enabled.productionApproved=true;await assert.rejects(()=>verifyInventory(enabled));
for(const name of ['preflight-lectura.sql','postflight-lectura.sql']){
 const sql=(await read('docs/mayorista/preproduccion/'+name)).replace(/--[^\n]*/g,'');
 assert.match(sql,/BEGIN\s+TRANSACTION\s+READ\s+ONLY/i);assert.match(sql,/ROLLBACK\s*;/i);
 assert.ok(!/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO)\b/i.test(sql));
}
// La preparación nunca desactiva los gates QA para hacer parecer publicable el servidor.
const runtime=await read('src/modules/mayorista/backend/railway-runtime.mjs'),server=await read('src/modules/mayorista/backend/server.mjs');
assert.ok(runtime.includes("MAYORISTA_QA_ENABLED!=='true'"));assert.ok(server.includes('assertInstalledQA(pool)'));
console.log('PASS preproducción: 20 fuentes SQL con hash/orden, deriva y semillas rechazadas, consultas sólo lectura y gates QA conservados. NO acredita migraciones productivas aplicables.');
