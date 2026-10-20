import {createHash} from 'node:crypto';

const name=/^[a-z_][a-z0-9_]*$/;
const q=s=>{if(!name.test(s))throw Error('FIXTURE_IDENTIFIER_INVALID:'+s);return '"'+s+'"';};
// Esquemas validados sin comillas: acceptanceNamespace reescribe public./auth.
const relation=r=>{if(!['public','auth'].includes(r.schema))throw Error('FIXTURE_SCHEMA_NOT_ALLOWED');return r.schema+'.'+q(r.table);};
const key=r=>r.schema+'.'+r.table;
const stable=s=>createHash('sha256').update(s).digest('hex');

export function mergeProductionSnapshots(snapshots,catalog){
 const schema={};
 const identity=(collection,r)=>collection==='columns'?key(r)+'.'+r.name:collection==='functions'?r.signature:collection==='types'||collection==='sequences'?r.schema+'.'+r.name:key(r)+'.'+r.name;
 for(const snapshot of snapshots){
  if(snapshot?.readOnly!==true||snapshot.businessRowsExported!==0)throw Error('SCHEMA_ONLY_SNAPSHOT_REQUIRED');
  for(const [collection,rows] of Object.entries(snapshot.schema??{})){
   if(!Array.isArray(rows))throw Error('SCHEMA_COLLECTION_REQUIRED:'+collection);
   schema[collection]??=[];
   for(const r of rows){const previous=schema[collection].find(x=>identity(collection,x)===identity(collection,r));if(previous){if(JSON.stringify(previous)!==JSON.stringify(r))throw Error('SCHEMA_DUPLICATE_DRIFT:'+identity(collection,r));}else schema[collection].push(r);}
  }
 }
 if(catalog){schema.relations=catalog.sections.section_05;schema.policies=catalog.sections.section_09;schema.schemas=catalog.sections.section_10;}
 return {readOnly:true,businessRowsExported:0,schema};
}

