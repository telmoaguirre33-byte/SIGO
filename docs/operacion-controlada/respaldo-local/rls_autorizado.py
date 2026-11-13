"""Execute only the owner-authorized PR122 RLS file; never a general SQL runner."""
import hashlib
import json
import os
import tempfile
import time
import urllib.request
from pathlib import Path
import cloud as c
import custodia as k
import respaldo as b

APPROVED_SHA='991d9a777676206cd91f517e8ec09454b54b2051b789350a46433c5a15fc8136'
APPROVAL='6839829119'


def approved_bytes():
    data=(c.ROOT/'rls.sql').read_bytes()
    if hashlib.sha256(data).hexdigest()!=APPROVED_SHA:
        raise RuntimeError('RLS_APPROVED_FILE_HASH_MISMATCH')
    return data


def verify_owner_consent():
    if os.getenv('SIGO_RLS_APPROVAL_COMMENT')!=APPROVAL:
        raise RuntimeError('RLS_EXACT_OWNER_CONSENT_REQUIRED')
    url='https://api.github.com/repos/telmoaguirre33-byte/SIGO/issues/comments/'+APPROVAL
    request=urllib.request.Request(url,headers={'Accept':'application/vnd.github+json','User-Agent':'SIGO-PR122-controlled-operator'})
    with urllib.request.urlopen(request,timeout=20)as response:comment=json.load(response)
    if str(comment.get('id'))!=APPROVAL or comment.get('user',{}).get('login')!='telmoaguirre33-byte' or APPROVED_SHA not in comment.get('body','') or 'Sí, autorizo' not in comment.get('body',''):
        raise RuntimeError('RLS_OWNER_CONSENT_RECORD_MISMATCH')


def execute_exact_file(pg):
    if not pg.service:raise RuntimeError('RLS_REVIEWED_SOURCE_CONNECTION_REQUIRED')
    data=approved_bytes()
    command=pg.cmd('psql','-Xq','--no-password','-v','ON_ERROR_STOP=1')
    matches=[i for i,value in enumerate(command)if value.startswith('PGOPTIONS=')]
    if len(matches)!=1 or 'default_transaction_read_only=on' not in command[matches[0]]:
        raise RuntimeError('RLS_SOURCE_OPTIONS_NOT_REVIEWED')
    # One reviewed psql invocation only. Input bytes are the exact approved file.
    # No grants, history repair, or other SQL is appended to it.
    command[matches[0]]=command[matches[0]].replace('default_transaction_read_only=on','default_transaction_read_only=off')
    b.run(command,data)


def verify_postconditions(pg):
    q="""select
(select count(*)=1 and bool_and(policyname='productos_minorista_select_tenant' and cmd='SELECT' and roles::text='{authenticated}')from pg_policies where schemaname='public'and tablename='productos')
and not has_table_privilege('anon','public.productos','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
and not has_table_privilege('authenticated','public.productos','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
and not has_any_column_privilege('anon','public.productos','SELECT,INSERT,UPDATE,REFERENCES')
and has_column_privilege('authenticated','public.productos','id','SELECT')
and not has_column_privilege('authenticated','public.productos','descripcion','SELECT')
and(select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.productos'::regclass);"""
    if pg.sql(q)!='t':raise RuntimeError('RLS_PRODUCTION_POSTCONDITIONS_FAILED')


def read_only_isolation(pg):
    members=json.loads(pg.sql("""select coalesce(json_agg(t),'[]')from(
select distinct on(eu.empresa_id)eu.empresa_id,eu.user_id from public.empresa_usuarios eu
where eu.activo and eu.user_id is not null
and not('products.read'=any(coalesce(eu.permisos_denegados,'{}'::text[])))
and(eu.rol in('owner','admin','seller','warehouse')or'products.read'=any(coalesce(eu.permisos_extra,'{}'::text[])))
order by eu.empresa_id,(eu.rol='owner')desc,eu.user_id)t;"""))
    totals=json.loads(pg.sql("select coalesce(json_object_agg(empresa_id::text,n),'{}')from(select empresa_id,count(*)n from public.productos where empresa_id is not null group by empresa_id)t;"))
    tenants=json.loads(pg.sql('select coalesce(json_agg(id),\'[]\')from public.empresas;'))
    if len(members)!=32:raise RuntimeError('RLS_COMPANY_SCOPE_REVIEW_REQUIRED')
    denials=0
    for member in members:
        uid=b.literal(member['user_id'])
        allowed=json.loads(pg.sql("select coalesce(json_agg(empresa_id),'[]')from public.empresa_usuarios where activo and user_id="+uid+
            " and not('products.read'=any(coalesce(permisos_denegados,'{}'::text[])))and(rol in('owner','admin','seller','warehouse')or'products.read'=any(coalesce(permisos_extra,'{}'::text[])));"))
        array='ARRAY['+','.join(b.literal(x)+'::uuid'for x in allowed)+']::uuid[]'
        claims=b.literal(json.dumps({'sub':member['user_id'],'role':'authenticated'}))
        reject=''
        for tenant in tenants:
            if tenant in allowed:continue
            denials+=1
            reject+="do $$begin begin perform 1 from public.consultar_productos_sigo("+b.literal(tenant)+"::uuid,'',0,1);raise exception 'RLS_CROSS_TENANT_RPC_ACCEPTED';exception when others then if sqlerrm<>'FORBIDDEN'then raise;end if;end;end$$;"
        q=('begin read only;set local statement_timeout=\'60s\';set local request.jwt.claim.sub='+uid+';set local request.jwt.claims='+claims+';set local role authenticated;'
           "select json_build_object('visible',count(id),'outside',count(id)filter(where empresa_id is null or not(empresa_id=any("+array+"))))from public.productos;"+reject+'rollback;')
        result=json.loads(pg.sql(q))
        if result['outside']!=0 or result['visible']!=sum(int(totals.get(x,0))for x in allowed):
            raise RuntimeError('RLS_PRODUCTION_COMPANY_ISOLATION_FAILED')
    if pg.sql("begin read only;set local request.jwt.claim.sub='';set local role authenticated;select count(id)from public.productos;rollback;")!='0':
        raise RuntimeError('RLS_NULL_SESSION_NOT_DENIED')
    return {'active_companies_checked':len(members),'cross_tenant_rpc_denials':denials,
            'direct_read_isolation':'PASS','null_session':'PASS','production_business_writes':False}


