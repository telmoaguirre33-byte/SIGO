import {supabase} from '../../../supabase';
/** Preferencia declarada al crear empresa; nunca un permiso ni un claim de rol. */
export const businessPreferenceKey='sigo_tipo_negocio_pendiente';
export async function configureDeclaredBusiness(empresaId:string,preference:unknown){
 if(preference!=='mayorista'&&preference!=='mixto')return;
 const {error}=await supabase.rpc('declarar_tipo_negocio_sigo',{p_empresa_id:empresaId,p_tipo:preference});
 if(error)throw Error('Empresa creada. Falta guardar el tipo de negocio en Configuración; no se modificó la suscripción.');
 await supabase.auth.updateUser({data:{[businessPreferenceKey]:null}});
}
