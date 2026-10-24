"""Atomic installer verification on a fresh local CI PostgreSQL17 database only."""
from pathlib import Path
import os,subprocess,json,hashlib
R=Path(__file__).resolve().parent;repo=R.parents[1];doc=repo/'docs/operacion-controlada/correccion-unidad'
assert os.environ.get('PGHOST') in ('localhost','127.0.0.1')
assert os.environ.get('PGDATABASE')=='sigo_installer_synthetic'
cmd=['psql','-X','-qAt','-v','ON_ERROR_STOP=1']
p=subprocess.run(cmd+['-d','postgres'],input='CREATE DATABASE sigo_installer_synthetic;',text=True,capture_output=True,timeout=30);assert p.returncode==0,p.stderr

def sql(q,expected=None):
 p=subprocess.run(cmd,input=q,text=True,capture_output=True,timeout=40)
 if expected:assert p.returncode!=0 and expected in p.stderr,(expected,p.stderr)
 else:assert p.returncode==0,p.stderr
 return p.stdout.strip()
assert sql("SELECT current_setting('server_version_num')::int/10000")=='17'
assert sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'")=='0'
# Roles are cluster-wide and were created by the preceding synthetic test step.
for f in ['00_schema.sql','01_security_and_head_rpc.sql','03_install_real_supplier_guards.sql','02_seed.sql']:sql((R/'fixture'/f).read_text())
sql((repo/'supabase/migrations/20261022024847_manual_medidas_atomicas.sql').read_text())
for f in ['04_pricing_and_acl_baseline.sql','05_catalog_baseline.sql']:sql((R/'fixture'/f).read_text())
meta=json.loads((doc/'baseline_9_rpc.json').read_text())
for x in meta:
 name=x['proname'];grants=['postgres']+(['anon'] if 'anon=' in x['acl'] else [])+['authenticated','service_role']
 q=f"DO $acl$ DECLARE f regprocedure;BEGIN SELECT oid::regprocedure INTO f FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{name}';EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);"
 for role in grants:q+=f"EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO {role}',f);"
 sql(q+'END $acl$;')
rows=sql('SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM productos p')
installer=(doc/'INSTALADOR_CONJUNTO_NO_AUTORIZADO.sql').read_text();results=[]
for name,q,error in [('late_failure',installer.replace('-- END_ATOMIC_INSTALL',"RAISE EXCEPTION 'SYNTHETIC_FINAL_FAILURE';"),'SYNTHETIC_FINAL_FAILURE'),('baseline_drift',installer.replace('9f3972cf398ab7819c48d29d1d319379','00000000000000000000000000000000'),'SIGO_INSTALL_BASELINE_9_RPC_DRIFT')]:
 sql(q,error)
 assert sql("SELECT to_regnamespace('sigo_correccion_inicial') IS NULL AND to_regclass('public.productos_archivo_auditoria_sigo') IS NULL")=='t'
 assert sql('SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM productos p')==rows
 for x in meta:assert sql(f"SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{x['proname']}'")==x['body_md5']
 results.append({'case':name,'pass':True})
sql(installer)
assert sql("SELECT jsonb_agg(to_jsonb(p)-'archivado_comercial'-'unidad_revision' ORDER BY id) FROM productos p")==rows
assert sql('SELECT habilitada FROM sigo_correccion_inicial.configuracion WHERE singleton')=='t'
sql(installer,'SIGO_INSTALL_ALREADY_PRESENT_OR_DRIFT')
results.append({'case':'install_and_reinstall_guard','pass':True})
(R/'installer-ci-results.json').write_text(json.dumps({'synthetic_only':True,'installer_sha256':hashlib.sha256(installer.encode()).hexdigest(),'results':results},indent=2));print('PASS atomic installer',len(results))
