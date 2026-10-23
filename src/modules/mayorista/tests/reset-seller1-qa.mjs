import assert from 'node:assert/strict';
import {randomUUID,scryptSync} from 'node:crypto';
import pg from '../backend/node_modules/pg/lib/index.js';
import {acceptanceNamespace} from '../railway/acceptance-namespace.mjs';
import {passwordRecord} from '../security/isolated-auth.mjs';
import {resetSeller1QA,runResetSeller1QA,RESET_OPERATION,RESET_COMPANY} from '../backend/reset-seller1-qa.mjs';

const pool=acceptanceNamespace(new pg.Pool({host:'127.0.0.1',port:55471,database:'mayorista_qa',user:'postgres',password:'mayorista_ci_only',max:2}),'mayorista_acceptance_'+randomUUID().replaceAll('-','').slice(0,12));
const user=randomUUID(),other=randomUUID(),seller=randomUUID(),session=randomUUID();
const record={operation:RESET_OPERATION,...await passwordRecord('clave-de-fixture-ci-20261017')};
try{
 await pool.query(`CREATE SCHEMA mayorista_private;CREATE SCHEMA mayorista;CREATE SCHEMA public;
  CREATE TABLE mayorista_private.qa_interactive_scope(id boolean primary key,external_empresa_id uuid,qa_empresa_id uuid);
  CREATE TABLE mayorista_private.qa_demo_manifest(version int,empresa_id uuid,datos jsonb);
  CREATE TABLE mayorista_private.usuarios(user_id uuid primary key,email text,salt text,password_hash text,activo boolean);
  CREATE TABLE mayorista_private.qa_local_accounts(user_id uuid primary key,empresa_id uuid,activo boolean);
  CREATE TABLE mayorista.miembros(user_id uuid,empresa_id uuid,vendedor_id uuid,rol text,activo boolean);
  CREATE TABLE mayorista_private.sesiones(session_id uuid,user_id uuid,empresa_id uuid,revocada boolean);
  CREATE TABLE mayorista_private.qa_live_journal(run_id text,step text,request jsonb,response jsonb,primary key(run_id,step));
  CREATE TABLE public.commercial_sentinel(datos jsonb);INSERT INTO public.commercial_sentinel VALUES(' {"orders":17,"sales":16,"stock":9972,"cash":16,"balance":1234} ');`);
 await pool.query('INSERT INTO mayorista_private.qa_interactive_scope VALUES(true,$1,$2)',['8728d172-7c1b-4de3-88ae-c20fc19c1fce',RESET_COMPANY]);
 await pool.query('INSERT INTO mayorista_private.qa_demo_manifest VALUES(1,$1,$2)',[RESET_COMPANY,{namespace:pool.acceptanceNamespace,accounts:[{email:'vendedor1@distribuidora.qa.invalid',rol:'vendedor',userId:user,vendedorId:seller}]}]);
 for(const [id,email] of [[user,'vendedor1@distribuidora.qa.invalid'],[other,'otro@distribuidora.qa.invalid']]){
  await pool.query('INSERT INTO mayorista_private.usuarios VALUES($1,$2,$3,$4,true)',[id,email,'original-salt','original-hash']);
  await pool.query('INSERT INTO mayorista_private.qa_local_accounts VALUES($1,$2,true)',[id,RESET_COMPANY]);
  await pool.query('INSERT INTO mayorista.miembros VALUES($1,$2,$3,$4,true)',[id,RESET_COMPANY,seller,'vendedor']);
  await pool.query('INSERT INTO mayorista_private.sesiones VALUES($1,$2,$3,false)',[id===user?session:randomUUID(),id,RESET_COMPANY]);
 }
 const snapshot=async()=>({commercial:(await pool.query('SELECT * FROM public.commercial_sentinel')).rows,other:(await pool.query('SELECT * FROM mayorista_private.usuarios WHERE user_id=$1',[other])).rows,otherSessions:(await pool.query('SELECT * FROM mayorista_private.sesiones WHERE user_id=$1',[other])).rows});
 const before=await snapshot();
 await assert.rejects(runResetSeller1QA({}),/autorización/);
 await assert.rejects(resetSeller1QA({...pool,acceptanceNamespace:'public'},record),/aislados/);
 await assert.rejects(resetSeller1QA(pool,{...record,operation:'other'}),/inválido/);
 await pool.query('UPDATE mayorista_private.qa_local_accounts SET activo=false WHERE user_id=$1',[user]);
 await assert.rejects(resetSeller1QA(pool,record),/revocada/);
 await pool.query('UPDATE mayorista_private.qa_local_accounts SET activo=true WHERE user_id=$1',[user]);
 await pool.query('INSERT INTO mayorista.miembros VALUES($1,$2,$3,$4,true)',[user,randomUUID(),seller,'vendedor']);
 await assert.rejects(resetSeller1QA(pool,record),/compartida/);
 await pool.query('DELETE FROM mayorista.miembros WHERE user_id=$1 AND empresa_id<>$2',[user,RESET_COMPANY]);
 assert.equal((await resetSeller1QA(pool,record)).status,'pass');
 const target=(await pool.query('SELECT salt,password_hash FROM mayorista_private.usuarios WHERE user_id=$1',[user])).rows[0];
 assert.equal(scryptSync('clave-de-fixture-ci-20261017',target.salt,64).toString('hex'),target.password_hash);
 assert.equal((await pool.query('SELECT revocada FROM mayorista_private.sesiones WHERE session_id=$1',[session])).rows[0].revocada,true);
 assert.deepEqual(await snapshot(),before);
 assert.equal((await resetSeller1QA(pool,record)).status,'already_applied');
 await assert.rejects(resetSeller1QA(pool,{...record,...await passwordRecord('otra-clave-de-fixture-ci')}),/divergente/);
 assert.equal(Number((await pool.query('SELECT count(*) AS n FROM mayorista_private.qa_live_journal')).rows[0].n),1);
 assert.deepEqual(await snapshot(),before);
 console.log('PASS restablecimiento QA limitado a Vendedor 1, hash verificado, revocación propia, una ejecución, cuentas ajenas y movimientos intactos');
}finally{
 for(const schema of Object.values(pool.schemas))await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>{});
 await pool.end();
}
