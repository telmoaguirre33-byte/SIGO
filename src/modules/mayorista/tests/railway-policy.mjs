import {test} from 'node:test';import assert from 'node:assert/strict';
import {railwayDatabasePolicy,QA_RAILWAY} from '../railway/database-policy.mjs';
const opts={runtime:{...QA_RAILWAY},databaseUrl:'postgresql://usuario:clave-ficticia@postgres.railway.internal:5432/railway?sslmode=verify-full',caPem:'-----BEGIN CERTIFICATE-----\nficticio-para-validar-config-no-TLS-real\n-----END CERTIFICATE-----',budgetVerified:true,monthlyBudgetUSD:15};
test('Railway requiere comprobación de presupuesto y entorno autorizado',()=>{for(const change of [{budgetVerified:false},{monthlyBudgetUSD:16},{runtime:{...QA_RAILWAY,projectId:'otro'}},{runtime:{...QA_RAILWAY,environmentId:'otro'}},{runtime:{...QA_RAILWAY,databaseServiceId:'otro'}}])assert.throws(()=>railwayDatabasePolicy({...opts,...change}));});
test('Railway limita destino a la instancia privada y prohíbe opciones TLS inseguras',()=>{for(const url of ['postgresql://u:p@produccion.example/railway','postgresql://u:p@postgres.railway.internal/otra','postgresql://u:p@postgres.railway.internal:6432/railway','postgresql://u:p@postgres.railway.internal/railway?sslmode=require','postgresql://u:p@postgres.railway.internal/railway?sslmode=no-verify','postgresql://u:p@postgres.railway.internal/railway?sslrootcert=/otra','postgresql://u:p@postgres.railway.internal/railway#x'])assert.throws(()=>railwayDatabasePolicy({...opts,databaseUrl:url}));});
test('Railway exige CA, identidad de host, validación TLS y conexiones acotadas',()=>{assert.throws(()=>railwayDatabasePolicy({...opts,caPem:''}));const p=railwayDatabasePolicy(opts);p.assertPool({options:{...p.config}});for(const change of [{ssl:{...p.config.ssl,rejectUnauthorized:false}},{ssl:{...p.config.ssl,servername:'otro'}},{ssl:{...p.config.ssl,ca:'otra'}},{max:7},{password:'otra'}])assert.throws(()=>p.assertPool({options:{...p.config,...change}}));assert.equal(p.config.connectionString,undefined);});

import {acceptanceNamespace} from '../railway/acceptance-namespace.mjs';
test('Aceptación QA conserva base y aísla esquemas incluso en funciones y search_path',()=>{
 const options={database:'railway'},pool=acceptanceNamespace({options},'mayorista_acceptance_012345abcdef');
 assert.equal(pool.options,options);
 assert.equal(pool.rewrite("CREATE SCHEMA auth; SET search_path=public; SELECT public.f(), auth.uid(); GRANT USAGE ON SCHEMA mayorista TO authenticated; SELECT 'mayorista_private.x'"),"CREATE SCHEMA mayorista_acceptance_012345abcdef_auth; SET search_path=mayorista_acceptance_012345abcdef_public; SELECT mayorista_acceptance_012345abcdef_public.f(), mayorista_acceptance_012345abcdef_auth.uid(); GRANT USAGE ON SCHEMA mayorista_acceptance_012345abcdef_module TO authenticated; SELECT 'mayorista_acceptance_012345abcdef_private.x'");
 for(const command of ['CREATE DATABASE otro','DROP DATABASE railway','ALTER DATABASE railway RENAME TO otro'])assert.throws(()=>pool.rewrite(command));
 assert.throws(()=>acceptanceNamespace({options},'public'));
});
