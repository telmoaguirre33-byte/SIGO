import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectProductionSnapshot,buildProductionFixture,mergeProductionSnapshots} from './production-schema-fixture.mjs';
const root=resolve(process.argv[2]??'.'),file=resolve(process.argv[3]??new URL('./production-schema.fixture.json',import.meta.url).pathname);
const snapshot=JSON.parse(await readFile(file,'utf8'));
const {acceptanceNamespace}=await import(pathToFileURL(resolve(root,'src/modules/mayorista/railway/acceptance-namespace.mjs')).href);
const plan=buildProductionFixture(snapshot),rewriter=acceptanceNamespace({options:{}},'mayorista_acceptance_012345abcdef');
assert.equal(plan.review.ready,true);assert.equal(plan.review.tables,23);assert.equal(plan.review.triggers,15);
assert.ok(plan.ddl.some(s=>s.includes('MAXVALUE 9223372036854775807')));
const firstFk=plan.after.findIndex(s=>s.includes(' FOREIGN KEY '));
assert.ok(firstFk>0);assert.ok(plan.after.slice(firstFk).every(s=>!s.includes(' PRIMARY KEY ')&&!s.includes(' UNIQUE (')));
for(const sql of [...plan.ddl,...plan.functions.map(f=>f.sql),...plan.after,...plan.security]){
 const rewritten=rewriter.rewrite(sql);
 assert.ok(!/\b(?:public|auth)\./i.test(rewritten),'unrewritten schema reference');
 assert.ok(!/\bCREATE SCHEMA (?:public|auth)\b/i.test(rewritten));
}
assert.throws(()=>inspectProductionSnapshot({...snapshot,businessRowsExported:1}),/SCHEMA_ONLY_SNAPSHOT_REQUIRED/);
const missingType=structuredClone(snapshot);missingType.schema.types=missingType.schema.types.filter(t=>t.name!=='oauth_client_type');
assert.equal(inspectProductionSnapshot(missingType).ready,false);assert.throws(()=>buildProductionFixture(missingType),/PRODUCTION_SCHEMA_DEPENDENCIES_MISSING/);
const duplicate=structuredClone(snapshot);duplicate.schema.columns[0].type='text';
assert.throws(()=>mergeProductionSnapshots([snapshot,duplicate]),/SCHEMA_DUPLICATE_DRIFT/);
console.log('PASS schema fixture: metadata-only gate, dependency closure, exact bigint sequence, FK ordering, isolated namespace rewrite and drift rejection');