/** Sólo metadata sin filas. No abre conexiones, no toma URLs ni credenciales de entorno. */
export function inspectProductionSnapshot(snapshot){
 if(snapshot?.readOnly!==true||snapshot.businessRowsExported!==0)throw Error('SCHEMA_ONLY_SNAPSHOT_REQUIRED');
 const s=snapshot.schema;
 for(const collection of ['columns','constraints','indexes','triggers','functions'])if(!Array.isArray(s?.[collection]))throw Error('SCHEMA_COLLECTION_REQUIRED:'+collection);
 const tables=new Set(s.columns.map(key));
 const functions=new Set(s.functions.map(f=>f.schema+'.'+f.name));
 const types=new Set((s.types??[]).map(t=>t.schema+'.'+t.name));
 const missingTables=new Set(),missingFunctions=new Set(),missingTypes=new Set();
 for(const c of s.columns){
  if(!['public','auth'].includes(c.schema)||!name.test(c.name)||!name.test(c.table))throw Error('FIXTURE_SCHEMA_NOT_ALLOWED');
  for(const m of c.type.matchAll(/\b(auth|public)\.([a-z_][a-z0-9_]*)/gi))if(!types.has(m[0]))missingTypes.add(m[0]);
 }
 for(const r of [...s.constraints,...s.functions]){
  for(const m of r.definition.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO|REFERENCES)\s+(public|auth)\.([a-z_][a-z0-9_]*)/gi))if(!tables.has(m[1]+'.'+m[2]))missingTables.add(m[1]+'.'+m[2]);
  for(const m of r.definition.matchAll(/\b(public|auth)\.([a-z_][a-z0-9_]*)\s*\(/gi)){
   const symbol=m[1]+'.'+m[2];
   // Una referencia de FK también tiene paréntesis; no es llamada a función.
   if(!functions.has(symbol)&&!tables.has(symbol)&&!missingTables.has(symbol)&&!/\bREFERENCES\s*$/i.test(r.definition.slice(Math.max(0,m.index-15),m.index)))missingFunctions.add(symbol);
  }
 }
 // pg_get_constraintdef no califica funciones si su search_path permite resolverlas.
 if(s.constraints.some(c=>/\bpermisos_sigo_validos\s*\(/i.test(c.definition))&&!functions.has('public.permisos_sigo_validos'))missingFunctions.add('public.permisos_sigo_validos');
 if((s.policies??[]).some(p=>/\bes_owner_empresa\s*\(/.test((p.qual??'')+' '+(p.with_check??'')))&&!functions.has('public.es_owner_empresa'))missingFunctions.add('public.es_owner_empresa');
 const blockers={tables:[...missingTables].sort(),functions:[...missingFunctions].sort(),types:[...missingTypes].sort()};
 return {tables:tables.size,columns:s.columns.length,functions:s.functions.length,triggers:s.triggers.length,constraints:s.constraints.length,indexes:s.indexes.length,blockers,ready:Object.values(blockers).every(a=>a.length===0),sourceSha256:stable(JSON.stringify(snapshot))};
}

export function buildProductionFixture(snapshot){
 const review=inspectProductionSnapshot(snapshot);
 if(!review.ready){const e=Error('PRODUCTION_SCHEMA_DEPENDENCIES_MISSING');e.review=review;throw e;}
 const s=snapshot.schema,groups=new Map();
 for(const c of s.columns){const k=key(c);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
 const ddl=['CREATE SCHEMA public','CREATE SCHEMA auth'];
 for(const t of s.types??[]){
  if(t.kind!=='enum'||!Array.isArray(t.labels))throw Error('FIXTURE_TYPE_UNSUPPORTED');
  if(!['public','auth'].includes(t.schema))throw Error('FIXTURE_SCHEMA_NOT_ALLOWED');
  ddl.push('CREATE TYPE '+t.schema+'.'+q(t.name)+' AS ENUM ('+t.labels.map(x=>"'"+String(x).replaceAll("'","''")+"'").join(',')+')');
 }
 for(const cols of groups.values()){
  cols.sort((a,b)=>a.ordinal-b.ordinal);
  ddl.push('CREATE TABLE '+relation(cols[0])+' ('+cols.map(c=>{
   let sql=q(c.name)+' '+c.type;
   if(c.collation&&c.collation!=='"default"')sql+=' COLLATE '+c.collation;
   if(c.generated){if(c.generated!=='s'||!c.default)throw Error('FIXTURE_GENERATED_UNSUPPORTED');sql+=' GENERATED ALWAYS AS ('+c.default+') STORED';}
   if(c.identity){
    if(!['a','d'].includes(c.identity))throw Error('FIXTURE_IDENTITY_UNSUPPORTED');
    sql+=' GENERATED '+(c.identity==='a'?'ALWAYS':'BY DEFAULT')+' AS IDENTITY';
    const seq=(s.sequences??[]).find(seq=>seq.schema===c.schema&&seq.name===c.table+'_'+c.name+'_seq');
    if(seq){
     for(const k of ['start','increment','min','max','cache'])if(typeof seq[k]!=='string'||!/^[-]?[0-9]+$/.test(seq[k]))throw Error('FIXTURE_SEQUENCE_INTEGER_STRING_REQUIRED');
     sql+=' (START WITH '+seq.start+' INCREMENT BY '+seq.increment+' MINVALUE '+seq.min+' MAXVALUE '+seq.max+' CACHE '+seq.cache+' '+(seq.cycle?'CYCLE':'NO CYCLE')+')';
    }
   }
   if(c.not_null)sql+=' NOT NULL';
   return sql;
  }).join(',')+')');
 }
 // Funciones SQL pueden depender entre sí; installProductionFixture reintenta sólo
 // errores de resolución, y falla si una pasada no progresa. No sustituye cuerpos.
 const functions=s.functions.map(f=>{
  if(!/^CREATE OR REPLACE FUNCTION (?:public|auth)\./.test(f.definition))throw Error('FIXTURE_FUNCTION_DDL_INVALID');
  return {...f,sql:f.definition.replace(/SET search_path TO 'public'/g,'SET search_path=public').replace(/SET search_path TO 'auth'/g,'SET search_path=auth')};
 });
 const after=[];
 for(const c of s.columns)if(c.default&&!c.generated&&!c.identity)after.push('ALTER TABLE '+relation(c)+' ALTER COLUMN '+q(c.name)+' SET DEFAULT '+c.default);
 // Las FK requieren PK/UNIQUE de todos los destinos ya instaladas.
 for(const c of [...s.constraints.filter(c=>c.kind!=='f'),...s.constraints.filter(c=>c.kind==='f')])after.push('ALTER TABLE '+relation(c)+' ADD CONSTRAINT '+q(c.name)+' '+c.definition);
 const constraintIndexes=new Set(s.constraints.filter(c=>['p','u','x'].includes(c.kind)).map(c=>c.schema+'.'+c.name));
 for(const i of s.indexes)if(!constraintIndexes.has(i.name))after.push(i.definition);
 for(const t of s.triggers){
  if(t.enabled!=='O')throw Error('FIXTURE_TRIGGER_STATE_REQUIRES_EXPLICIT_HANDLING:'+t.name);
  after.push(t.definition);
 }
 const security=[];
 const roleSql=r=>r===''||r==='public'?'PUBLIC':q(r);
 const grants=(acl,object,allowed)=>{
  security.push('REVOKE ALL ON '+object+' FROM PUBLIC,anon,authenticated');
  for(const entry of acl??[]){
   const m=/^([^=]*)=([^/]+)\//.exec(entry);if(!m)throw Error('FIXTURE_ACL_UNSUPPORTED');
   if(!['','anon','authenticated'].includes(m[1]))continue;
   const privileges=[...m[2].replaceAll('*','')].map(c=>allowed[c]);
   if(privileges.some(p=>!p))throw Error('FIXTURE_ACL_PRIVILEGE_UNSUPPORTED');
   security.push('GRANT '+privileges.join(',')+' ON '+object+' TO '+roleSql(m[1]));
  }
 };
 for(const n of s.schemas??[]){
  if(!['public','auth'].includes(n.nspname))continue;
  grants(n.nspacl,'SCHEMA '+n.nspname,{U:'USAGE',C:'CREATE'});
 }
 for(const t of s.relations??[]){
  if(!groups.has(t.name))continue;
  security.push('ALTER TABLE '+t.name+(t.relrowsecurity?' ENABLE':' DISABLE')+' ROW LEVEL SECURITY');
  security.push('ALTER TABLE '+t.name+(t.relforcerowsecurity?' FORCE':' NO FORCE')+' ROW LEVEL SECURITY');
  grants(t.relacl,'TABLE '+t.name,{r:'SELECT',a:'INSERT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN'});
 }
 for(const p of s.policies??[]){
  if(!groups.has(p.schemaname+'.'+p.tablename))continue;
  let sql='CREATE POLICY '+q(p.policyname)+' ON '+p.schemaname+'.'+q(p.tablename)+' FOR '+p.cmd+' TO '+p.roles.map(roleSql).join(',');
  if(p.qual!==null)sql+=' USING ('+p.qual+')';
  if(p.with_check!==null)sql+=' WITH CHECK ('+p.with_check+')';
  security.push(sql);
 }
 for(const f of s.functions)grants(f.acl??['=X/fixture_owner'],'FUNCTION '+f.signature,{X:'EXECUTE'});
 return {review,ddl,functions,after,security,ownerMapping:'CI owns exported objects as postgres; functional bodies, RLS and anon/authenticated grants reproduced. Production owner identities and grant options require separate gate.'};
}

/** client debe ser acceptanceNamespace con cuatro schemas aleatorios del ensayo. */
export async function installProductionFixture(client,snapshot){
 if(!/^mayorista_acceptance_[a-f0-9]{12}$/.test(client.acceptanceNamespace??''))throw Error('ISOLATED_ACCEPTANCE_NAMESPACE_REQUIRED');
 const plan=buildProductionFixture(snapshot);
 await client.query('SET search_path=public,pg_catalog');
 for(const sql of plan.ddl)await client.query(sql);
 let pending=plan.functions;
 while(pending.length){
  const retry=[];let progressed=0;
  for(const f of pending){try{await client.query(f.sql);progressed++;}catch(e){if(['42P01','42883','42704'].includes(e.code))retry.push(f);else throw e;}}
  if(!progressed)throw Error('FIXTURE_FUNCTION_DEPENDENCY_UNRESOLVED:'+retry.map(f=>f.signature).join(','));
  pending=retry;
 }
 for(const sql of plan.after)await client.query(sql);
 for(const sql of plan.security)await client.query(sql);
 await client.query('RESET search_path');
 return {...plan.review,ownerMapping:plan.ownerMapping};
}
