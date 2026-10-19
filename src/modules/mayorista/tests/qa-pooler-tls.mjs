import assert from 'node:assert/strict';
import {connect as tcpConnect} from 'node:net';
import {connect as tlsConnect} from 'node:tls';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
// Sonda pública sin credenciales, login, SQL ni acceso a datos. TLS nativo Node del runtime.
const host='aws-0-us-east-2.pooler.supabase.com',port=6543;
const configuredCA=await readFile(new URL('./fixtures/integration-pooler-roots.pem',import.meta.url),'utf8');
async function inspect(ca){
 return new Promise(resolve=>{
  let secure,settled=false;const tcp=tcpConnect({host,port});
  const done=value=>{if(settled)return;settled=true;clearTimeout(timeout);secure?.destroy();tcp.destroy();resolve(value)};
  const timeout=setTimeout(()=>done({ok:false,code:'TIMEOUT'}),10000);
  tcp.once('error',e=>done({ok:false,code:e.code??'TCP_ERROR'}));
  tcp.once('connect',()=>tcp.write(Buffer.from([0,0,0,8,4,210,22,47])));
  tcp.once('data',data=>{
   if(data[0]!==83)return done({ok:false,code:'SSL_NOT_SUPPORTED'});
   secure=tlsConnect({socket:tcp,servername:host,rejectUnauthorized:true,...(ca?{ca}:{})});
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
const restricted=await inspect(configuredCA),nativeTrust=await inspect();
const report={host,port,node:process.version,customBundle:{...restricted,rootPem:undefined},nativeTrust:{...nativeTrust,rootPem:undefined},credentialsUsed:false,sqlExecuted:false};
await mkdir(new URL('./artifacts/',import.meta.url),{recursive:true});
await writeFile(new URL('./artifacts/qa-pooler-tls.json',import.meta.url),JSON.stringify(report,null,2));
if(nativeTrust.rootPem){await writeFile(new URL('./artifacts/qa-pooler-public-root.pem',import.meta.url),nativeTrust.rootPem+'\n');console.log('QA_POOLER_PUBLIC_ROOT_PEM='+JSON.stringify(nativeTrust.rootPem));}
console.log('QA_POOLER_TLS_DIAGNOSTIC='+JSON.stringify(report));
assert.ok(restricted.ok||nativeTrust.ok,'No se pudo acreditar TLS del pooler desde Node; no es una aceptación de datos o de interfaces.');
