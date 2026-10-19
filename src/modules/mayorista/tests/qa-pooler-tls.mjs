import assert from 'node:assert/strict';
import {connect as tcpConnect} from 'node:net';
import {connect as tlsConnect,checkServerIdentity} from 'node:tls';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
// Sonda pública sin credenciales, login, SQL ni acceso a datos. TLS nativo Node del runtime.
const host='aws-0-us-east-2.pooler.supabase.com',port=6543;
const configuredCA=await readFile(new URL('./fixtures/integration-pooler-roots.pem',import.meta.url),'utf8');
const untrustedCA=await readFile(new URL('./fixtures/untrusted-generic-roots.pem',import.meta.url),'utf8');
const ca=new X509Certificate(configuredCA);assert.equal(ca.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');assert.ok(ca.ca&&Date.parse(ca.validTo)>Date.now());
async function inspect(ca,wrongHostname=false){
 return new Promise(resolve=>{
  let secure,settled=false;const tcp=tcpConnect({host,port});
  const done=value=>{if(settled)return;settled=true;clearTimeout(timeout);secure?.destroy();tcp.destroy();resolve(value)};
  const timeout=setTimeout(()=>done({ok:false,code:'TIMEOUT'}),10000);
  tcp.once('error',e=>done({ok:false,code:e.code??'TCP_ERROR'}));
  tcp.once('connect',()=>tcp.write(Buffer.from([0,0,0,8,4,210,22,47])));
  tcp.once('data',data=>{
   if(data[0]!==83)return done({ok:false,code:'SSL_NOT_SUPPORTED'});
   secure=tlsConnect({socket:tcp,servername:host,rejectUnauthorized:true,...(ca?{ca}:{}),...(wrongHostname?{checkServerIdentity:(_,cert)=>checkServerIdentity('unauthorized.invalid',cert)}:{})});
   secure.once('error',e=>done({ok:false,code:e.code??'TLS_ERROR'}));
   secure.once('secureConnect',()=>{
    const peer=secure.getPeerCertificate(true),chain=[],seen=new Set();let c=peer;
    while(c?.raw&&!seen.has(c.fingerprint256)){seen.add(c.fingerprint256);chain.push({subject:c.subject,issuer:c.issuer,fingerprint:c.fingerprint256});if(!c.issuerCertificate||c.issuerCertificate===c)break;c=c.issuerCertificate;}
    let rootPem=null;if(c?.raw){const x=new X509Certificate(c.raw);if(x.checkIssued(x)&&x.verify(x.publicKey))rootPem=x.toString();}
    done({ok:secure.authorized===true,protocol:secure.getProtocol(),chain,rootPem});
   });
  });
 });
}
const restricted=await inspect(configuredCA),untrusted=await inspect(untrustedCA),wrongHostname=await inspect(configuredCA,true);
const report={host,port,node:process.version,customBundle:{...restricted,rootPem:undefined},untrustedBundle:{...untrusted,rootPem:undefined},wrongHostname:{...wrongHostname,rootPem:undefined},providerCaFingerprint:ca.fingerprint256,credentialsUsed:false,sqlExecuted:false};
if(!process.argv.includes('--stdout-only')){await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('./artifacts/qa-pooler-tls.json',import.meta.url),JSON.stringify(report,null,2));}
console.log('QA_POOLER_TLS_DIAGNOSTIC='+JSON.stringify(report));
assert.equal(restricted.ok,true,'La CA oficial debe validar el pooler con hostname estricto');
assert.equal(untrusted.ok,false,'Una CA ajena debe ser rechazada');
assert.equal(wrongHostname.ok,false,'Otro hostname debe ser rechazado');
assert.equal(wrongHostname.code,'ERR_TLS_CERT_ALTNAME_INVALID');
console.log('PASS TLS nativo: CA Supabase oficial y hostname válidos; CA ajena y hostname incorrecto rechazados. Sin autenticación ni SQL.');
