import {ApiError} from './receive-order.mjs';
export function approvedOrigins(primary,extra=[]){
  const values=[primary,...extra];
  if(!Array.isArray(extra)||values.length>3)throw new ApiError(503,'Orígenes no configurados');
  for(const value of values){let u;try{u=new URL(value);}catch{throw new ApiError(503,'Origen inválido');}
    if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)throw new ApiError(503,'Origen inválido');
  }
  return new Set(values);
}
