import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
const file=name=>readFile(new URL('../demo/'+name,import.meta.url));
function pixels(b){
 assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 const size=b.readUInt32BE(16);assert.equal(b.readUInt32BE(20),size);assert.equal(b[24],8);assert.equal(b[25],2,'PNG RGB opaco');
 const chunks=[];for(let i=8;i<b.length;){const n=b.readUInt32BE(i);if(b.toString('ascii',i+4,i+8)==='IDAT')chunks.push(b.subarray(i+8,i+8+n));i+=12+n;}
 const raw=inflateSync(Buffer.concat(chunks)),stride=size*3,out=Buffer.alloc(stride*size);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<size;y++){const filter=raw[y*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){const pos=y*stride+x,a=x>=3?out[pos-3]:0,up=y?out[pos-stride]:0,c=y&&x>=3?out[pos-stride-3]:0,add=[0,a,up,Math.floor((a+up)/2),paeth(a,up,c)][filter];out[pos]=(raw[y*(stride+1)+1+x]+add)&255;}}
 return {size,data:out};
}
for(const name of ['manifest.webmanifest','secure.webmanifest'])test(name+' mantiene identidad SIGO Vendedor y ambas máscaras Android',async()=>{
 const m=JSON.parse(await file(name));assert.equal(m.name,'SIGO Vendedor');assert.equal(m.short_name,'SIGO Vendedor');assert.equal(m.display,'standalone');assert.equal(m.scope,'./');assert.equal(m.prefer_related_applications,false);
 for(const size of [192,512])for(const purpose of ['any','maskable']){
  const i=m.icons.find(i=>i.sizes===`${size}x${size}`&&i.purpose===purpose);assert.equal(i?.type,'image/png');const {size:actual,data}=pixels(await file(i.src.split('?')[0].slice(2)));assert.equal(actual,size);
  let black=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++){const pos=(y*size+x)*3,v=data[pos];assert.equal(v,data[pos+1]);assert.equal(v,data[pos+2]);if(v<32)black++;if(purpose==='maskable'&&Math.hypot(x+.5-size/2,y+.5-size/2)>size*.4)assert.equal(v,255,'S completa dentro de círculo seguro');}
  assert.ok(black>size*size*.04,'glifo negro visible');assert.equal(data[0],255);
 }
});
test('PWA segura preserva identidad e inicio y usa bootstrap externo compatible con CSP',async()=>{
 const m=JSON.parse(await file('secure.webmanifest'));assert.equal(m.id,'./app-vendedor-segura');assert.equal(m.start_url,'./secure.html');
 const html=(await file('secure.html')).toString();assert.ok(html.includes('<title>SIGO Vendedor</title>'));assert.ok(html.includes('favicon-32.png'));assert.ok(html.includes('apple-touch-icon.png'));assert.ok(html.includes('src="./seller-entry.mjs"'));assert.equal(/<script[^>]*>[^<]+<\/script>/.test(html),false);
});
test('paquete compilado publica iconos maskable, favicon y entrada de instalación',async()=>{
 for(const name of ['icon-maskable-192.png','icon-maskable-512.png','favicon-32.png','apple-touch-icon.png','installation.mjs','seller-entry.mjs'])assert.deepEqual(await file('dist/'+name),await file(name));
});
