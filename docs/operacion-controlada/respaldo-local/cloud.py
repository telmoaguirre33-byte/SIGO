#!/usr/bin/env python3
"""SIGO #122: operador en Actions, sin artifacts ni SQL productivo de escritura."""
import argparse
import base64
import contextlib
import hashlib
import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
import respaldo as b

ROOT=Path(__file__).resolve().parent
API='https://'+b.PROJECT+'.supabase.co'
BUCKET='arca-secrets'
PREFIX='_sigo_operaciones_respaldo_122'
FINGERPRINT='D580F8EB13D2A678C849F66A07F4E88EF38EDD14'


class NoCredentialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        raise RuntimeError('BACKUP_HTTP_REDIRECT_REJECTED')


def guard_http_destination(url,key,method,headers,management):
    u=urlsplit(url)
    if u.scheme!='https' or u.port not in(None,443)or u.username is not None or u.password is not None or u.fragment:
        raise RuntimeError('BACKUP_HTTP_DESTINATION_REJECTED')
    if management:
        if not(key.startswith('sbp_')and u.hostname=='api.supabase.com' and method=='GET'
               and u.path=='/v1/projects/'+b.PROJECT+'/api-keys' and u.query=='reveal=true'):
            raise RuntimeError('BACKUP_MANAGEMENT_SCOPE_REJECTED')
        return
    if u.hostname!=b.PROJECT+'.supabase.co' or u.query:
        raise RuntimeError('BACKUP_STORAGE_PROJECT_SCOPE_REJECTED')
    if headers and any(k.lower()not in('content-type','x-upsert')for k in headers):
        raise RuntimeError('BACKUP_HTTP_HEADER_OVERRIDE_REJECTED')
    if method=='GET'and u.path=='/storage/v1/bucket/'+BUCKET:return
    relative=re.escape(BUCKET+'/'+PREFIX)+r'/[A-Za-z0-9_-]+/[A-Za-z0-9][A-Za-z0-9_.-]*'
    if method=='GET'and re.fullmatch('/storage/v1/object/authenticated/'+relative,u.path):return
    if method=='POST'and re.fullmatch('/storage/v1/object/'+relative,u.path):
        if headers and headers.get('x-upsert')=='false':return
    raise RuntimeError('BACKUP_STORAGE_PATH_OR_OPERATION_REJECTED')


def http(url, key, method='GET', data=None, headers=None, management=False):
    guard_http_destination(url,key,method,headers,management)
    h={'Authorization':'Bearer '+key}
    if not management:h['apikey']=key
    if headers:h.update(headers)
    req=urllib.request.Request(url,data=data,headers=h,method=method)
    opener=urllib.request.build_opener(NoCredentialRedirect())
    with opener.open(req,timeout=90) as response:return response.read()


def storage_key():
    def clean(value):
        value=value.strip()
        for _ in range(2):
            if len(value)>1 and value[0]in'\"\''and value[-1]==value[0]:value=value[1:-1].strip()
            elif value.lower().startswith('bearer '):value=value[7:].strip()
            else:break
        return value
    def service(value):
        if value.startswith('sb_secret_'):return value
        if value.count('.')==2:
            claims=json.loads(base64.urlsafe_b64decode(value.split('.')[1]+'==='))
            if claims.get('ref')==b.PROJECT and claims.get('role')=='service_role':return value
        raise RuntimeError('STORAGE_KEY_SCOPE_OR_FORMAT_REJECTED')
    value=clean(os.getenv('SUPABASE_SERVICE_ROLE_KEY',''))
    if value:
        return service(value)
    token=clean(os.getenv('SUPABASE_ACCESS_TOKEN',''))
    # Correct a misnamed existing secret without changing its value or sending
    # credentials to another project. Service keys belong on the project API;
    # sbp_ account tokens belong only on the management API.
    if token.startswith('sb_secret_')or token.count('.')==2:return service(token)
    if token:
        values=json.loads(http('https://api.supabase.com/v1/projects/'+b.PROJECT+'/api-keys?reveal=true',token,management=True))
        for item in values:
            if item.get('name')=='service_role' or item.get('role')=='service_role':
                key=item.get('api_key') or item.get('key')
                if key:return service(key)
    raise RuntimeError('MISSING_PRIVATE_STORAGE_CREDENTIAL')


def bucket_metadata(key):
    meta=json.loads(http(API+'/storage/v1/bucket/'+BUCKET,key))
    if meta.get('id')!=BUCKET or meta.get('public') is not False:
        raise RuntimeError('PRIVATE_STORAGE_SCOPE_REJECTED')
    allowed=meta.get('allowed_mime_types')
    if allowed and not any(x in allowed for x in ['*/*','application/octet-stream','application/pgp-encrypted','application/json']):
        raise RuntimeError('PRIVATE_STORAGE_MIME_INCOMPATIBLE')
    return meta


