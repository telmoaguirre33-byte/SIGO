import {verifyBusinessTypeSQL} from './business-type-sql.mjs';
import assert from 'node:assert/strict';import pg from '../backend/node_modules/pg/lib/index.js';import {schemaPackage} from '../railway/schema-package.mjs';import {QA_RAILWAY} from '../railway/database-policy.mjs';
/** Un segundo DB efímero en la MISMA instancia CI; no crea servicios ni usa Railway. */
export async function verifySchemaPackage(pool){
 const o=pool.options;assert.equal(o.host,'127.0.0.1');assert.equal(Number(o.port),55471);assert.equal(o.database,'mayorista_qa');const name='mayorista_package_ci';let fixture,created=false;
 try{await pool.query('CREATE DATABASE mayorista_package_ci');created=true;fixture=new pg.Pool({host:o.host,port:o.port,user:o.user,password:o.password,database:name,max:2});await fixture.query('BEGIN');await fixture.query(await schemaPackage());await fixture.query('INSERT INTO mayorista_private.infrastructure_binding VALUES(true,$1,$2,1)',[QA_RAILWAY.projectId,QA_RAILWAY.environmentId]);await fixture.query('COMMIT');
 const row=(await fixture.query('SELECT schema_version FROM mayorista_private.infrastructure_binding')).rows[0];assert.equal(row.schema_version,1);
 const tables=(await fixture.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mayorista' AND c.relkind='r'")).rows;assert.ok(tables.length>=20);assert.ok(tables.every(t=>t.relrowsecurity&&t.relforcerowsecurity));console.log('PASS paquete SQL completo instala tablas propias con RLS habilitado/forzado en base vacía');return [{name:'Paquete SQL de instalación QA completo en DB efímero vacío',status:'pass'},...await verifyBusinessTypeSQL(fixture)];
 }finally{if(fixture)await fixture.end();if(created)await pool.query('DROP DATABASE mayorista_package_ci');}
}
