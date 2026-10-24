"""Synthetic-only PG17 validation. Never accepts a remote database host or URL."""
from pathlib import Path
import os,subprocess,json,time,select
R=Path(__file__).resolve().parent;repo=R.parents[1];C=repo/'supabase/candidates/unit-correction'
# CI disposable PostgreSQL service only. No production secrets or user data.
assert os.environ.get('PGHOST') in ('127.0.0.1','localhost'), 'Refusing non-local database'
assert os.environ.get('PGDATABASE')=='sigo_unit_correction_synthetic', 'Refusing non-synthetic database name'
cmd=['psql','-X','-qAt','-v','ON_ERROR_STOP=1'];results=[]
def sql(q,err=None):
 p=subprocess.run(cmd,input=q,text=True,capture_output=True,timeout=30)
 if err:assert p.returncode and err in p.stderr,(err,p.stderr)
 else:assert p.returncode==0,p.stderr
 return p.stdout.strip()
assert sql('SELECT current_setting(\'server_version_num\')::int/10000')=='17'
assert sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'")=='0','Fresh fixture required'
sql("CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role BYPASSRLS;")
for f in ['00_schema.sql','01_security_and_head_rpc.sql','03_install_real_supplier_guards.sql','02_seed.sql']:sql((R/'fixture'/f).read_text())
sql((repo/'supabase/migrations/20261022024847_manual_medidas_atomicas.sql').read_text())
sql((R/'fixture/04_pricing_and_acl_baseline.sql').read_text())
acl_query="SELECT jsonb_object_agg(proname,jsonb_build_array(has_function_privilege('anon',oid,'EXECUTE'),has_function_privilege('authenticated',oid,'EXECUTE'))) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('aplicar_margen_masivo_sigo','cambiar_compra_sigo','confirmar_compra_sigo','confirmar_venta_sigo_v2','guardar_producto_medida_sigo','redondear_precios_venta_sigo','registrar_devolucion_sigo')"
acl_before=sql(acl_query)
sql((C/'correccion_inicial_CANDIDATO_NO_APLICAR.sql').read_text())
manifest=json.loads((R/'cases.json').read_text())
for phase in ['core','guards']:
 if phase=='guards':
  sql((C/'guardas_CANDIDATO_NO_APLICAR.sql').read_text());sql((C/'rpc_adaptados_CANDIDATO_NO_APLICAR.sql').read_text())
 for case in [c for c in manifest if c['phase']==phase]:
  sql((R/'cases'/(case['case']+'.sql')).read_text(),case['expected_error']);results.append(case);print('PASS',case['case'],flush=True)
E='10000000-0000-0000-0000-000000000001';U='20000000-0000-0000-0000-000000000001';D='CONFIRMO_CARGA_INICIAL_SIN_MOVIMIENTOS_Y_VALORES_YA_EN_KG'
auth=f"SET ROLE postgres;SELECT set_config('request.jwt.claim.sub','{U}',false);"
sql(auth+"UPDATE sigo_correccion_inicial.configuracion SET habilitada=true;GRANT EXECUTE ON FUNCTION public.previsualizar_correccion_unidad_inicial_sigo(uuid,uuid),public.corregir_unidad_inicial_sigo(uuid,uuid,uuid,text,text) TO authenticated;")
def new_product(n):
 i=f'30000000-0000-0000-0000-{n:012d}'
 sql(auth+f"INSERT INTO productos(id,empresa_id,nombre,unidad_medida,stock_actual,precio_venta) VALUES('{i}','{E}','Synthetic concurrency {n}','UNIDAD',10,100);")
 return i
