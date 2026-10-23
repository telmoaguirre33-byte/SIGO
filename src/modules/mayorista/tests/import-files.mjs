import assert from 'node:assert/strict';
import {leerArchivoStock} from '../demo/dist/admin/import-reader.mjs';
import {descargarTablaExcel} from '../demo/dist/admin/report-excel.mjs';
const csv=new File(['codigo;nombre;precio\r\n001;"Producto; especial";12,50\r\n002;"Texto ""doble""";20\r\n'],'datos.csv');
const matrix=await leerArchivoStock(csv);assert.deepEqual(matrix[1],['001','Producto; especial','12,50']);assert.equal(matrix[2][1],'Texto "doble"');
await assert.rejects(()=>leerArchivoStock(new File(['codigo;nombre\n001;"sin cerrar'],'mal.csv')),/comillas sin cerrar/);
let blob,name;const original=URL.createObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:test';};
globalThis.document={body:{appendChild(){}},createElement:()=>({set download(value){name=value;},click(){},remove(){}})};globalThis.window={setTimeout(){}};
try{descargarTablaExcel('Ventas',['Cliente','Código','Importe'],[['=SUM(A1)','001',123.50],['Comercio & <A>','002',null]],'ventas.xlsx');}finally{URL.createObjectURL=original;delete globalThis.document;delete globalThis.window;}
assert.equal(name,'ventas.xlsx');assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),files=new Map();let offset=0;while(view.getUint32(offset,true)===0x04034b50){const n=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),size=view.getUint32(offset+18,true),file=new TextDecoder().decode(bytes.slice(offset+30,offset+30+n)),start=offset+30+n+extra;files.set(file,new TextDecoder().decode(bytes.slice(start,start+size)));offset=start+size;}
assert.ok(files.has('[Content_Types].xml'));const sheet=files.get('xl/worksheets/sheet1.xml');assert.ok(sheet.includes('=SUM(A1)'));assert.ok(!sheet.includes('<f>'));assert.ok(sheet.includes('Comercio &amp; &lt;A&gt;'));assert.ok(sheet.includes('001'));assert.ok(sheet.includes('<v>123.5</v>'));
console.log('PASS archivos: CSV delimitado/comillas/ceros y XLSX ZIP real, texto sin fórmulas, XML escapado y números');