def urls():
    preferred=os.getenv('SIGO_BACKUP_DATABASE_URL','')
    if preferred:
        yield preferred
        return
    seen=set()
    for name in ['SUPABASE_POOLER_URL','SUPABASE_DB_URL']:
        value=os.getenv(name,'')
        if not value:continue
        u=urlsplit(value)
        is_pooler=(u.hostname or '').endswith('.pooler.supabase.com') and unquote(u.username or '')=='postgres.'+b.PROJECT
        is_direct=u.hostname=='db.'+b.PROJECT+'.supabase.co' and unquote(u.username or '')=='postgres'
        if u.scheme not in ('postgres','postgresql') or u.port not in (None,5432) or unquote(u.path) not in ('','/postgres'):
            continue
        if is_pooler and value not in seen:
            seen.add(value);yield value
        elif is_direct and u.password is not None:
            for generation in ['aws-0','aws-1']:
                candidate='postgresql://postgres.'+b.PROJECT+':'+quote(unquote(u.password),safe='')+'@'+generation+'-us-east-2.pooler.supabase.com:5432/postgres'
                if candidate not in seen:seen.add(candidate);yield candidate
    password=os.getenv('SUPABASE_DB_PASSWORD','')
    if password and os.getenv('SUPABASE_PROJECT_REF','')==b.PROJECT:
        for generation in ['aws-0','aws-1']:
            candidate='postgresql://postgres.'+b.PROJECT+':'+quote(password,safe='')+'@'+generation+'-us-east-2.pooler.supabase.com:5432/postgres'
            if candidate not in seen:seen.add(candidate);yield candidate


@contextlib.contextmanager
def source(docker, work):
    candidates=list(urls())
    if not candidates:raise RuntimeError('MISSING_COMERCIAL_SESSION_CONNECTION')
    config=work/'connection';config.mkdir(mode=0o700)
    # Docker's slim client image does not inherit the runner's trusted CA store.
    # Mount the existing trusted system bundle; keep verify-full and hostname checks.
    trusted_ca=Path('/etc/ssl/certs/ca-certificates.crt')
    if not trusted_ca.is_file():raise RuntimeError('RUNNER_TRUSTED_CA_BUNDLE_UNAVAILABLE')
    shutil.copyfile(trusted_ca,config/'trusted-ca.pem')
    official=ROOT/'supabase-ca.crt'
    if hashlib.sha256(official.read_bytes()).hexdigest()!='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7':
        raise RuntimeError('SUPABASE_OFFICIAL_CA_FINGERPRINT_MISMATCH')
    with (config/'trusted-ca.pem').open('ab') as f:f.write(b'\n'+official.read_bytes())
    box='sigo-122-cloud-client-'+secrets.token_hex(6)
    created=False
    try:
        b.run(docker+['pull',b.CLIENT_IMAGE])
        selected=None
        for candidate in candidates:
            try:
                b.credentials(candidate,config)
                service=config/'service'
                service.write_text(service.read_text().replace('sslrootcert=system','sslrootcert=/run/sigo/trusted-ca.pem'))
                if not created:
                    b.run(docker+['run','-d','--name',box,'--user',str(os.getuid())+':'+str(os.getgid()),
                                 '--read-only','--tmpfs','/tmp:rw,mode=1777','--cap-drop','ALL','--security-opt','no-new-privileges',
                                 '--mount','type=bind,src='+str(config)+',dst=/run/sigo,readonly',
                                 '--entrypoint','/bin/sh',b.CLIENT_IMAGE,'-c','sleep 2147483647'])
                    created=True
                pg=b.PG(docker,box,service=True)
                identity=json.loads(pg.sql("begin read only;select json_build_object('db',current_database(),'user',current_user,'read_only',current_setting('transaction_read_only'));rollback;"))
                if identity!={'db':'postgres','user':'postgres','read_only':'on'}:
                    raise RuntimeError('COMERCIAL_CONNECTION_IDENTITY_REJECTED')
                selected=pg;break
            except RuntimeError:continue
        if selected is None:raise RuntimeError('COMERCIAL_SESSION_CONNECTION_FAILED')
        # A failed capture after yield is never retried as another connection.
        yield selected
    finally:
        if created:b.run(docker+['rm','-f','-v',box],timeout=30)
        shutil.rmtree(config,ignore_errors=True)


