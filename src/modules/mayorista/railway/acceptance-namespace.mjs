/** Adaptador exclusivo de fixtures QA: conserva conexión y base originales.
 * Las plantillas SQL confiables se instalan en cuatro esquemas propios.
 * Nunca aceptar SQL ni nombres de esquema enviados desde HTTP. */
export function acceptanceNamespace(pool, name){
 if(!/^mayorista_acceptance_[a-f0-9]{12}$/.test(name))throw Error('Namespace QA inválido');
 const schemas=Object.freeze({public:name+'_public',auth:name+'_auth',mayorista:name+'_module',mayorista_private:name+'_private'});
 const rewrite=text=>{
  if(typeof text!=='string'||/\b(?:CREATE|DROP|ALTER)\s+DATABASE\b/i.test(text))throw Error('Operación de base no permitida en aceptación QA');
  return text.replace(/\b(public|auth|mayorista|mayorista_private)\./gi,(_,s)=>schemas[s.toLowerCase()]+'.')
   .replace(/(\bSCHEMA\s+)(public|auth|mayorista|mayorista_private)\b/gi,(_,prefix,s)=>prefix+schemas[s.toLowerCase()])
   .replace(/(\bsearch_path\s*=\s*)(public|auth|mayorista|mayorista_private)\b/gi,(_,prefix,s)=>prefix+schemas[s.toLowerCase()]);
 };
 const query=(target,input,...args)=>target.query(typeof input==='string'?rewrite(input):{...input,text:rewrite(input.text)},...args);
 return Object.freeze({options:pool.options,acceptanceNamespace:name,schemas,rewrite,
  query:(...args)=>query(pool,...args),
  connect:async()=>{const client=await pool.connect();return {query:(...args)=>query(client,...args),release:()=>client.release()};},
  end:()=>pool.end()
 });
}
export async function installAcceptanceNamespace(pool, sql, binding){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('CREATE SCHEMA public; REVOKE ALL ON SCHEMA public FROM PUBLIC,anon,authenticated; GRANT USAGE ON SCHEMA public TO authenticated');
  await client.query(sql);
  await client.query('INSERT INTO mayorista_private.infrastructure_binding VALUES(true,$1,$2,1)',binding);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
