import {acceptanceNamespace,installAcceptanceNamespace} from '../railway/acceptance-namespace.mjs';
import {verifySharedCommerceSQL} from './shared-commerce-sql.mjs';
import {verifySharedBackend} from './shared-backend.mjs';
import {verifySharedFiscal} from './shared-fiscal.mjs';
import {verifyBusinessTypeSQL} from './business-type-sql.mjs';
import assert from 'node:assert/strict';import pg from '../backend/node_modules/pg/lib/index.js';import {schemaPackage} from '../railway/schema-package.mjs';import {QA_RAILWAY} from '../railway/database-policy.mjs';
/** Esquemas efímeros en la MISMA base CI; no crea bases ni usa Railway. */
export async function verifySchemaPackage(pool){
 const o=pool.options;assert.equal(o.host,'127.0.0.1');assert.equal(Number(o.port),55471);assert.equal(o.database,'mayorista_qa');const name='mayorista_acceptance_000000000001';let fixture,created=false;
 try{fixture=acceptanceNamespace(new pg.Pool({host:o.host,port:o.port,user:o.user,password:o.password,database:o.database,max:2}),name);await installAcceptanceNamespace(fixture,await schemaPackage(),[QA_RAILWAY.projectId,QA_RAILWAY.environmentId]);created=true;
 const row=(await fixture.query('SELECT schema_version FROM mayorista_private.infrastructure_binding')).rows[0];assert.equal(row.schema_version,1);
 const tables=(await fixture.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'",[fixture.schemas.mayorista])).rows;assert.ok(tables.length>=20);assert.ok(tables.every(t=>t.relrowsecurity&&t.relforcerowsecurity));console.log('PASS paquete SQL completo instala tablas propias con RLS habilitado/forzado en esquemas vacíos');return [{name:'Paquete SQL de instalación QA completo en esquemas efímeros vacíos',status:'pass'},...await verifyBusinessTypeSQL(fixture),...await verifySharedCommerceSQL(fixture),...await verifySharedBackend(fixture),...await verifySharedFiscal(fixture)];
 }finally{if(fixture)await fixture.end();if(created)for(const schema of Object.values(fixture.schemas))await pool.query('DROP SCHEMA '+schema+' CASCADE');}
}
