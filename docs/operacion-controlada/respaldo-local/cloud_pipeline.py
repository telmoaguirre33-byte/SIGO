"""Reuse the verified backup tool in an isolated Actions runner; no artifacts."""
import base64
import contextlib
import hashlib
import json
import os
import re
import secrets
import time
import urllib.error
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4
import cloud as c
import respaldo as b

ROOT=c.ROOT


def validate_rls_copy(pg,meta):
    # This object is created only for the new network=none restore destination.
    # The superuser is a local recovery operator, never a production credential.
    probe=b.PG(pg.docker,pg.box,'sigo_restore_operator',meta['database'])
    member=json.loads(probe.sql("""select(select json_build_object('company',eu.empresa_id,'user',eu.user_id)
from public.empresa_usuarios eu where eu.activo and eu.user_id is not null and eu.empresa_id is not null
and exists(select 1 from public.productos p where p.empresa_id=eu.empresa_id and p.activo and upper(btrim(coalesce(p.categoria,'')))<>'NO_VENDIBLE')limit 1);""")or'null')
    if not member:raise RuntimeError('RESTORED_COPY_HAS_NO_ACTIVE_MEMBER_WITH_CATALOGUE')
    company=b.literal(member['company']);user=b.literal(member['user'])
    foreign=json.loads(probe.sql("select(select to_json(p.empresa_id) from public.productos p where p.empresa_id<>"+company+" and p.activo and not exists(select 1 from public.empresa_usuarios eu where eu.empresa_id=p.empresa_id and eu.user_id="+user+" and eu.activo)limit 1);" )or'null')
    foreign_company=b.literal(foreign or str(uuid4()))
    def claims(uid):
        value=json.dumps({'sub':uid,'role':'authenticated'})
        return 'set local "request.jwt.claim.sub"='+b.literal(uid)+';set local "request.jwt.claims"='+b.literal(value)+';set local role authenticated;'
    def reject_rpc(tenant):
        return "do $$begin begin perform 1 from public.consultar_productos_sigo("+tenant+",'',0,1);raise exception 'RLS_RPC_NOT_REJECTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;end$$;"
    owner_sample=None
    for role in ['owner','admin','seller','warehouse']:
        change="update public.empresa_usuarios set rol="+b.literal(role)+",permisos_extra='{}',permisos_denegados='{}' where empresa_id="+company+' and user_id='+user+';'
        result=json.loads(probe.sql('begin;'+change+claims(member['user'])+
          "select json_build_object('own',(select count(id)from public.productos where empresa_id="+company+"),'foreign',(select count(id)from public.productos where empresa_id="+foreign_company+"),'sample',(select row_to_json(t)from public.consultar_productos_sigo("+company+",'',0,1)t));"+reject_rpc(foreign_company)+'rollback;'))
        sample=result['sample']
        if not(result['own']>0 and result['foreign']==0 and sample and sample['empresa_id']==member['company']):
            raise RuntimeError('RESTORED_COPY_ROLE_OR_TENANT_READ_FAILED')
        if role=='owner':owner_sample=sample
        elif sample['costo_actual'] is not None or sample['costo_ultima_compra'] is not None:
            raise RuntimeError('RESTORED_COPY_COST_MASK_FAILED')
        if sample['id']!=owner_sample['id'] or sample['stock_actual']!=owner_sample['stock_actual']:
            raise RuntimeError('RESTORED_COPY_PRODUCT_OR_STOCK_CHANGED_BY_ROLE')
        expected_price=None if role=='warehouse' else owner_sample['precio_venta']
        if sample['precio_venta']!=expected_price:raise RuntimeError('RESTORED_COPY_PRICE_MASK_FAILED')
    denial="update public.empresa_usuarios set rol='owner',permisos_extra='{}',permisos_denegados=array['products.read']::text[] where empresa_id="+company+' and user_id='+user+';'
    n=probe.sql('begin;'+denial+claims(member['user'])+'select count(id)from public.productos where empresa_id='+company+';'+reject_rpc(company)+'rollback;')
    if n!='0':raise RuntimeError('RESTORED_COPY_EXPLICIT_DENY_FAILED')
    outsider=str(uuid4())
    n=probe.sql('begin;'+claims(outsider)+'select count(id)from public.productos;'+reject_rpc(company)+'rollback;')
    if n!='0':raise RuntimeError('RESTORED_COPY_NONMEMBER_FAILED')
    return {'role_matrix':['owner','admin','seller','warehouse'],'tenant_and_explicit_deny':'PASS',
            'cost_price_stock_masks':'PASS','cross_tenant_existing_rows_checked':foreign is not None,
            'local_permission_transactions_rolled_back':True}