def safe_error(log):
    s=log.read_text(errors='replace')[-1000000:].lower() if log.exists() else ''
    for code in ['PRODUCT_RLS_FLAGS_OR_OWNER_DRIFT','PRODUCT_RLS_PERMISSION_HELPER_DRIFT',
                 'PRODUCT_POLICY_DRIFT_REVIEW_REQUIRED','PRODUCT_TABLE_ACL_DRIFT_REVIEW_REQUIRED',
                 'PRODUCT_COLUMN_ACL_REVIEW_REQUIRED','PRODUCT_COLUMN_ACL_DRIFT_REVIEW_REQUIRED']:
        if code.lower()in s:return code
    for marker,code in [('permission denied for schema','SCHEMA_PRIVILEGE_DENIED'),
                        ('permission denied for table','TABLE_PRIVILEGE_DENIED'),
                        ('permission denied for function','FUNCTION_PRIVILEGE_DENIED'),
                        ('permission denied to grant role','ROLE_GRANT_PRIVILEGE_DENIED'),
                        ('permission denied to set parameter','PARAMETER_PRIVILEGE_DENIED'),
                        ('password authentication failed','DB_AUTH_FAILED'),('tenant or user not found','POOLER_TENANT_NOT_AVAILABLE'),
                        ('certificate verify failed','TLS_VERIFICATION_FAILED'),('network is unreachable','TCP_UNREACHABLE'),
                        ('could not translate host name','DNS_FAILED'),('permission denied','PRIVILEGE_DENIED'),
                        ('no space left','DISK_FULL'),('is not available','EXTENSION_OR_COMPONENT_MISSING')]:
        if marker in s:return code
    return 'SEE_PRIVATE_DIAGNOSTIC_NO_LOG_EXPORTED'


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['prepare','exercise','capture'])
    args=p.parse_args()
    if os.getenv('GITHUB_REPOSITORY')!='telmoaguirre33-byte/SIGO' or os.getenv('GITHUB_REF')!='refs/heads/ops/122-respaldo-local':
        raise RuntimeError('ONLY_AUTHORIZED_REPOSITORY_AND_OPERATIONS_BRANCH')
    report={'production_ddl':False,'production_rls_changes':False,'business_data_changes':False,'backup_artifacts_uploaded':False}
    with tempfile.TemporaryDirectory(prefix='sigo-122-private-') as tmp:
        work=Path(tmp);b.LOG=work/'diagnostic-private.log';b.LOG.touch(mode=0o600)
        docker=b.docker_command()
        if args.action=='exercise':
            if any(os.getenv(k)for k in ['SIGO_BACKUP_DATABASE_URL','SUPABASE_DB_URL','SUPABASE_POOLER_URL','SUPABASE_DB_PASSWORD','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN']):
                raise RuntimeError('SYNTHETIC_EXERCISE_MUST_NOT_RECEIVE_PRODUCTION_CREDENTIALS')
            import cloud_pipeline
            try:result=cloud_pipeline.exercise(docker,work)
            except Exception:
                # This branch has no production credentials/data; diagnose only
                # the explicitly synthetic managed-image compatibility exercise.
                print('SYNTHETIC_ONLY_DIAGNOSTIC_BEGIN',flush=True)
                print(b.LOG.read_text(errors='replace')[-6000:],flush=True)
                print('SYNTHETIC_ONLY_DIAGNOSTIC_END',flush=True)
                raise
            print(json.dumps(result,sort_keys=True),flush=True);return 0
        try:
            key=storage_key();meta=bucket_metadata(key)
            report['existing_private_storage_access']='PASS'
            report['private_storage_file_limit']=meta.get('file_size_limit')
        except Exception as exc:
            key=None;report['existing_private_storage_access']='NOT_AVAILABLE'
            report['private_storage_reason']='HTTP_'+str(exc.code) if isinstance(exc,urllib.error.HTTPError) else str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__
            report['has_storage_service_key']=bool(os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
            report['has_storage_management_token']=bool(os.getenv('SUPABASE_ACCESS_TOKEN'))
            raw=os.getenv('SUPABASE_ACCESS_TOKEN','').strip().removeprefix('Bearer ').strip().strip('\"\'')
            report['configured_storage_token_kind']='account_pat'if raw.startswith('sbp_')else'jwt'if raw.count('.')==2 else'project_secret'if raw.startswith('sb_secret_')else'unknown'
        try:
            with source(docker,work):report['comercial_tls_session_read_only']='PASS'
        except Exception as exc:
            report['comercial_tls_session_read_only']='NOT_AVAILABLE'
            report['connection_reason']=str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__
            report['connection_diagnostic']=safe_error(b.LOG)
        report['status']='PREPARED' if key and report.get('comercial_tls_session_read_only')=='PASS' else 'NEEDS_PRIVATE_CONFIGURATION'
        print(json.dumps(report,sort_keys=True),flush=True)
        if args.action=='capture':
            if report['status']!='PREPARED':raise RuntimeError('PRIVATE_BACKUP_PREREQUISITES_NOT_APPROVED')
            import cloud_pipeline
            try:result=cloud_pipeline.capture(docker,work,key,meta)
            except Exception:
                print(json.dumps({'status':'CAPTURE_OR_RESTORE_FAILED','diagnostic':safe_error(b.LOG),
                                  'phase':b.PHASE,'production_ddl':False,'backup_artifacts_uploaded':False}),flush=True)
                raise
            print(json.dumps(result,sort_keys=True),flush=True);return 0
    return 0 if report['status']=='PREPARED' else 2


if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:
        error='HTTP_'+str(exc.code)if isinstance(exc,urllib.error.HTTPError)else str(exc)if isinstance(exc,RuntimeError)else type(exc).__name__
        print(json.dumps({'status':'NOT_COMPLETED','error':error,'production_ddl':False}),flush=True)
        sys.exit(1)
