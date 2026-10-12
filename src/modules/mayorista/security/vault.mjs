/** Preparación de cifrado local. No se conecta aún a la demo ni elimina pedidos.
 * El PIN/contraseña nunca se persiste; usar una contraseña fuerte, no un PIN corto. */
const enc = new TextEncoder(), dec = new TextDecoder();
const aad = scope => enc.encode(JSON.stringify(['sigo-mayorista-vault-v1',scope.empresaId,scope.vendedorId]));
function validateScope(scope) {if (!scope?.empresaId || !scope?.vendedorId) throw new Error('Ámbito obligatorio');}
async function derive(password, salt, usage) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Usá una contraseña de al menos 12 caracteres');
  const material = await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,usage);
}
export async function sealLocal(scope, data, password) {
  validateScope(scope);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password,salt,['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(scope)},key,enc.encode(JSON.stringify(data)));
  return {version:1,salt:Array.from(salt),iv:Array.from(iv),ciphertext:Array.from(new Uint8Array(ciphertext))};
}
export async function openLocal(scope, envelope, password) {
  validateScope(scope);
  if (envelope?.version !== 1 || envelope.salt?.length !== 16 || envelope.iv?.length !== 12 || !Array.isArray(envelope.ciphertext) || envelope.ciphertext.length < 16) throw new Error('Datos cifrados inválidos');
  const key = await derive(password,new Uint8Array(envelope.salt),['decrypt']);
  const data = await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(envelope.iv),additionalData:aad(scope)},key,new Uint8Array(envelope.ciphertext));
  return JSON.parse(dec.decode(data));
}