def run(docker,work):
    approved_bytes();verify_owner_consent()
    recovery=k.verify_existing(docker,work)
    with c.source(docker,work)as pg:
        if pg.sql("select count(*)from pg_policies where schemaname='public'and tablename='productos'and policyname='productos_minorista_select_tenant';")!='0':
            raise RuntimeError('RLS_ALREADY_PRESENT_DO_NOT_REPEAT')
        if pg.sql("select count(*)from pg_locks where relation='public.productos'::regclass and mode='AccessExclusiveLock';")!='0':
            raise RuntimeError('RLS_ANOTHER_EXCLUSIVE_OPERATION_PRESENT')
        before=b.table_hash(pg,{'schema':'public','name':'productos','extension_data_condition':''})
        started=time.monotonic()
        execute_exact_file(pg)
        elapsed=round(time.monotonic()-started,3)
        verify_postconditions(pg)
        after=b.table_hash(pg,{'schema':'public','name':'productos','extension_data_condition':''})
        if before!=after:raise RuntimeError('RLS_PRODUCT_ROWS_CHANGED_REVIEW_CONCURRENT_ACTIVITY')
        checks=read_only_isolation(pg)
    return {'status':'PASS_AUTHORIZED_EXACT_RLS_APPLIED_AND_VERIFIED','operation_name':'sigo_122_rls_991d9a77',
            'sql_sha256':APPROVED_SHA,'project':'COMERCIAL','execution_seconds':elapsed,
            'products_rows_unchanged':'PASS','product_count':before['rows'],'isolation':checks,
            'backup_gate':recovery['status'],'catalogue_reexecuted':False,
            'extra_production_sql_mutations':False,'application_deployed':False}


def run_verify(docker,work):
    approved_bytes()
    with c.source(docker,work)as pg:
        verify_postconditions(pg)
        b.phase('rls_postconditions_verified_read_only')
        checks=read_only_isolation(pg)
        retained=int(pg.sql('select count(*)from public.productos where empresa_id is null;'))
    return {'status':'PASS_PRODUCTION_RLS_READ_ONLY_VERIFICATION','sql_sha256':APPROVED_SHA,
            'isolation':checks,'legacy_products_without_company_retained':retained,
            'source_read_only':True,'rls_reexecuted':False,'business_data_changes':False}


def main():
    os.umask(0o077)
    if os.getenv('GITHUB_REPOSITORY')!='telmoaguirre33-byte/SIGO'or os.getenv('GITHUB_REF')!='refs/heads/ops/122-custodia-recuperable':
        raise RuntimeError('RLS_ONLY_AUTHORIZED_OPERATOR_BRANCH')
    with tempfile.TemporaryDirectory(prefix='sigo122-rls-private-')as tmp:
        work=Path(tmp);b.LOG=work/'private.log';b.LOG.touch(mode=0o600)
        try:
            result=run_verify(b.docker_command(),work)if os.getenv('BACKUP_ACTION')=='rls-verify'else run(b.docker_command(),work)
            print(json.dumps(result,sort_keys=True),flush=True)
        except Exception as exc:
            code=str(exc)if isinstance(exc,RuntimeError)and str(exc).replace('_','').isalnum()else'PRIVATE_DIAGNOSTIC_ONLY'
            print(json.dumps({'status':'STOPPED_NO_AUTOMATIC_RETRY','error':code,'diagnostic':c.safe_error(b.LOG)}),flush=True)
            raise SystemExit(1)


if __name__=='__main__':main()
