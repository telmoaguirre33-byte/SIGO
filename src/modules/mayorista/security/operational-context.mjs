/** La ruta de instalación separa almacenes; nunca decide empresa, rol ni identidad. */
export function operationalPrefix(value){return new URL(value).pathname.startsWith('/integracion-qa/')?'/integracion-qa':'';}
export function encryptedDatabase(value){return operationalPrefix(value)?'sigo-mayorista-integration-qa-secure-v1':'sigo-mayorista-secure-v1';}
export function operationalPage(config,href){
 const u=new URL(href),prefix=operationalPrefix(href),baseUrl=u.origin+prefix;
 return {enabled:config?.enabled===true&&u.protocol==='https:'&&config.approvedOrigin===baseUrl&&[prefix+'/secure.html',prefix+'/portal.html'].includes(u.pathname),baseUrl};
}
