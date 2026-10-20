import {randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function bootstrapIds(env={}){
 const pick=name=>{if(env[name]===undefined)return randomUUID();if(!UUID.test(env[name]))throw new Error('Identificador bootstrap QA inválido');return env[name].toLowerCase();};
 return {empresaId:pick('MAYORISTA_BOOTSTRAP_COMPANY_ID'),userId:pick('MAYORISTA_BOOTSTRAP_USER_ID')};
}
