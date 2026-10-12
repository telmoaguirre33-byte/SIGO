import assert from 'node:assert/strict';
import {createServer,connect} from 'node:tls';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
const dir=await mkdtemp('/tmp/mayorista-tls-');let server;
try{
 const run=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=postgres.railway.internal','-addext','subjectAltName=DNS:postgres.railway.internal'],{stdio:'ignore'});assert.equal(run.status,0);
 const ca=await readFile(path.join(dir,'cert.pem'),'utf8');server=createServer({key:await readFile(path.join(dir,'key.pem')),cert:ca},s=>s.end('qa'));server.on('tlsClientError',()=>{});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const handshake=opts=>new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port:server.address().port,servername:'postgres.railway.internal',rejectUnauthorized:true,...opts});socket.setTimeout(5000,()=>socket.destroy(new Error('TLS timeout')));socket.once('secureConnect',()=>{resolve({authorized:socket.authorized});socket.end();});socket.once('error',e=>{resolve({code:e.code});socket.destroy();});});
 assert.deepEqual(await handshake({ca}),{authorized:true});console.log('PASS TLS real: certificado CA y nombre DNS verificados');
 assert.ok(['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN'].includes((await handshake({})).code));console.log('PASS TLS real: certificado sin CA confiable rechazado');
 assert.equal((await handshake({ca,servername:'otro.railway.internal'})).code,'ERR_TLS_CERT_ALTNAME_INVALID');console.log('PASS TLS real: identidad DNS incorrecta rechazada');
 console.log('3 controles de handshake TLS aprobados en fixture efímero. No prueban todavía Railway desplegado.');
}finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
