const DB='sigo-mayorista-secure-v1',encoder=new TextEncoder(),decoder=new TextDecoder();
const scopeKey=s=>JSON.stringify([s.empresaId,s.vendedorId]);
const safeIdentity=i=>({empresaId:i.empresaId,vendedorId:i.vendedorId,userId:i.userId,...(Number.isFinite(i.expiresAt??i.sessionValidUntil)?{sessionValidUntil:i.expiresAt??i.sessionValidUntil}:{}),...(i.fuenteComercial==='sigo'?{fuenteComercial:'sigo'}:{}),...(typeof i.nombre==='string'&&i.nombre.length<=160?{nombre:i.nombre}:{}),...(typeof i.empresaNombre==='string'&&i.empresaNombre.length<=160?{empresaNombre:i.empresaNombre}:{})});
function validOffline(identity,scope,now,maxHours=168){const age=now-Date.parse(identity.offlineValidatedAt);if(!Number.isFinite(now)||!Number.isFinite(maxHours)||maxHours<=0||maxHours>168||identity.empresaId!==scope.empresaId||identity.vendedorId!==scope.vendedorId||!identity.userId||!Number.isFinite(age)||age< -300000||age>maxHours*3600000||Number.isFinite(identity.sessionValidUntil)&&now>=identity.sessionValidUntil)throw new Error('El acceso offline requiere renovar la validación online');}
const aad=(s,kind,id,revision)=>encoder.encode(JSON.stringify([DB,s.empresaId,s.vendedorId,kind,id,revision]));
async function keyFor(password,salt){
  if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('La clave local requiere entre 12 y 256 caracteres');
  const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:new Uint8Array(salt),iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function open(){return new Promise((resolve,reject)=>{if(!globalThis.indexedDB)return reject(new Error('IndexedDB no disponible'));const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('profiles',{keyPath:'scope'});const s=r.result.createObjectStore('records',{keyPath:'key'});s.createIndex('byScopeKind',['scope','kind']);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Cerrá otras pestañas para actualizar el almacén cifrado'));});}
async function read(store,key){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');let value;const r=tx.objectStore(store).get(key);r.onsuccess=()=>{value=r.result};tx.oncomplete=()=>resolve(value??null);tx.onabort=tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
// Solo metadatos de alcance ya existentes. No revela la identidad cifrada ni autentica.
export async function offlineProfiles(){
 const db=await open();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('profiles','readonly');let rows=[];const r=tx.objectStore('profiles').getAll();r.onsuccess=()=>{rows=r.result;};
  tx.oncomplete=()=>resolve(rows.flatMap(p=>{try{const s=JSON.parse(p.scope);return p.version===1&&Array.isArray(s)&&s.length===2&&s.every(x=>typeof x==='string'&&x.length>0&&x.length<200)?[{empresaId:s[0],vendedorId:s[1]}]:[];}catch{return [];}}));tx.onabort=tx.onerror=()=>reject(tx.error);
 });}finally{db.close();}
}
async function encrypt(key,scope,kind,id,revision,data){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(scope,kind,id,revision)},key,encoder.encode(JSON.stringify(data)));return {iv:Array.from(iv),ciphertext:Array.from(new Uint8Array(bytes))};}
async function decrypt(key,scope,kind,id,revision,envelope){if(!Array.isArray(envelope?.iv)||envelope.iv.length!==12||!Array.isArray(envelope.ciphertext)||envelope.ciphertext.length<16||envelope.ciphertext.length>8*1024*1024)throw new Error('Registro cifrado inválido');try{return JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(envelope.iv),additionalData:aad(scope,kind,id,revision)},key,new Uint8Array(envelope.ciphertext))));}catch{throw new Error('Clave incorrecta o registro alterado');}}
/** Ninguna clave, contraseña, token, cliente o precio se persiste en texto claro.
 * Los metadatos de alcance/UUID/revisión permiten CAS, no contienen datos comerciales. */
