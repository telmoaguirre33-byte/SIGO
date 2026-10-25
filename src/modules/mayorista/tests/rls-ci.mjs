import {spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';import path from 'node:path';
// Destino fijo: PostgreSQL efímero del job CI. Nunca lee URL/credenciales de Supabase.
const schema=await readFile(new URL('../../../../docs/mayorista/sql/002_seguridad_preparada_NO_APLICAR.sql',import.meta.url),'utf8');
const proposal=schema.replace(/^begin;$/m,'').replace(/^rollback;.*$/m,'');
const assertions=await readFile(new URL('./rls-assertions.sql',import.meta.url),'utf8');
const bootstrap=`begin;
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable security invoker as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable security invoker as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
grant usage on schema auth to authenticated;
`;
const result=spawnSync('psql',['-h','127.0.0.1','-p','55471','-U','postgres','-d','mayorista_qa','--no-psqlrc','-v','ON_ERROR_STOP=1'],{input:bootstrap+proposal+'\n'+assertions+'\nrollback;\n',encoding:'utf8',env:{...process.env,PGPASSWORD:'mayorista_ci_only'},maxBuffer:4*1024*1024});
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'artifacts');await mkdir(dir,{recursive:true});
await writeFile(path.join(dir,'rls-result.json'),JSON.stringify({date:new Date().toISOString(),host:'127.0.0.1:55471',database:'mayorista_qa',status:result.status===0?'success':'failure',stdout:result.stdout,stderr:result.stderr,error:result.error?.message},null,2));
if(result.error)throw result.error;if(result.status!==0){console.error(result.stderr);process.exit(1);}console.log(result.stdout);console.log('RLS PostgreSQL aislado: 7 controles aprobados. Sin conexión Supabase.');