@contextlib.contextmanager
def fixture(docker):
    name='sigo-122-fixture-'+secrets.token_hex(6);volume=name+'-data';started=False
    image=b.RESTORE_IMAGE
    b.run(docker+['pull',image])
    b.run(docker+['volume','create','--label','sigo.backup.synthetic=true',volume])
    try:
        b.run(docker+['run','--rm','--network','none','--user','0','--entrypoint','/bin/sh',
                     '--mount','type=volume,src='+volume+',dst=/sigo-data',image,
                     '-c','chown postgres:postgres /sigo-data; chmod 700 /sigo-data'])
        command="initdb -D /sigo-data -U postgres --auth-local=trust --auth-host=reject --encoding=UTF8 >/tmp/init.log 2>&1 && exec postgres -D /sigo-data -k /tmp -c listen_addresses='' -c shared_preload_libraries=pg_stat_statements"
        b.run(docker+['run','-d','--network','none','--name',name,'--user','postgres','--entrypoint','/bin/sh',
                     '--mount','type=volume,src='+volume+',dst=/sigo-data',image,'-c',command])
        started=True;pg=b.PG(docker,name,'postgres','postgres')
        for _ in range(60):
            try:
                if pg.sql('select 1;')=='1':break
            except RuntimeError:time.sleep(1)
        else:raise RuntimeError('SYNTHETIC_SERVER_DID_NOT_START')
        pg.sql("""create schema extensions;
create extension pg_stat_statements with schema extensions;
create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;
create extension supabase_vault;
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,email text,encrypted_password text);
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon;
create table empresa_usuarios(empresa_id uuid,user_id uuid,activo boolean,rol text,permisos_extra text[] default '{}',permisos_denegados text[] default '{}',primary key(empresa_id,user_id));
create table productos(id uuid primary key,empresa_id uuid,nombre text,marca text,descripcion text,categoria text,proveedor text,codigo_interno text,codigo_barras text,costo_actual numeric,costo_ultima_compra numeric,precio_venta numeric,margen_ganancia numeric,margen_porcentaje numeric,stock_actual numeric,stock_minimo numeric,stock_maximo numeric,unidad_medida text,activo boolean,iva_alicuota_id integer,iva_tasa numeric,precio_incluye_iva boolean);
create table producto_codigos_alias_sigo(empresa_id uuid,producto_id uuid,codigo text,unique(empresa_id,codigo));
alter table productos enable row level security;grant all on productos to anon,authenticated,service_role;
create policy lectura_productos on productos for select to anon,authenticated using(true);
create policy editar_productos on productos for update to anon,authenticated using(true) with check(true);
create policy insertar_productos on productos for insert to anon,authenticated with check(true);
create policy eliminar_productos on productos for delete to anon,authenticated using(true);
create table ventas_sinteticas(id bigserial primary key,total numeric(12,2));insert into ventas_sinteticas(total)values(250.61);
insert into auth.users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','synthetic@example.invalid','synthetic-not-a-real-password');
insert into empresa_usuarios(empresa_id,user_id,activo,rol)values('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,'owner');
insert into productos(id,empresa_id,nombre,marca,categoria,codigo_interno,codigo_barras,costo_actual,costo_ultima_compra,precio_venta,stock_actual,unidad_medida,activo)
select md5(i::text)::uuid,case when i<=10 then '11111111-1111-4111-8111-111111111111'::uuid else'22222222-2222-4222-8222-222222222222'::uuid end,'Artículo sintético '||i,'Marca QA','Ferretería','QA-'||i,'779'||lpad(i::text,10,'0'),1.99,1.99,4.95,10.125,'kg',true from generate_series(1,20)i;
select lo_from_bytea(0,decode('0102030405','hex'));
""")
        migrations=ROOT.parents[2]/'supabase/migrations'
        acl=(migrations/'20260909201500_permisos_backend.sql').read_text()
        pg.sql(acl[acl.index('create or replace function public.permiso_sigo_valido'):acl.index('create or replace function public.permisos_sigo_validos')])
        granular=(migrations/'20260912102000_roles_operativos_hardening.sql').read_text()
        pg.sql(granular[granular.index('create or replace function public.tiene_permiso_empresa'):granular.index('revoke all on function public.tiene_permiso_empresa')])
        yield pg
    finally:
        if started:b.run(docker+['rm','-f','-v',name],timeout=30)
        b.run(docker+['volume','rm',volume],timeout=30)


