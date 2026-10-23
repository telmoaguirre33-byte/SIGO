import {ApiError} from '../api/receive-order.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Sólo configuración de servidor. undefined conserva QA/mocks; el runtime comercial exige lista. */
export function createCompanyAllowlist(allowedCompanyIds){
 if(allowedCompanyIds===undefined)return Object.freeze({ids:undefined,allows:()=>true,assertAllowed:()=>{}});
 if(!Array.isArray(allowedCompanyIds)||!allowedCompanyIds.length||allowedCompanyIds.some(id=>typeof id!=='string'||!UUID.test(id)))throw new ApiError(503,'Empresas comerciales no configuradas');
 const ids=allowedCompanyIds.map(id=>id.toLowerCase());
 if(new Set(ids).size!==ids.length)throw new ApiError(503,'Empresas comerciales no configuradas');
 const allowed=new Set(ids),allows=id=>typeof id==='string'&&allowed.has(id.toLowerCase());
 return Object.freeze({ids:Object.freeze(ids),allows,assertAllowed(id){if(!allows(id))throw new ApiError(403,'Empresa fuera de la habilitación comercial');}});
}
