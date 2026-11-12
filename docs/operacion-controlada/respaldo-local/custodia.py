"""Private COMERCIAL recovery: administrator-owned Vault custody and fresh restore.
Only new operational Vault/Storage records; no production catalog/RLS/DML.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote
import cloud as c
import cloud_pipeline as p
import respaldo as b


def key_home(work, name):
    home=work/name
    home.mkdir(mode=0o700)
    return home


def fingerprint(home, secret=False):
    listing=b.run(['gpg','--homedir',str(home),'--batch','--with-colons',
                   '--list-secret-keys' if secret else '--list-keys']).decode()
    found=[x.split(':')[9] for x in listing.splitlines() if x.startswith('fpr:')]
    if len(found)!=1 or not re.fullmatch('[A-F0-9]{40}',found[0]):
        raise RuntimeError('CUSTODY_KEY_IDENTITY_REJECTED')
    return found[0]


def create_key(work):
    home=key_home(work,'new-key')
    b.run(['gpg','--homedir',str(home),'--batch','--pinentry-mode','loopback',
           '--passphrase','','--quick-generate-key','SIGO COMERCIAL Recovery PR122',
           'rsa3072','encr','0'])
    fp=fingerprint(home,True)
    public=b.run(['gpg','--homedir',str(home),'--batch','--armor','--export',fp]).decode()
    private=b.run(['gpg','--homedir',str(home),'--batch','--armor','--export-secret-keys',fp]).decode()
    shutil.rmtree(home)
    return {'fingerprint':fp,'public_key':public,'private_key':private}


def vault_guard(pg):
    ok=pg.sql("""select current_user='postgres' and current_database()='postgres'
