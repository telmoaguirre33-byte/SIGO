import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const cfg=JSON.parse(readFileSync('/private/config.json','utf8'));
const mode=process.argv[2], payload='SIGO synthetic storage recovery — no commercial data\n';
const sha=s=>createHash('sha256').update(s).digest('hex');
async function request(url,token,method='GET',body,extra={}){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}
 return {status:r.status,data};
}
async function login(email){
 const r=await request('http://auth:9999/token?grant_type=password',cfg.anon,'POST',{email,password:cfg.password});
 assert.equal(r.status,200,'real Auth password login');
 assert.ok(r.data.access_token);assert.ok(r.data.refresh_token);
 return {id:r.data.user.id,token:r.data.access_token};
}
if(mode==='seed-auth'){
 for(const email of ['owner@recovery.invalid','other@recovery.invalid']){
  const r=await request('http://auth:9999/admin/users',cfg.service,'POST',{email,password:cfg.password,email_confirm:true});
  assert.equal(r.status,200,'real GoTrue admin user creation');
 }
 const a=await login('owner@recovery.invalid'),b=await login('other@recovery.invalid');
 writeFileSync('/private/source-users.json',JSON.stringify({a,b}));
 console.log('PASS: real Auth users, password hashing and signed sessions');
}else{
 const a=await login('owner@recovery.invalid'),b=await login('other@recovery.invalid');
 for(const u of [a,b]){
  const r=await request('http://rest:3000/sigo_recovery_probe?select=user_id,label',u.token);
  assert.equal(r.status,200);assert.equal(r.data.length,1);assert.equal(r.data[0].user_id,u.id);
  const rpc=await request('http://rest:3000/rpc/sigo_recovery_count',u.token,'POST',{});
  assert.equal(rpc.status,200);assert.equal(rpc.data,1);
 }
 const denied=await request('http://rest:3000/sigo_recovery_probe',a.token,'PATCH',{user_id:b.id});
 assert.ok([400,403].includes(denied.status),'RLS WITH CHECK rejects cross-owner reassignment');
 const anon=await request('http://rest:3000/sigo_recovery_probe?select=id',cfg.anon);
 assert.ok(anon.status===401||anon.status===403||anon.status===200&&anon.data.length===0);
 const bad=await request('http://auth:9999/user',a.token.slice(0,-8)+'badtoken');
 assert.ok([401,403].includes(bad.status),'real Auth rejects corrupted JWT');
 if(mode==='seed-storage'){
  const bucket=await request('http://storage:5000/bucket',cfg.service,'POST',{id:'synthetic-recovery',name:'synthetic-recovery',public:false});
  assert.equal(bucket.status,200);
  const upload=await request('http://storage:5000/object/synthetic-recovery/demo.txt',a.token,'POST',payload,{'Content-Type':'text/plain'});
  assert.equal(upload.status,200,'real Storage API upload with RLS');
 }else{
  const old=JSON.parse(readFileSync('/private/source-users.json','utf8'));
  assert.equal(old.a.id,a.id,'restored Auth identity preserved');
  assert.ok([401,403].includes((await request('http://auth:9999/user',old.a.token)).status),'source JWT rejected by fresh destination key');
  assert.equal((await request('http://rest:3000/sigo_recovery_probe',old.a.token)).status,401);
  const wrong=await request('http://auth:9999/token?grant_type=password',cfg.anon,'POST',{email:'owner@recovery.invalid',password:'wrong-synthetic-password'});
  assert.equal(wrong.status,400);
 }
 const gateway=await request('http://api-gw:8000/auth/v1/user',a.token,'GET',undefined,{apikey:cfg.anon});
 assert.equal(gateway.status,200,'gateway Auth route with correct API key');
 const gatewayRows=await request('http://api-gw:8000/rest/v1/sigo_recovery_probe?select=user_id',a.token,'GET',undefined,{apikey:cfg.anon});
 assert.equal(gatewayRows.status,200);assert.equal(gatewayRows.data.length,1);
 const file=await request('http://storage:5000/object/authenticated/synthetic-recovery/demo.txt',a.token);
 assert.equal(file.status,200);assert.equal(sha(file.data),sha(payload),'restored Storage bytes SHA256');
 const other=await request('http://storage:5000/object/authenticated/synthetic-recovery/demo.txt',b.token);
 assert.notEqual(other.status,200,'private Storage cross-tenant denial');
 const edge=await fetch('http://functions:9000/health',{signal:AbortSignal.timeout(5000)});
 assert.equal(edge.status,200);assert.equal(await edge.text(),'synthetic-edge-ok');
 console.log('PASS: real Auth/PostgREST/RLS/RPC/Storage bytes and access controls; synthetic Edge runtime');
}
