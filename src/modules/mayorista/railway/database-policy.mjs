import {ApiError} from '../api/receive-order.mjs';
export const QA_RAILWAY=Object.freeze({projectId:'b9a7da94-1d87-46fe-b4da-c7e241ebe185',environmentId:'2addc3e9-f088-42df-a72c-c233fd4308cb',databaseServiceId:'9120b029-d20c-4073-a9cc-003953f60817'});
/** Configuración de servidor, nunca recibida desde HTTP ni publicada en la PWA.
 * Solo private networking en el proyecto QA explícito; sin proxy TCP público.
 * Se eliminan opciones DSN que pg podría usar para sobrescribir TLS. */
export function railwayDatabasePolicy({runtime,databaseUrl,caPem,budgetVerified=false,monthlyBudgetUSD=15}={}){
 if(budgetVerified!==true||monthlyBudgetUSD!==15)throw new ApiError(503,'Presupuesto Railway pendiente de verificar');
 if(runtime?.projectId!==QA_RAILWAY.projectId||runtime.environmentId!==QA_RAILWAY.environmentId)throw new ApiError(503,'Entorno Railway no autorizado');
 if(runtime.databaseServiceId!==QA_RAILWAY.databaseServiceId)throw new ApiError(503,'Instancia PostgreSQL no autorizada');
 let url;try{url=new URL(databaseUrl);}catch{throw new ApiError(503,'Conexión PostgreSQL no configurada');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='postgres.railway.internal'||url.port&&url.port!=='5432'||url.hash||!url.username||!url.password||!['/railway','/mayorista_qa'].includes(url.pathname))throw new ApiError(503,'Destino PostgreSQL fuera del QA privado');
 for(const [k,v] of url.searchParams)if(k!=='sslmode'||v!=='verify-full')throw new ApiError(503,'Opciones TLS del DSN no autorizadas');
 if(typeof caPem!=='string'||!caPem.includes('-----BEGIN CERTIFICATE-----'))throw new ApiError(503,'Certificado CA verificado obligatorio');
 const config=Object.freeze({host:url.hostname,port:5432,database:url.pathname.slice(1),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:Object.freeze({ca:caPem,rejectUnauthorized:true,servername:url.hostname}),max:6,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,application_name:'sigo-mayorista-qa'});
 return Object.freeze({config,assertPool(pool){const o=pool?.options;if(!o||o.host!==config.host||Number(o.port)!==5432||o.database!==config.database||o.user!==config.user||o.password!==config.password||o.ssl?.rejectUnauthorized!==true||o.ssl.servername!==config.host||o.ssl.ca!==caPem||!Number.isInteger(o.max)||o.max<1||o.max>6)throw new ApiError(503,'Pool PostgreSQL ajeno a la configuración QA verificada');}});
}