def snap(i):return sql(auth+f"SET ROLE authenticated;SELECT public.previsualizar_correccion_unidad_inicial_sigo('{E}','{i}')->>'snapshot';").splitlines()[-1]
def correct(i,k,s):return f"SELECT public.corregir_unidad_inicial_sigo('{E}','{i}','70000000-0000-0000-0000-{k:012d}','{s}','{D}');"
def holder(q):
 p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 p.stdin.write('\\o /dev/null\n'+auth+'BEGIN;'+q+'\n\\o\n\\echo HELD\n');p.stdin.flush()
 deadline=time.monotonic()+15
 while time.monotonic()<deadline:
  if select.select([p.stdout],[],[],1)[0]:
   if p.stdout.readline().strip()=='HELD':return p
  if p.poll() is not None:raise AssertionError(p.stderr.read())
 p.kill();raise AssertionError('holder not ready')
def release(p):
 p.stdin.write('COMMIT;\n\\q\n');p.stdin.flush();assert p.wait(timeout=15)==0,p.stderr.read()
# Movement first: NOWAIT rejects correction; once committed, history review rejects too.
i=new_product(101);s=snap(i)
p=holder(f"INSERT INTO movimientos_stock(producto_id,tipo,cantidad,stock_anterior,stock_nuevo) VALUES('{i}','AJUSTE',1,10,11);")
try:sql(auth+'SET ROLE authenticated;'+correct(i,101,s),'could not obtain lock')
finally:release(p)
sql(auth+f"SET ROLE authenticated;SELECT public.previsualizar_correccion_unidad_inicial_sigo('{E}','{i}');",'UNIT_CHANGE_REQUIRES_HISTORY_REVIEW');results.append({'case':'movement_first_blocks_correction','pass':True})
# Correction first: old direct history insertion waits, then sees correction and rejects.
i=new_product(102);s=snap(i);p=holder('SET ROLE authenticated;'+correct(i,102,s))
q=auth+f"INSERT INTO movimientos_stock(producto_id,tipo,cantidad,stock_anterior,stock_nuevo) VALUES('{i}','AJUSTE',1,10,11);"
w=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);w.stdin.write(q);w.stdin.close();time.sleep(.25);assert w.poll() is None,'Writer should be waiting for correction lock';release(p)
assert w.wait(timeout=15)!=0 and 'CORRECTED_PRODUCT_UNIT_REVIEW_REQUIRED' in w.stderr.read();results.append({'case':'correction_first_rejects_waiting_legacy_writer','pass':True})
# Same key: concurrent retry must recover same committed receipt and never relabel twice.
i=new_product(103);s=snap(i);p=holder('SET ROLE authenticated;'+correct(i,103,s))
w=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);w.stdin.write(auth+'SET ROLE authenticated;'+correct(i,103,s));w.stdin.close();time.sleep(.25);assert w.poll() is None;release(p)
assert w.wait(timeout=15)==0,w.stderr.read();assert sql(f"SELECT count(*) FROM sigo_correccion_inicial.auditoria WHERE producto_id='{i}'")=='1';results.append({'case':'concurrent_same_key_exactly_one_audit','pass':True})
# Legacy product update already waiting must see the committed correction mark.
i=new_product(104);s=snap(i);p=holder('SET ROLE authenticated;'+correct(i,104,s))
w=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
w.stdin.write(auth+f"SET ROLE authenticated;SELECT public.guardar_producto_sigo(p_empresa_id=>'{E}',p_producto_id=>'{i}',p_nombre=>'Synthetic stale edit',p_precio_venta=>222);");w.stdin.close();time.sleep(.25);assert w.poll() is None;release(p)
assert w.wait(timeout=15)!=0 and 'CORRECTED_PRODUCT_UNIT_REVIEW_REQUIRED' in w.stderr.read();results.append({'case':'correction_first_rejects_waiting_legacy_product_update','pass':True})
assert sql('SELECT count(*) FROM sigo_correccion_inicial.operaciones')=='0'
assert sql(acl_query)==acl_before, 'Existing RPC ACL must not change'
results.append({'case':'existing_rpc_acl_preserved','pass':True})
(R/'postgres-results.json').write_text(json.dumps({'synthetic_only':True,'cases':results},indent=2));print('PASS total',len(results))
