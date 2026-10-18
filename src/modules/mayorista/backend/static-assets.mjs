import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
/** Raíz normalizada una vez: una barra final nunca convierte el prefijo en //.
 * El servidor aplica además su allowlist de recursos antes de llamar aquí. */
export async function operationalAsset(directory,pathname,origin){
 const root=path.resolve(directory),file=path.resolve(root,'.'+pathname);
 if(!pathname.startsWith('/')||!file.startsWith(root+path.sep))throw Error('Recurso fuera del paquete');
 const content=pathname==='/secure-config.mjs'?Buffer.from('export const secureConfig=Object.freeze('+JSON.stringify({enabled:true,approvedOrigin:origin})+');'):await readFile(file);
 const type=({'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(file)]??'application/octet-stream';
 const scripts=type.startsWith('text/html')?[...content.toString().matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>"'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'"):[];
 return {content,assetHeaders:{'Content-Type':type,'Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self' "+scripts.join(' ')+"; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}};
}