export class EncryptedWorkspace{
  #key=null;#scope;#generation=0;
  constructor(scope){if(!scope?.empresaId||!scope?.vendedorId)throw new Error('Ámbito obligatorio');this.#scope=Object.freeze({empresaId:scope.empresaId,vendedorId:scope.vendedorId});}
  get scope(){return {...this.#scope};}
  get unlocked(){return this.#key!==null;}
  lock(){this.#generation++;this.#key=null;}
  /** CryptoKey no exportable, clonado por IndexedDB y protegido por el perfil del navegador.
   * No equivale a un enclave hardware: requiere bloqueo seguro del teléfono. */
  async initializeDevice(identity,password){
    if(identity?.empresaId!==this.#scope.empresaId||identity.vendedorId!==this.#scope.vendedorId||!identity.userId||typeof password!=='string'||!password||password.length>256)throw Error('Identidad o contraseña inválida');
    this.lock();const generation=this.#generation,raw=crypto.getRandomValues(new Uint8Array(32)),key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']),salt=Array.from(crypto.getRandomValues(new Uint8Array(16)));
    const recovery=await encrypt(await keyFor('sigo-device-recovery-v2:'+password,salt),this.#scope,'device','recovery',1,Array.from(raw));raw.fill(0);
    const profile={scope:scopeKey(this.#scope),version:1,deviceOnly:true,salt,recovery,deviceKey:key,
      verifier:await encrypt(key,this.#scope,'profile','identity',1,{...safeIdentity(identity),offlineValidatedAt:new Date().toISOString()})};
    const db=await open();try{await new Promise((resolve,reject)=>{const t=db.transaction('profiles','readwrite'),s=t.objectStore('profiles'),r=s.get(profile.scope);r.onsuccess=()=>{if(r.result)t.abort();else s.add(profile);};t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(t.error??Error('El almacén existente se conserva: desbloquealo una vez'));});}finally{db.close();}
    if(generation!==this.#generation)throw Error('Preparación cancelada');this.#key=key;return safeIdentity(identity);
  }
  async unlockDeviceOnline(password,identity){
    if(identity?.empresaId!==this.#scope.empresaId||identity.vendedorId!==this.#scope.vendedorId||!identity.userId)throw Error('Identidad ajena');
    this.lock();const generation=this.#generation,profile=await read('profiles',scopeKey(this.#scope));if(!profile) return this.initializeDevice(identity,password);
    let key=profile.deviceKey;
    if(!key&&profile.deviceOnly){const raw=await decrypt(await keyFor('sigo-device-recovery-v2:'+password,profile.salt),this.#scope,'device','recovery',1,profile.recovery);key=await crypto.subtle.importKey('raw',new Uint8Array(raw),{name:'AES-GCM'},false,['encrypt','decrypt']);}
    if(!key)throw Error('Para conservar tus pedidos anteriores, ingresá su clave local una sola vez');
    const previous=await decrypt(key,this.#scope,'profile','identity',1,profile.verifier);if(previous.userId!==identity.userId)throw Error('El vendedor del almacén no coincide');
    if(generation!==this.#generation)throw Error('Apertura cancelada');this.#key=key;await this.refreshIdentity(identity);await this.rememberDevice();return safeIdentity(identity);
  }
  async rememberDevice(){
    const key=this.#key,generation=this.#generation;if(!key||key.extractable)throw Error('Desbloqueá primero el dispositivo');
    const db=await open();try{await new Promise((resolve,reject)=>{const t=db.transaction('profiles','readwrite'),s=t.objectStore('profiles'),r=s.get(scopeKey(this.#scope));r.onsuccess=()=>{if(!r.result||generation!==this.#generation)t.abort();else s.put({...r.result,deviceKey:key});};t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(t.error??Error('Vinculación cancelada'));});}finally{db.close();}
  }
  async forgetDevice(){
    const db=await open();try{await new Promise((resolve,reject)=>{const t=db.transaction('profiles','readwrite'),s=t.objectStore('profiles'),r=s.get(scopeKey(this.#scope));r.onsuccess=()=>{if(r.result){const {deviceKey,...profile}=r.result;s.put(profile);}};t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(t.error);});}finally{db.close();this.lock();}
  }
  async unlockDevice(options={}){
    this.lock();const generation=this.#generation,profile=await read('profiles',scopeKey(this.#scope)),key=profile?.deviceKey;
    if(!key||key.extractable||key.algorithm?.name!=='AES-GCM')throw Error('Prepará el acceso de este teléfono una vez');
    const identity=await decrypt(key,this.#scope,'profile','identity',1,profile.verifier);
    validOffline(identity,this.#scope,options.now??Date.now(),options.maxOfflineHours??168);
    if(generation!==this.#generation)throw Error('Apertura cancelada');this.#key=key;return identity;
  }
  async initialize(password,identity){
    if(identity?.empresaId!==this.#scope.empresaId||identity.vendedorId!==this.#scope.vendedorId||!identity.userId)throw new Error('Identidad fuera del ámbito');
    this.lock();const generation=this.#generation,salt=Array.from(crypto.getRandomValues(new Uint8Array(16))),key=await keyFor(password,salt);
    const verifier=await encrypt(key,this.#scope,'profile','identity',1,{...safeIdentity(identity),offlineValidatedAt:new Date().toISOString()});
    const db=await open();try{await new Promise((resolve,reject)=>{const t=db.transaction('profiles','readwrite'),s=t.objectStore('profiles'),r=s.get(scopeKey(this.#scope));let error;r.onsuccess=()=>{if(r.result){error=new Error('El dispositivo ya tiene un almacén: desbloquealo, no lo reemplaces');t.abort();}else s.add({scope:scopeKey(this.#scope),version:1,salt,verifier});};t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(error??t.error);});}finally{db.close();}
    if(generation!==this.#generation)throw new Error('Desbloqueo cancelado');this.#key=key;return identity;
  }
  async unlock(password,{now=Date.now(),maxOfflineHours=168}={}){
    this.lock();const generation=this.#generation,profile=await read('profiles',scopeKey(this.#scope));if(profile?.version!==1||profile.salt?.length!==16)throw new Error('No hay almacén de este vendedor en el dispositivo');
    const key=await keyFor(password,profile.salt),identity=await decrypt(key,this.#scope,'profile','identity',1,profile.verifier);
    validOffline(identity,this.#scope,now,maxOfflineHours);
    if(generation!==this.#generation)throw new Error('Desbloqueo cancelado');this.#key=key;return identity;
  }
  /** Solo llamar después de una autenticación online verificada; renueva también un perfil vencido. */
  async unlockOnline(password,identity){
    if(identity?.empresaId!==this.#scope.empresaId||identity.vendedorId!==this.#scope.vendedorId||!identity.userId)throw new Error('Identidad ajena');
    this.lock();const generation=this.#generation,profile=await read('profiles',scopeKey(this.#scope));
    if(!profile) return this.initialize(password,identity);
    const key=await keyFor(password,profile.salt);const previous=await decrypt(key,this.#scope,'profile','identity',1,profile.verifier);if(previous.userId!==identity.userId)throw Error('Identidad ajena al almacén');
    if(generation!==this.#generation)throw new Error('Desbloqueo cancelado');this.#key=key;await this.refreshIdentity(identity);return safeIdentity(identity);
  }
  async refreshIdentity(identity){
    const key=this.#key,generation=this.#generation;if(!key)throw new Error('Almacén bloqueado');if(identity.empresaId!==this.#scope.empresaId||identity.vendedorId!==this.#scope.vendedorId||!identity.userId)throw new Error('Identidad ajena');
    const profile=await read('profiles',scopeKey(this.#scope)),verifier=await encrypt(key,this.#scope,'profile','identity',1,{...safeIdentity(identity),offlineValidatedAt:new Date().toISOString()});
    if(generation!==this.#generation)throw new Error('Almacén bloqueado');
    const db=await open();try{await new Promise((resolve,reject)=>{const t=db.transaction('profiles','readwrite'),store=t.objectStore('profiles'),r=store.get(scopeKey(this.#scope));let error;r.onsuccess=()=>{if(generation!==this.#generation||JSON.stringify(r.result?.salt)!==JSON.stringify(profile.salt)){error=new Error('Perfil cambió durante la renovación');t.abort();return;}store.put({...profile,verifier});};t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(error??t.error);});}finally{db.close();}
  }
  async read(kind,id){const key=this.#key;if(!key)throw new Error('Almacén bloqueado');const row=await read('records',[scopeKey(this.#scope),kind,id]);if(!row)return null;const data=await decrypt(key,this.#scope,kind,id,row.revision,row);if(this.#key!==key)throw new Error('Almacén bloqueado durante lectura');return {revision:row.revision,data};}
  async write(kind,id,data,expectedRevision=0){
    const key=this.#key,generation=this.#generation;if(!key)throw new Error('Almacén bloqueado');if(!kind||!id||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('Registro inválido');
    const revision=expectedRevision+1,envelope=await encrypt(key,this.#scope,kind,id,revision,data);if(generation!==this.#generation)throw new Error('Almacén bloqueado durante escritura');
    const db=await open();try{return await new Promise((resolve,reject)=>{const t=db.transaction('records','readwrite'),s=t.objectStore('records'),recordKey=[scopeKey(this.#scope),kind,id],r=s.get(recordKey);let error;r.onsuccess=()=>{if((r.result?.revision??0)!==expectedRevision){error=new Error('Edición concurrente: recargá el registro');t.abort();return;}if(generation!==this.#generation){error=new Error('Almacén bloqueado');t.abort();return;}s.put({key:recordKey,scope:scopeKey(this.#scope),kind,id,revision,...envelope});};t.oncomplete=()=>resolve({revision,data});t.onabort=t.onerror=()=>reject(error??t.error);});}finally{db.close();}
  }
  async list(kind){
    const key=this.#key;if(!key)throw new Error('Almacén bloqueado');const db=await open();let rows;try{rows=await new Promise((resolve,reject)=>{const t=db.transaction('records','readonly');let found;const r=t.objectStore('records').index('byScopeKind').getAll([scopeKey(this.#scope),kind]);r.onsuccess=()=>{found=r.result};t.oncomplete=()=>resolve(found);t.onabort=t.onerror=()=>reject(t.error);});}finally{db.close();}
    const values=[];for(const row of rows)values.push({id:row.id,revision:row.revision,data:await decrypt(key,this.#scope,kind,row.id,row.revision,row)});if(key!==this.#key)throw new Error('Almacén bloqueado');return values;
  }
  async exportBackup(recoveryPassword){
    const key=this.#key;if(!key)throw Error('Desbloqueá antes de exportar');
    const {deviceKey,...profile}=await read('profiles',scopeKey(this.#scope));const db=await open();let records;
    try{records=await new Promise((resolve,reject)=>{const t=db.transaction('records','readonly'),r=t.objectStore('records').getAll();r.onsuccess=()=>resolve(r.result.filter(r=>r.scope===scopeKey(this.#scope)&&r.kind!=='session'));r.onerror=()=>reject(r.error);});}finally{db.close();}
    if(profile.deviceOnly||recoveryPassword){
      const salt=Array.from(crypto.getRandomValues(new Uint8Array(16))),backupKey=await keyFor(recoveryPassword,salt);
      const identity=await decrypt(key,this.#scope,'profile','identity',1,profile.verifier);
      profile.salt=salt;delete profile.deviceOnly;delete profile.recovery;profile.verifier=await encrypt(backupKey,this.#scope,'profile','identity',1,identity);
      records=await Promise.all(records.map(async r=>({...r,...await encrypt(backupKey,this.#scope,r.kind,r.id,r.revision,await decrypt(key,this.#scope,r.kind,r.id,r.revision,r))})));
    }
    return {format:'sigo-mayorista-encrypted-backup-v1',profile,records};
  }
  async restoreBackup(backup,password){
    this.lock();const generation=this.#generation;
    if(backup?.format!=='sigo-mayorista-encrypted-backup-v1'||backup.profile?.scope!==scopeKey(this.#scope)||backup.profile.version!==1||backup.profile.salt?.length!==16||!Array.isArray(backup.records)||backup.records.length>10000)throw new Error('Respaldo inválido o de otro ámbito');
    const key=await keyFor(password,backup.profile.salt);const identity=await decrypt(key,this.#scope,'profile','identity',1,backup.profile.verifier);validOffline(identity,this.#scope,Date.now());
    const unique=new Set();for(const r of backup.records){const k=JSON.stringify(r.key);if(r.scope!==scopeKey(this.#scope)||JSON.stringify(r.key)!==JSON.stringify([r.scope,r.kind,r.id])||!Number.isSafeInteger(r.revision)||r.revision<1||unique.has(k))throw new Error('Respaldo con registros inválidos/duplicados');unique.add(k);await decrypt(key,this.#scope,r.kind,r.id,r.revision,r);}
    if(generation!==this.#generation)throw new Error('Restauración cancelada');const db=await open();try{await new Promise((resolve,reject)=>{const t=db.transaction(['profiles','records'],'readwrite'),p=t.objectStore('profiles'),r=p.get(scopeKey(this.#scope));let error;r.onsuccess=()=>{if(r.result){error=new Error('No se reemplaza un almacén existente: conservá y conciliá sus pedidos primero');t.abort();return;}if(generation!==this.#generation){t.abort();return;}p.add(backup.profile);for(const row of backup.records)t.objectStore('records').add(row);};t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(error??t.error??new Error('Restauración abortada'));});}finally{db.close();}
    if(generation===this.#generation)this.#key=key;return identity;
  }
}

