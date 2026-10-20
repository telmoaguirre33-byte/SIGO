import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {P0_EVIDENCE_REVISION} from '../backend/verify-existing-p0-qa.mjs';
// Sonda anónima, sólo GET/OPTIONS. No usa secretos/variables/DB ni inicia sesiones.
const base='https://mayorista-api-qa-qa.up.railway.app',preview='https://comercial-bcv4i798p-telmoaguirre33-byte.vercel.app',integrationPreview='https://comercial-git-integration-sigo-unifi-87fb42-telmoaguirre33-byte.vercel.app',results=[];
let observedDeployedHead;
async function request(path,{method='GET',origin}={}){
 assert.ok(['GET','OPTIONS'].includes(method));
 const response=await fetch(base+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache',...(origin?{Origin:origin}:{}),...(method==='OPTIONS'?{'Access-Control-Request-Method':'GET'}:{})}});
 const text=await response.text();results.push({path,method,status:response.status,allowOrigin:response.headers.get('access-control-allow-origin')});return {response,text};
}
try{
 const health=await request('/health');assert.equal(health.response.status,200);assert.equal(JSON.parse(health.text).status,'ok');
 for(let i=0;i<2;i++){
  const r=await request('/readiness');assert.equal(r.response.status,200);const state=JSON.parse(r.text);
  assert.match(state.head,/^[a-f0-9]{40}$/);if(observedDeployedHead)assert.equal(state.head,observedDeployedHead);else observedDeployedHead=state.head;
  assert.equal(state.evidenceRevision,P0_EVIDENCE_REVISION);assert.equal(state.status,'ready_for_qa');assert.equal(state.productionActivation,false);assert.equal(state.evidenceReused,true);assert.equal(state.p1Schema,'launch-v1');assert.equal(state.source,'synthetic_railway_qa_only');
 }
 for(const path of ['/secure.html','/portal.html','/seller-entry.mjs','/vendedor/secure.mjs','/operational-sw.js']){
  const r=await request(path);assert.equal(r.response.status,200);assert.ok(r.text.length>20);assert.ok(!r.text.includes('-----BEGIN PRIVATE KEY-----'));
  if(path==='/vendedor/secure.mjs'){assert.ok(r.text.includes('sellerCompanies'));assert.ok(!/name=["'](?:empresaId|vendedorId)["'][^>]*type=["']text/i.test(r.text));}
 }
 for(const path of ['/me','/catalog','/orders'])assert.ok([401,403].includes((await request(path)).response.status),'Acceso anónimo debe rechazarse: '+path);
 const allowed=await request('/me',{method:'OPTIONS',origin:preview});assert.ok([200,204].includes(allowed.response.status));assert.equal(allowed.response.headers.get('access-control-allow-origin'),preview);
 const denied=await request('/me',{method:'OPTIONS',origin:'https://untrusted.example'});assert.ok([400,403].includes(denied.response.status));assert.notEqual(denied.response.headers.get('access-control-allow-origin'),'https://untrusted.example');
 const integrationHealth=await request('/integracion-qa/health');assert.equal(integrationHealth.response.status,200);assert.equal(JSON.parse(integrationHealth.text).status,'ok');
 const integration=await request('/integracion-qa/readiness');assert.equal(integration.response.status,200);const state=JSON.parse(integration.text);assert.equal(state.head,observedDeployedHead);assert.equal(state.runtime,'integration-qa');assert.equal(state.schemaVersion,21);assert.equal(state.status,'ready_for_pilot_acceptance');assert.equal(state.productionAcceptance,false);
 const integrationAllowed=await request('/integracion-qa/auth/sigo',{method:'OPTIONS',origin:integrationPreview});assert.equal(integrationAllowed.response.status,204);assert.equal(integrationAllowed.response.headers.get('access-control-allow-origin'),integrationPreview);
 const integrationDenied=await request('/integracion-qa/auth/sigo',{method:'OPTIONS',origin:'https://untrusted.example'});assert.equal(integrationDenied.response.status,403);assert.notEqual(integrationDenied.response.headers.get('access-control-allow-origin'),'https://untrusted.example');
 console.log('PASS Railway QA publicado sólo lectura: health/readiness/HEAD y evidencia persistida, recursos vendedor/portal/offline, API sin sesión rechazada y CORS aprobado/ajeno. Sin login, escrituras ni prueba física.');
}finally{
 console.log('MAYORISTA_QA_READONLY_RESULT='+JSON.stringify({expectedEvidenceRevision:P0_EVIDENCE_REVISION,observedDeployedHead,results,writes:false,authenticatedRolesTested:false,physical:false}));
 await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/published-qa-readonly.json',import.meta.url),JSON.stringify({base,expectedEvidenceRevision:P0_EVIDENCE_REVISION,observedDeployedHead,results,writes:false,authenticatedRolesTested:false,physical:false},null,2));
}
