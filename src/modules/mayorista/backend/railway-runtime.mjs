import {createPrivateKey,createPublicKey} from 'node:crypto';
import {railwayDatabasePolicy,QA_RAILWAY} from '../railway/database-policy.mjs';
import {ApiError} from '../api/receive-order.mjs';
export function railwayRuntime(env){
 if(env.MAYORISTA_QA_ENABLED!=='true')throw new ApiError(503,'Mayorista QA está desactivado');
 const policy=railwayDatabasePolicy({runtime:{projectId:env.RAILWAY_PROJECT_ID,environmentId:env.RAILWAY_ENVIRONMENT_ID,databaseServiceId:env.MAYORISTA_DATABASE_SERVICE_ID},databaseUrl:env.DATABASE_URL,caPem:env.MAYORISTA_DB_CA_PEM,budgetVerified:env.MAYORISTA_BUDGET_VERIFIED==='true',monthlyBudgetUSD:Number(env.MAYORISTA_MONTHLY_BUDGET_USD)});
 let origin;try{const u=new URL(env.MAYORISTA_PUBLIC_ORIGIN);if(u.protocol!=='https:'||u.origin!==env.MAYORISTA_PUBLIC_ORIGIN)throw new Error();origin=u.origin;}catch{throw new ApiError(503,'Origen HTTPS independiente obligatorio');}
 let privateKey;try{privateKey=createPrivateKey(env.MAYORISTA_AUTH_PRIVATE_KEY);if(privateKey.asymmetricKeyType!=='ed25519')throw new Error();}catch{throw new ApiError(503,'Clave de autenticación Ed25519 no configurada');}
 return {policy,origin,privateKey,publicKey:createPublicKey(privateKey),issuer:'sigo-mayorista-qa-'+QA_RAILWAY.projectId};
}
export async function assertInstalledQA(pool){
 const row=(await pool.query('SELECT project_id,environment_id,schema_version FROM mayorista_private.infrastructure_binding WHERE id=true')).rows[0];
 if(row?.project_id!==QA_RAILWAY.projectId||row.environment_id!==QA_RAILWAY.environmentId||row.schema_version!==1)throw new ApiError(503,'Base no instalada para este QA independiente');
}
