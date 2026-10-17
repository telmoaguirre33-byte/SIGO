import {QA_RAILWAY} from '../railway/database-policy.mjs';
export async function assertSharedFixture(pool){
 const o=pool.options;
 if(!/^mayorista_acceptance_[a-f0-9]{12}$/.test(pool.acceptanceNamespace??''))throw Error('Esquemas aislados obligatorios');
 if(o.host==='127.0.0.1'&&Number(o.port)===55471&&o.database==='mayorista_qa')return;
 if(o.host!=='postgres.railway.internal'||Number(o.port)!==5432||!['railway','mayorista_qa'].includes(o.database)||o.application_name!=='sigo-mayorista-qa-acceptance'||o.ssl?.rejectUnauthorized!==true)throw Error('Fixture compartido fuera de QA autorizado');
 const b=(await pool.query('SELECT project_id,environment_id FROM mayorista_private.infrastructure_binding WHERE id=true')).rows[0];
 if(b?.project_id!==QA_RAILWAY.projectId||b?.environment_id!==QA_RAILWAY.environmentId)throw Error('Fixture QA sin identidad verificada');
}
