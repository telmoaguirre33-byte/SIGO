import {bootstrapIds} from './bootstrap-identity.mjs';
import pg from 'pg';import {schemaPackage} from '../railway/schema-package.mjs';import {railwayRuntime} from './railway-runtime.mjs';import {QA_RAILWAY} from '../railway/database-policy.mjs';import {passwordRecord} from '../security/isolated-auth.mjs';
/** Comando explícito para QA autorizado; nunca se invoca al iniciar ni compilar. */
const config=railwayRuntime(process.env),pool=new pg.Pool(config.policy.config),client=await pool.connect();
try{
 await client.query('BEGIN');
 const existing=(await client.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') AND table_schema NOT LIKE 'pg_%'")).rows;
 if(existing.length)throw new Error('La instalación inicial exige una base vacía; no se reemplazan datos ni esquemas');
 await client.query(await schemaPackage());await client.query('INSERT INTO mayorista_private.infrastructure_binding VALUES(true,$1,$2,1)',[QA_RAILWAY.projectId,QA_RAILWAY.environmentId]);
 const email=process.env.MAYORISTA_BOOTSTRAP_EMAIL,nombre=process.env.MAYORISTA_BOOTSTRAP_NAME,companyName=process.env.MAYORISTA_BOOTSTRAP_COMPANY_NAME;if(!email||!/^\S+@\S+\.\S+$/.test(email)||!nombre||!companyName)throw new Error('Faltan datos iniciales');
 const {empresaId,userId}=bootstrapIds(process.env),secret=await passwordRecord(process.env.MAYORISTA_BOOTSTRAP_PASSWORD);
 await client.query('INSERT INTO mayorista.empresas VALUES($1,$2,$3)',[empresaId,companyName,process.env.MAYORISTA_BOOTSTRAP_ENABLE_COMPANY==='true']);await client.query('INSERT INTO mayorista_private.usuarios(user_id,email,nombre,salt,password_hash) VALUES($1,$2,$3,$4,$5)',[userId,email.trim().toLowerCase(),nombre,secret.salt,secret.hash]);await client.query("INSERT INTO mayorista.miembros(empresa_id,user_id,vendedor_id,rol) VALUES($1,$2,null,'gerencia')",[empresaId,userId]);await client.query('COMMIT');console.log(JSON.stringify({empresaId,userId,enabled:process.env.MAYORISTA_BOOTSTRAP_ENABLE_COMPANY==='true'}));
}catch{await client.query('ROLLBACK');console.error('MAYORISTA_QA_PREPARATION_BLOCKED');process.exitCode=1;}finally{client.release();await pool.end();}