def public_encrypt(path,out,work):
    home=work/'recipient';home.mkdir(mode=0o700,exist_ok=True)
    b.run(['gpg','--homedir',str(home),'--batch','--import',str(ROOT/'cloud-recovery-public.asc')])
    listing=b.run(['gpg','--homedir',str(home),'--batch','--with-colons','--list-keys']).decode()
    fingerprints=[line.split(':')[9]for line in listing.splitlines()if line.startswith('fpr:')]
    if fingerprints!=[c.FINGERPRINT]:raise RuntimeError('BACKUP_RECIPIENT_KEY_MISMATCH')
    b.run(['gpg','--homedir',str(home),'--batch','--yes','--trust-model','always',
           '--recipient',c.FINGERPRINT,'--cipher-algo','AES256','--output',str(out),'--encrypt',str(path)])


def create_encrypted(pg,work):
    files=work/'capture';files.mkdir(mode=0o700)
    b.capture(pg,files)
    phrase=secrets.token_urlsafe(48)
    encrypted=b.pack(files,work,phrase)
    phrasefile=work/'phrase';phrasefile.write_text(phrase);phrasefile.chmod(0o600)
    wrapped=work/'recovery-phrase.gpg'
    public_encrypt(phrasefile,wrapped,work);phrasefile.unlink()
    checked=work/'checked';checked.mkdir(mode=0o700)
    checked_meta=b.unpack(encrypted,checked,phrase)
    return encrypted,wrapped,checked,checked_meta


