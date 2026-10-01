import { supabase } from "./supabase";
export type HallazgoInventario={id:string;codigo:string;descripcion:string;categoria:string;estado:"ok"|"sin_stock"|"falta_sigo"|"no_visto"|"revisar";foto:number;x:number;y:number;confianza:number};
export async function analizarInventarioSigo(empresaId:string,imagenes:string[]):Promise<{bloque:string;hallazgos:HallazgoInventario[]}>{
 const {data}=await supabase.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error("La sesión venció. Volvé a ingresar a SIGO.");
 const response=await fetch("/api/compras/analizar-factura",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({empresaId,modo:"inventario",imagenes})});
 const text=await response.text();let out:any={};try{out=text?JSON.parse(text):{}}catch{out={message:text}}
 if(!response.ok)throw new Error(out?.message||`No se pudo analizar (HTTP ${response.status}).`);
 return out;
}
