import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/InformesOperativos.tsx','utf8');
const names=[...source.matchAll(/const \[(\w+),\s*\w+\] = useState/g)].map(m=>m[1]);
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(values){
 let index=0;const exports={};const jsx=(type,props)=>({type,props});
 vm.runInNewContext(code,{exports,console,Intl,Date,document:new Proxy({},{get(){throw Error('UNEXPECTED_EXPORT');}}),require(name){
  if(name==='react')return{useState:initial=>[names[index++] in values?values[names[index-1]]:initial,()=>{}],useRef:initial=>({current:initial}),useEffect(){}};
  if(name==='./fechaLocal')return{fechaLocalIso:(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};
  return new Proxy({},{get(){return()=>{throw Error(`UNEXPECTED_IO:${name}`);};}});
 }});
 return exports.default({empresaId:'tenant'});
}
function all(node){if(!node||typeof node!=='object')return[];return[node,...[node.props?.children].flat(9).flatMap(all)];}
const from='2026-10-01',to='2026-10-18';
const report={desde:from,hasta:to,total:121,cantidad:1,dias:[],porHora:[],porDiaSemana:[]};
for(const [name,values]of[
 ['missing purchases',{ventasGerenciales:report}],
 ['missing sales',{comprasGerenciales:{...report,comprasTotal:50}}],
 ['source failure',{ventasGerenciales:report,comprasGerencialesError:'Compras no disponible'}],
 ['changed date range',{ventasGerenciales:{...report,hasta:'2026-10-17'},comprasGerenciales:{...report,comprasTotal:50}}],
]){
 const tree=all(render({loading:false,gerencialDesde:from,gerencialHasta:to,...values}));
 const button=tree.find(n=>n.type==='button'&&n.props.children==='Exportar Excel');assert.ok(button,name);assert.equal(button.props.disabled,true,name);button.props.onClick();
 assert.ok(!tree.some(n=>n.props?.className==='sigo-gerencial-summary-cards'),`${name}: cannot display zero KPIs`);
 console.log(`PASS incomplete report UI/export: ${name}`);
}
const complete=all(render({loading:false,gerencialDesde:from,gerencialHasta:to,ventasGerenciales:report,comprasGerenciales:{...report,comprasTotal:50}}));
assert.equal(complete.find(n=>n.type==='button'&&n.props.children==='Exportar Excel').props.disabled,false);
console.log('PASS complete report enables export');