def persist(key,meta,paths,run_prefix):
    if not re.fullmatch(re.escape(c.PREFIX)+r'/[A-Za-z0-9_-]+',run_prefix):
        raise RuntimeError('BACKUP_STORAGE_PREFIX_SCOPE_REJECTED')
    allowed=meta.get('allowed_mime_types') or ['*/*']
    binary=any(x in allowed for x in ['*/*','application/octet-stream','application/pgp-encrypted'])
    mime='application/octet-stream' if binary else 'application/json'
    limit=meta.get('file_size_limit') or 50*1024*1024
    raw_size=min(4*1024*1024,limit-4096) if binary else min(3*1024*1024,(limit-4096)*3//4)
    if raw_size<4096:raise RuntimeError('PRIVATE_STORAGE_FILE_LIMIT_INCOMPATIBLE')
    if sum(p.stat().st_size for p in paths)>128*1024*1024:raise RuntimeError('PRIVATE_STORAGE_FREE_QUOTA_SAFETY_LIMIT')
    manifest={'format':'sigo-encrypted-backup-v1','public_recipient':c.FINGERPRINT,'files':[]}
    def put(name,body,content_type):
        relative=run_prefix+'/'+name
        url=c.API+'/storage/v1/object/'+c.BUCKET+'/'+quote(relative,safe='/')
        download=c.API+'/storage/v1/object/authenticated/'+c.BUCKET+'/'+quote(relative,safe='/')
        for attempt in range(3):
            try:
                c.http(url,key,method='POST',data=body,headers={'Content-Type':content_type,'x-upsert':'false'})
            except urllib.error.HTTPError as exc:
                if exc.code not in (400,409,429,500,502,503,504):raise
                # An interrupted upload may already exist: validate it, never overwrite.
            try:
                actual=c.http(download,key)
                if hashlib.sha256(actual).digest()!=hashlib.sha256(body).digest():
                    raise RuntimeError('PRIVATE_STORAGE_READBACK_MISMATCH')
                return relative
            except urllib.error.HTTPError as exc:
                if exc.code not in (404,429,500,502,503,504)or attempt==2:raise
                time.sleep(1+attempt)
        raise RuntimeError('PRIVATE_STORAGE_UPLOAD_NOT_VERIFIED')
    for path in paths:
        if not path.name.endswith('.gpg'):raise RuntimeError('ONLY_ENCRYPTED_BACKUP_FILES_MAY_LEAVE_RUNNER')
        entry={'name':path.name,'sha256':b.digest(path),'chunks':[]}
        with path.open('rb') as f:
            i=0
            for raw in iter(lambda:f.read(raw_size),b''):
                body=raw if binary else json.dumps({'format':'sigo-pgp-ciphertext','base64':base64.b64encode(raw).decode()}).encode()
                name=path.name+'.'+str(i).zfill(5)+('.bin'if binary else'.json')
                relative=put(name,body,mime)
                entry['chunks'].append({'path':relative,'sha256':hashlib.sha256(body).hexdigest(),'encoding':'binary'if binary else'json-base64'})
                i+=1
        manifest['files'].append(entry)
    body=json.dumps(manifest,sort_keys=True).encode()
    put('encrypted-index.json',body,'application/json'if'application/json'in allowed or'*/*'in allowed else mime)
    return {'private_backup_prefix':run_prefix,'ciphertext_archive_sha256':manifest['files'][0]['sha256'],'private_storage_readback':'PASS'}


def exercise(docker,work):
    with fixture(docker) as pg:
        encrypted,wrapped,checked,meta=create_encrypted(pg,work)
    result=b.restore_files(docker,checked,meta,b.RESTORE_IMAGE,candidate_dir=ROOT,candidate_probe=validate_rls_copy)
    return {'status':'PASS_SYNTHETIC_MANAGED_IMAGE','managed_image':b.RESTORE_IMAGE,
            'restore_status':result['restore_status'],'candidate_copy_gate':result['candidate_copy_gate'],
            'restored_copy_security_checks':result['restored_copy_security_checks'],
            'production_capture':False,'backup_artifacts_uploaded':False}


def capture(docker,work,key,storage_meta):
    started=time.monotonic()
    with c.source(docker,work) as pg:
        b.LOG.write_text('')
        encrypted,wrapped,checked,meta=create_encrypted(pg,work)
    prefix=c.PREFIX+'/'+os.environ['GITHUB_RUN_ID']+'-'+os.environ.get('GITHUB_RUN_ATTEMPT','1')+'-'+secrets.token_hex(6)
    # Keep the wrapped random key durable before streaming the larger ciphertext.
    b.phase('private_ciphertext_persistence')
    saved=persist(key,storage_meta,[wrapped,encrypted],prefix)
    saved['ciphertext_archive_sha256']=b.digest(encrypted)
    print(json.dumps({'backup_phase':'private_ciphertext_persisted',**saved},sort_keys=True),flush=True)
    captured_seconds=round(time.monotonic()-started,3)
    b.run(docker+['pull',b.RESTORE_IMAGE])
    result=b.restore_files(docker,checked,meta,b.RESTORE_IMAGE,candidate_dir=ROOT,candidate_probe=validate_rls_copy)
    report={**saved,**result,'status':'PASS_PRODUCTION_DATABASE_ARCHIVE_AND_ISOLATED_COPY',
            'snapshot_exported_at_utc':meta['snapshot_exported_at_utc'],
            'capture_encrypt_and_store_seconds':captured_seconds,'total_seconds':round(time.monotonic()-started,3),
            'production_ddl':False,'production_rls_changes':False,'business_data_changes':False,'backup_artifacts_uploaded':False,
            'application_deployed':False,'storage_scope':'new encrypted backup objects only, existing private bucket'}
    # This report contains no rows/credentials; keep its persistent copy private too.
    allowed=storage_meta.get('allowed_mime_types')or['*/*']
    report_mime='application/json'if'application/json'in allowed or'*/*'in allowed else'application/octet-stream'
    c.http(c.API+'/storage/v1/object/'+c.BUCKET+'/'+quote(prefix+'/verified-report.json',safe='/'),key,
           method='POST',data=json.dumps(report).encode(),headers={'Content-Type':report_mime,'x-upsert':'false'})
    return report
