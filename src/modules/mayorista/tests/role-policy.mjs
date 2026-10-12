import assert from 'node:assert/strict';
import {authorizeMayorista,listMayoristaPermissions} from '../security/role-policy.mjs';
const principal={userId:'user-a',empresaId:'empresa-a'},activation={empresaId:'empresa-a',enabled:true};let passed=0;
const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
const context=(rol,permission)=>({principal,activation,permission,membership:{...principal,activo:true,rol,vendedorId:'v-a',choferId:'c-a',armadorId:'a-a'},resource:{empresaId:'empresa-a',vendedorId:'v-a',choferId:'c-a',armadoresIds:['a-a']}});
for(const rol of ['gerencia','administracion','vendedor','armador','chofer']){
 const grants=listMayoristaPermissions(rol);
 check(rol+' obtiene únicamente sus funciones',()=>{for(const permission of grants)assert.equal(authorizeMayorista(context(rol,permission)),true);});
 check(rol+' no cruza empresas',()=>{const c=context(rol,grants[0]);c.resource.empresaId='empresa-b';assert.throws(()=>authorizeMayorista(c));});
 check(rol+' respeta desactivación por empresa',()=>{const c=context(rol,grants[0]);c.activation={...activation,enabled:false};assert.throws(()=>authorizeMayorista(c));});
 check(rol+' requiere membresía vigente y propia',()=>{for(const change of [{activo:false},{userId:'otro'},{empresaId:'otra'}]){const c=context(rol,grants[0]);c.membership={...c.membership,...change};assert.throws(()=>authorizeMayorista(c));}});
}
check('Vendedor no usa administración ni cartera ajena',()=>{assert.throws(()=>authorizeMayorista(context('vendedor','precios')));const c=context('vendedor','pedidos_propios');c.resource.vendedorId='v-b';assert.throws(()=>authorizeMayorista(c));});
check('Chofer no accede a otra carga ni a pedidos administrativos',()=>{const c=context('chofer','entregas_asignadas');c.resource.choferId='c-b';assert.throws(()=>authorizeMayorista(c));assert.throws(()=>authorizeMayorista(context('chofer','pedidos')));});
check('Armador no cobra ni controla cargas sin asignación',()=>{const c=context('armador','picking');c.resource.armadoresIds=['a-b'];assert.throws(()=>authorizeMayorista(c));assert.throws(()=>authorizeMayorista(context('armador','cobranzas')));});
check('Roles desconocidos y campos de metadata no otorgan permisos',()=>{const c=context('desconocido','*');c.principal.user_metadata={rol:'gerencia'};assert.throws(()=>authorizeMayorista(c));const modified=listMayoristaPermissions('vendedor');modified.push('*');assert.throws(()=>authorizeMayorista(context('vendedor','precios')));});
console.log(`${passed} controles de matriz de roles aprobados; integración con membresías persistentes/RLS pendiente.`);
