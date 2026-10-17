import {verifyExistingP0QA} from './verify-existing-p0-qa.mjs';
/** Readiness acredita salud/configuración QA; nunca declara aceptación comercial. */
export async function qaReadiness({base,operational,head,verifyEvidence=verifyExistingP0QA}){
 if(!/^[a-f0-9]{40}$/.test(head??''))throw Error('HEAD_NOT_VERIFIED');
 const evidence=await verifyEvidence(base);
 const tables=(await operational.query("SELECT to_regclass('mayorista.puesta_marcha') AS launch,to_regclass('mayorista.importaciones') AS imports,to_regclass('mayorista.suscripciones') AS subscription")).rows[0];
 if(!tables?.launch||!tables?.imports||!tables?.subscription)throw Error('LAUNCH_UPGRADE_PENDING');
 return {status:'ready_for_qa',head,evidenceRevision:evidence.evidenceRevision,evidenceReused:true,source:'synthetic_railway_qa_only',p1Schema:'launch-v1',interfaces:'pending_physical',productionActivation:false};
}