and exists(select 1 from pg_extension where extname='supabase_vault')
and not exists(select 1 from (values('anon'),('authenticated'))r(name)
  where has_table_privilege(r.name,'vault.secrets','SELECT')
  or has_any_column_privilege(r.name,'vault.secrets','SELECT')
  or has_table_privilege(r.name,'vault.decrypted_secrets','SELECT')
  or has_any_column_privilege(r.name,'vault.decrypted_secrets','SELECT'));""")
    if ok!='t':raise RuntimeError('CUSTODY_VAULT_PRIVILEGES_REJECTED')


def save_key(pg, package, name):
    if not re.fullmatch(r'sigo122_recovery_[A-Za-z0-9_]+',name):
        raise RuntimeError('CUSTODY_SECRET_NAME_REJECTED')
    vault_guard(pg)
    payload=base64.b64encode(json.dumps(package).encode()).decode()
    # Key bytes travel only as COPY input over the existing verified TLS session.
    # SQL statements/audit text contain no key literal. No SQL is sent via argv.
    query=("begin read write;set local lock_timeout='2s';set local statement_timeout='30s';"
           "create temp table sigo122_key_input(payload text)on commit drop;"
           "copy sigo122_key_input(payload)from stdin;\n"+payload+"\n\\.\n"
           "select vault.create_secret(convert_from(decode(payload,'base64'),'UTF8'),"
           +b.literal(name)+",'SIGO COMERCIAL PR122 recovery key; authorized administrator custody')"
           " from sigo122_key_input;commit;")
    result=pg.sql(query)
    if not re.fullmatch('[0-9a-f-]{36}',result):
        raise RuntimeError('CUSTODY_VAULT_SAVE_FAILED')
    return result


def retrieve_key(pg,name,fp):
    vault_guard(pg)
    package=json.loads(pg.sql('select decrypted_secret from vault.decrypted_secrets where name='+b.literal(name)+';'))
    if package.get('fingerprint')!=fp or not package.get('private_key','').startswith('-----BEGIN PGP PRIVATE KEY BLOCK-----'):
        raise RuntimeError('CUSTODY_RECOVERED_KEY_REJECTED')
    return package


def public_encrypt(path,out,work,package):
    home=key_home(work,'public-only')
    b.run(['gpg','--homedir',str(home),'--batch','--import'],package['public_key'].encode())
    if fingerprint(home)!=package['fingerprint']:
        raise RuntimeError('CUSTODY_PUBLIC_KEY_MISMATCH')
    b.run(['gpg','--homedir',str(home),'--batch','--yes','--trust-model','always',
           '--recipient',package['fingerprint'],'--cipher-algo','AES256',
           '--output',str(out),'--encrypt',str(path)])
    shutil.rmtree(home)


def recover_phrase(wrapped,work,package):
    home=key_home(work,'recovered-key')
    try:
        b.run(['gpg','--homedir',str(home),'--batch','--import'],package['private_key'].encode())
        if fingerprint(home,True)!=package['fingerprint']:
            raise RuntimeError('CUSTODY_PRIVATE_KEY_MISMATCH')
        return b.run(['gpg','--homedir',str(home),'--batch','--decrypt',str(wrapped)]).decode()
    finally:
        shutil.rmtree(home)


def download_persisted(key,prefix,work,fp):
    if not re.fullmatch(re.escape(c.PREFIX)+r'/[A-Za-z0-9_-]+',prefix):
        raise RuntimeError('CUSTODY_BACKUP_PREFIX_REJECTED')
    def get(path):
        if not re.fullmatch(re.escape(prefix)+r'/[A-Za-z0-9][A-Za-z0-9_.-]*',path):
            raise RuntimeError('CUSTODY_BACKUP_OBJECT_REJECTED')
        return c.http(c.API+'/storage/v1/object/authenticated/'+c.BUCKET+'/'+quote(path,safe='/'),key)
    manifest=json.loads(get(prefix+'/encrypted-index.json'))
    if manifest.get('format')!='sigo-encrypted-backup-v1' or manifest.get('public_recipient')!=fp:
        raise RuntimeError('CUSTODY_BACKUP_INDEX_REJECTED')
    files={}
    for entry in manifest['files']:
        name=entry['name']
        if name not in ('recovery-phrase.gpg','COMERCIAL-backup.tar.gpg') or name in files:
            raise RuntimeError('CUSTODY_BACKUP_FILE_REJECTED')
        path=work/name
        with path.open('wb') as out:
            for chunk in entry['chunks']:
                data=get(chunk['path'])
                if hashlib.sha256(data).hexdigest()!=chunk['sha256']:
                    raise RuntimeError('CUSTODY_BACKUP_CHUNK_HASH_MISMATCH')
                if chunk['encoding']=='json-base64':data=base64.b64decode(json.loads(data)['base64'],validate=True)
                elif chunk['encoding']!='binary':raise RuntimeError('CUSTODY_BACKUP_ENCODING_REJECTED')
                out.write(data)
        if b.digest(path)!=entry['sha256']:
            raise RuntimeError('CUSTODY_BACKUP_FILE_HASH_MISMATCH')
        files[name]=path
    if set(files)!={'recovery-phrase.gpg','COMERCIAL-backup.tar.gpg'}:
        raise RuntimeError('CUSTODY_BACKUP_INCOMPLETE')
    return files


def all_tenant_probe(pg,meta):
    result=p.validate_rls_copy(pg,meta)
    probe=b.PG(pg.docker,pg.box,'postgres',meta['database'])
    members=json.loads(probe.sql("""select coalesce(json_agg(t),'[]')from(
select distinct on(eu.empresa_id) eu.empresa_id,eu.user_id from public.empresa_usuarios eu
where eu.activo and eu.user_id is not null order by eu.empresa_id,eu.user_id)t;"""))
    tenants=json.loads(probe.sql("select coalesce(json_agg(t),'[]')from(select empresa_id from public.productos union select empresa_id from public.empresa_usuarios)t where empresa_id is not null;"))
    tenant_array='ARRAY['+','.join(b.literal(t['empresa_id'])+'::uuid' for t in tenants)+']::uuid[]'
    covered=set()
    for member in members:
        company=b.literal(member['empresa_id']);uid=b.literal(member['user_id'])
        claims=b.literal(json.dumps({'sub':member['user_id'],'role':'authenticated'}))
        # Only this restored network=none copy; temporary membership is rolled back.
        q=('begin;update public.empresa_usuarios set rol=\'owner\',permisos_extra=\'{}\',permisos_denegados=\'{}\' '
           'where empresa_id='+company+' and user_id='+uid+';set local request.jwt.claim.sub='+uid+';'
           'set local request.jwt.claims='+claims+';set local role authenticated;'
           'select count(*)from public.productos where not public.tiene_permiso_empresa(empresa_id,\'products.read\');'
           "do $$declare t uuid;begin foreach t in array "+tenant_array+" loop "
           "if not public.tiene_permiso_empresa(t,'products.read') then "
           "begin perform 1 from public.consultar_productos_sigo(t,'',0,1);raise exception 'CROSS_TENANT_ACCEPTED';"
           "exception when others then if sqlerrm<>'FORBIDDEN'then raise;end if;end;end if;end loop;end$$;rollback;")
        if probe.sql(q)!='0':raise RuntimeError('CUSTODY_ALL_COMPANIES_ISOLATION_FAILED')
        covered.add(member['empresa_id'])
    if not covered:raise RuntimeError('CUSTODY_NO_COMPANIES_CHECKED')
    result['all_active_member_companies_checked']=len(covered)
    result['all_company_direct_and_rpc_isolation']='PASS'
    return result


def run_capture(docker,work):
    start=time.monotonic()
    key=c.storage_key();storage_meta=c.bucket_metadata(key)
    nonce=secrets.token_hex(6)
    name='sigo122_recovery_'+os.environ['GITHUB_RUN_ID']+'_'+os.environ.get('GITHUB_RUN_ATTEMPT','1')+'_'+nonce
    package=create_key(work);fp=package['fingerprint']
    with c.source(docker,work) as pg:
        secret_id=save_key(pg,package,name)
        recovered=retrieve_key(pg,name,fp)
        if recovered!=package:raise RuntimeError('CUSTODY_VAULT_READBACK_MISMATCH')
    package=None;recovered=None
    print(json.dumps({'backup_phase':'administrator_vault_custody','vault_secret_name':name,'public_fingerprint':fp,'readback':'PASS'}),flush=True)
    files=work/'capture';files.mkdir(mode=0o700)
    with c.source(docker,work) as pg:
        meta=b.capture(pg,files)
        package=retrieve_key(pg,name,fp)
    phrase=secrets.token_urlsafe(48)
    encrypted=b.pack(files,work,phrase)
    phrasefile=work/'phrase';phrasefile.write_text(phrase)
    wrapped=work/'recovery-phrase.gpg'
    public_encrypt(phrasefile,wrapped,work,package)
    phrasefile.unlink();phrase=None;package=None
    c.FINGERPRINT=fp
    prefix=c.PREFIX+'/'+os.environ['GITHUB_RUN_ID']+'-'+os.environ.get('GITHUB_RUN_ATTEMPT','1')+'-'+nonce
    saved=p.persist(key,storage_meta,[wrapped,encrypted],prefix)
    saved['ciphertext_archive_sha256']=b.digest(encrypted)
    # Discard original plaintext, original local key and ciphertext before recovery.
    shutil.rmtree(files);wrapped.unlink();encrypted.unlink()
    retrieved=work/'downloaded';retrieved.mkdir(mode=0o700)
    downloaded=download_persisted(key,prefix,retrieved,fp)
    with c.source(docker,work) as pg:package=retrieve_key(pg,name,fp)
    phrase=recover_phrase(downloaded['recovery-phrase.gpg'],work,package);package=None
    checked=work/'restored-input';checked.mkdir(mode=0o700)
    restored_meta=b.unpack(downloaded['COMERCIAL-backup.tar.gpg'],checked,phrase);phrase=None
    b.run(docker+['pull',b.RESTORE_IMAGE])
    result=b.restore_files(docker,checked,restored_meta,b.RESTORE_IMAGE,
                          candidate_dir=c.ROOT,candidate_probe=all_tenant_probe,rls_only=True)
    report={**saved,**result,'status':'PASS_ADMIN_CUSTODY_AND_REAL_RESTORE',
            'snapshot_exported_at_utc':meta['snapshot_exported_at_utc'],
            'vault_secret_name':name,'vault_secret_id':secret_id,'public_recipient':fp,
            'key_recovered_from_vault':'PASS','stored_objects_downloaded_and_hash_verified':'PASS',
            'private_key_in_logs_artifacts_or_repository':False,
            'catalogue_production_reexecuted':False,'production_rls_changes':False,
            'business_data_changes':False,'technical_vault_secret_created':True,
            'application_deployed':False,'total_seconds':round(time.monotonic()-start,3)}
    body=json.dumps(report,sort_keys=True).encode()
    c.http(c.API+'/storage/v1/object/'+c.BUCKET+'/'+prefix+'/verified-report.json',key,
           method='POST',data=body,headers={'Content-Type':'application/json','x-upsert':'false'})
    if c.http(c.API+'/storage/v1/object/authenticated/'+c.BUCKET+'/'+prefix+'/verified-report.json',key)!=body:
        raise RuntimeError('CUSTODY_FINAL_REPORT_READBACK_FAILED')
    return report


def run_exercise(docker,work):
    from unittest.mock import patch
    b.phase('synthetic_new_recovery_key')
    package=create_key(work);fp=package['fingerprint'];c.FINGERPRINT=fp
    b.phase('synthetic_fixture_start')
    with p.fixture(docker,vault_key=True) as pg:
        # Synthetic source starts without the catalog already installed in COMERCIAL.
        b.phase('synthetic_existing_catalogue')
        pg.sql((c.ROOT/'catalogo.sql').read_text())
        b.phase('synthetic_vault_save')
        save_key(pg,package,'sigo122_recovery_synthetic')
        package=None
        b.phase('synthetic_vault_retrieve')
        package=retrieve_key(pg,'sigo122_recovery_synthetic',fp)
        files=work/'capture';files.mkdir(mode=0o700);meta=b.capture(pg,files)
        phrase=secrets.token_urlsafe(48)
        encrypted=b.pack(files,work,phrase)
        phrasefile=work/'phrase';phrasefile.write_text(phrase)
        wrapped=work/'recovery-phrase.gpg'
        public_encrypt(phrasefile,wrapped,work,package)
        phrasefile.unlink();phrase=None;package=None
        objects={}
        def synthetic_http(url,key,method='GET',data=None,headers=None,management=False):
            c.guard_http_destination(url,key,method,headers,management)
            if key!='synthetic-storage-only':raise RuntimeError('SYNTHETIC_KEY_ONLY')
            path=url.replace('/object/authenticated/','/object/')
            if method=='POST':
                if path in objects:raise RuntimeError('SYNTHETIC_NO_OVERWRITE')
                objects[path]=data;return b'{}'
            return objects[path]
        prefix=c.PREFIX+'/synthetic-custody'
        with patch.object(c,'http',synthetic_http):
            p.persist('synthetic-storage-only',{'file_size_limit':262144},[wrapped,encrypted],prefix)
            shutil.rmtree(files);wrapped.unlink();encrypted.unlink()
            retrieved=work/'downloaded';retrieved.mkdir(mode=0o700)
            downloaded=download_persisted('synthetic-storage-only',prefix,retrieved,fp)
        package=retrieve_key(pg,'sigo122_recovery_synthetic',fp)
        phrase=recover_phrase(downloaded['recovery-phrase.gpg'],work,package);package=None
        checked=work/'restored-input';checked.mkdir(mode=0o700)
        restored_meta=b.unpack(downloaded['COMERCIAL-backup.tar.gpg'],checked,phrase);phrase=None
    result=b.restore_files(docker,checked,restored_meta,b.RESTORE_IMAGE,
                          candidate_dir=c.ROOT,candidate_probe=all_tenant_probe,rls_only=True)
    return {**result,'status':'PASS_SYNTHETIC_VAULT_KEY_READBACK_AND_DOWNLOAD_RESTORE','production_changes':False}


def main():
    os.umask(0o077)
    if os.getenv('GITHUB_REPOSITORY')!='telmoaguirre33-byte/SIGO' or os.getenv('GITHUB_REF')!='refs/heads/ops/122-custodia-recuperable':
        raise RuntimeError('CUSTODY_ONLY_AUTHORIZED_OPERATOR_BRANCH')
    if sys.argv[1:] not in (['capture'],['exercise']):raise RuntimeError('CUSTODY_ACTION_REJECTED')
    with tempfile.TemporaryDirectory(prefix='sigo122-custody-') as tmp:
        work=Path(tmp);b.LOG=work/'private-diagnostic.log';b.LOG.touch(mode=0o600)
        docker=b.docker_command()
        try:
            if sys.argv[1]=='exercise':
                if any(os.getenv(k)for k in ['SUPABASE_DB_PASSWORD','SUPABASE_DB_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN']):
                    raise RuntimeError('CUSTODY_EXERCISE_MUST_NOT_HAVE_PRODUCTION_SECRETS')
                result=run_exercise(docker,work)
            else:result=run_capture(docker,work)
            print(json.dumps(result,sort_keys=True),flush=True)
        except Exception:
            import traceback
            frames=[{'function':f.name,'line':f.lineno} for f in traceback.extract_tb(sys.exc_info()[2])]
            log=b.LOG.read_text(errors='replace')
            if sys.argv[1]=='exercise':
                messages=[]
                for line in log.splitlines():
                    if 'ERROR:' in line:
                        message=line.split('ERROR:',1)[1]
                        message=re.sub(r"'[^']*'|\"[^\"]*\"",'[quoted value]',message)
                        message=re.sub(r'[A-Za-z0-9+/=_-]{24,}','[value]',message)
                        messages.append(message[:240])
                print(json.dumps({'synthetic_only_redacted_error_classes':messages[-3:]}),flush=True)
            categories=[label for marker,label in [
                ('syntax error','SQL_SYNTAX'),('cannot execute','READ_ONLY_OR_ROLE'),
                ('does not exist','MISSING_OBJECT'),('permission denied','PRIVILEGE_DENIED'),
                ('could not','SERVER_OR_CONNECTION'),('constraint','CONSTRAINT')] if marker in log.lower()]
            print(json.dumps({'safe_failure_frames':frames,'diagnostic_categories':categories,
                              'private_diagnostic':c.safe_error(b.LOG)}),flush=True)
            raise


if __name__=='__main__':
    try:main()
    except Exception as exc:
        code=str(exc)if isinstance(exc,RuntimeError) and re.fullmatch('[A-Z0-9_]+',str(exc))else'PRIVATE_DIAGNOSTIC_ONLY'
        print(json.dumps({'status':'NOT_COMPLETED','error':code,'exception_type':type(exc).__name__,'phase':b.PHASE,'diagnostic':c.safe_error(b.LOG)if b.LOG else'NOT_STARTED'}),flush=True)
        sys.exit(1)
