#!/usr/bin/env python3
"""SIGO: captura local de PostgreSQL y restauración exclusivamente sin red.
No instala migraciones en producción ni publica aplicaciones. Python 3.10+, Docker local, GnuPG.
"""
import argparse
import getpass
import hashlib
import json
import os
import re
import secrets
import select
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

PROJECT = 'pafnbxfgpedbvpimjmun'
CLIENT_IMAGE = 'postgres:17.6'
RESTORE_IMAGE = 'supabase/postgres:17.6.1.166'
MAG = 1 << 256
LOG = None


def child_env():
    # Storage credentials belong only to the Python HTTP operator. PostgreSQL
    # clients receive their own private pgpass mount, never administrative API
    # keys. Do not pass either credential set to Docker/GnuPG subprocess envs.
    blocked={'SIGO_BACKUP_STORAGE_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN',
             'SIGO_BACKUP_DATABASE_URL','SUPABASE_DB_URL','SUPABASE_POOLER_URL',
             'SUPABASE_DB_PASSWORD','PGPASSWORD'}
    return {k:v for k,v in os.environ.items()if k not in blocked}


def hidden(prompt):
    # Refuse a fallback that would echo a password in a redirected/headless shell.
    with warnings.catch_warnings():
        warnings.simplefilter('error',getpass.GetPassWarning)
        return getpass.getpass(prompt)


def run(cmd, data=None, output=None, timeout=1800):
    with LOG.open('ab') as err:
        p = subprocess.run(cmd, input=data, stdout=output or subprocess.PIPE,
                           stderr=err, timeout=timeout,env=child_env())
    if p.returncode:
        raise RuntimeError('Comando falló; revisar el diagnóstico PRIVADO. No publicarlo sin redacción.')
    return p.stdout if output is None else None


def from_file(cmd, path):
    with path.open('rb') as src, LOG.open('ab') as err:
        p=subprocess.run(cmd,stdin=src,stdout=subprocess.PIPE,stderr=err,timeout=1800,env=child_env())
    if p.returncode: raise RuntimeError('Falló la lectura local del archive; revisar diagnóstico privado.')
    return p.stdout


def docker_command():
    # Never send credentials/data to a remotely configured Docker daemon.
    for path in [Path('/var/run/docker.sock'), Path.home()/'.docker/run/docker.sock',
                 Path.home()/'.docker/desktop/docker.sock']:
        if path.exists():
            return ['docker', '--host', 'unix://' + str(path)]
    raise RuntimeError('Falta Docker LOCAL iniciado (Linux/macOS/WSL). No usar daemon remoto.')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''):
            h.update(b)
    return h.hexdigest()


def normalized(b):
    lines=[]
    for x in b.splitlines():
        if x.startswith((b'\\restrict ', b'\\unrestrict ',b'-- Dumped from database version ',
                         b'-- Dumped by pg_dump version ',b'-- Started on ',b'-- Completed on ')):
            continue
        # pg_dump emits simple policy target roles by OID. Their creation order
        # changes on restore; canonicalize only this unordered role set.
        # Expressions/commands remain byte-for-byte checked and pg_policies is
        # independently compared. Quoted/exotic roles are deliberately not rewritten.
        if x.startswith(b'CREATE POLICY '):
            m=re.search(rb' TO ([A-Za-z_][A-Za-z0-9_$]*(?:, [A-Za-z_][A-Za-z0-9_$]*)*)(?= USING | WITH CHECK |;$)',x)
            if m: x=x[:m.start(1)]+b', '.join(sorted(m.group(1).split(b', ')))+x[m.end(1):]
        lines.append(x)
    return b'\n'.join(lines)


def ident(s):
    return '"' + s.replace('"', '""') + '"'


def literal(s):
    return "'" + s.replace("'", "''") + "'"


class PG:
    def __init__(self, docker, box, user=None, db=None, service=False, socket='/tmp'):
        self.docker, self.box, self.user, self.db, self.service = docker, box, user, db, service
        self.socket=socket

    def cmd(self, tool, *args):
        cmd = self.docker + ['exec', '-i']
        if self.service:
            cmd += ['-e', 'PGSERVICE=sigo_backup', '-e', 'PGSERVICEFILE=/run/sigo/service',
                    '-e', 'PGPASSFILE=/run/sigo/pgpass',
                    '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c lock_timeout=2000 -c statement_timeout=600000 -c idle_in_transaction_session_timeout=1800000']
        cmd += [self.box, tool]
        if self.user and tool in ('psql', 'pg_dump', 'pg_dumpall', 'pg_restore'):
            cmd += ['-h', self.socket, '-U', self.user]
        if self.db and tool in ('psql', 'pg_dump') and '-d' not in args:
            cmd += ['-d', self.db]
        if self.db and tool == 'pg_dumpall':
            cmd += ['-l', self.db]
        return cmd + list(args)

    def sql(self, q):
        return run(self.cmd('psql', '-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1'),
                   q.encode()).decode().strip()


TABLES = """select coalesce(json_agg(t),'[]'::json) from (
select n.nspname as schema,c.relname as name,
coalesce((select e.extcondition[s] from pg_extension e,generate_subscripts(e.extconfig,1)s
          where e.extconfig[s]=c.oid limit 1),'') as extension_data_condition from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','m') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
and (not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass
  and d.objid=c.oid and d.deptype='e') or exists(select 1 from pg_extension e where c.oid=any(e.extconfig)))
order by n.nspname,c.relname)t;"""
ROLES = """select coalesce(json_agg(r),'[]'::json) from (
select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls
from pg_roles where rolname !~ '^pg_' order by rolname)r;"""
POLICIES = """select coalesce(json_agg(p),'[]'::json) from (
select schemaname,tablename,policyname,permissive,
array(select r from unnest(roles)r order by r) as roles,cmd,qual,with_check
from pg_policies where schemaname !~ '^pg_' order by schemaname,tablename,policyname)p;"""
EXTENSIONS = "select coalesce(json_agg(e),'[]'::json) from(select extname,extversion from pg_extension order by extname)e;"
LARGE_OBJECTS = "select coalesce(json_agg(l),'[]'::json) from(select oid,lomowner::regrole::text as owner,lomacl::text,md5(lo_get(oid)) as data_md5 from pg_largeobject_metadata order by oid)l;"


def prefix(snapshot=None):
    q = 'begin isolation level repeatable read read only;'
    if snapshot:
        q += 'set transaction snapshot ' + literal(snapshot) + ';'
    return q + "set time zone 'UTC';set datestyle='ISO, YMD';set intervalstyle='postgres';set bytea_output='hex';set extra_float_digits=3;"


def table_hash(pg, table, snapshot=None):
    name = ident(table['schema']) + '.' + ident(table['name'])
    q = prefix(snapshot) + 'copy(select to_jsonb(t)::text from only ' + name + ' t ' + table.get('extension_data_condition','') + ')to stdout;commit;'
    count = total = xor = square = 0
    with LOG.open('ab') as err:
        p = subprocess.Popen(pg.cmd('psql', '-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1'),
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err,env=child_env())
        try:
            p.stdin.write(q.encode()); p.stdin.close()
            for row in p.stdout:
                value = int.from_bytes(hashlib.sha256(row).digest(), 'big')
                count += 1; total = (total + value) % MAG; xor ^= value
                square = (square + value*value) % MAG
            if p.wait(timeout=600):
                raise RuntimeError('No se pudo verificar una tabla; no declarar backup completo.')
        finally:
            if p.poll() is None:
                p.kill(); p.wait()
    return {'table':table, 'rows':count, 'sha256_sum':f'{total:064x}',
            'sha256_xor':f'{xor:064x}', 'sha256_square_sum':f'{square:064x}'}


def capture(pg, work, snapshot_hook=None):
    version = int(pg.sql('show server_version_num;'))
    if not 170000 <= version < 180000:
        raise RuntimeError('Se requiere PostgreSQL 17; no continuar con otra versión.')
    roles = run(pg.cmd('pg_dumpall', '--roles-only', '--no-role-passwords', '--no-password'))
    (work/'roles.sql').write_bytes(roles)
    with LOG.open('ab') as err:
        exporter = subprocess.Popen(pg.cmd('psql','-XqAt','--no-password','-v','ON_ERROR_STOP=1'),
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err,env=child_env())
        try:
            exporter.stdin.write(b'begin isolation level repeatable read read only;select pg_export_snapshot();\n')
            exporter.stdin.flush()
            if not select.select([exporter.stdout], [], [], 20)[0]:
                raise RuntimeError('No se pudo exportar el snapshot en 20 segundos.')
            snapshot = exporter.stdout.readline().decode().strip()
            if not re.fullmatch('[0-9A-Fa-f-]+', snapshot):
                raise RuntimeError('Respuesta inesperada al exportar snapshot.')
            snapshot_time=datetime.now(timezone.utc).isoformat()
            if snapshot_hook:
                snapshot_hook()
            pre = prefix(snapshot)
            meta = {k:json.loads(pg.sql(pre+q+'commit;')) for k,q in
                    [('tables',TABLES),('roles',ROLES),('policies',POLICIES),('extensions',EXTENSIONS),('large_objects',LARGE_OBJECTS)]}
            print('Capturando esquema y datos en un único snapshot…', flush=True)
            with (work/'database.dump').open('wb') as f:
                run(pg.cmd('pg_dump','--format=custom','--create','--no-password',
                           '--lock-wait-timeout=5s','--snapshot='+snapshot), output=f)
            schema = run(pg.cmd('pg_dump','--schema-only','--create','--no-password','--snapshot='+snapshot))
            (work/'schema.sql').write_bytes(schema)
            print('Verificando datos del mismo snapshot (sin mostrar registros)…', flush=True)
            meta['tables'] = [table_hash(pg, t, snapshot) for t in meta['tables']]
            after = run(pg.cmd('pg_dumpall','--roles-only','--no-role-passwords','--no-password'))
            if normalized(roles) != normalized(after):
                raise RuntimeError('Roles cambiaron durante captura. Repetir en ventana sin DDL/roles.')
            exporter.stdin.write(b'rollback;\n\\quit\n'); exporter.stdin.flush(); exporter.stdin.close()
            if exporter.wait(timeout=15):
                raise RuntimeError('La sesión exportadora terminó con error.')
        finally:
            if exporter.poll() is None:
                exporter.kill(); exporter.wait()
    toc = from_file(pg.cmd('pg_restore','--list'), work/'database.dump')
    (work/'toc.txt').write_bytes(toc)
    seq = b'\n'.join(line for line in toc.splitlines() if b'SEQUENCE SET ' in line)
    (work/'sequences.list').write_bytes(seq+b'\n')
    # Archive sequence values are authoritative: sequences are not MVCC snapshots.
    run(pg.cmd('sh','-c','cat > /tmp/sigo-sequences.list'),seq+b'\n')
    sequence_sql = from_file(pg.cmd('pg_restore','--use-list=/tmp/sigo-sequences.list',
                                    '--file=-'),work/'database.dump')
    (work/'sequences.sql').write_bytes(sequence_sql)
    parsed = re.findall(rb"SELECT pg_catalog\.setval\('((?:[^']|'')*)', (-?\d+), (true|false)\);",sequence_sql)
    meta['sequences'] = [{'name':n.decode().replace("''","'"),'value':int(v),'called':c==b'true'} for n,v,c in parsed]
    if len(parsed) != sum(b'SEQUENCE SET ' in line for line in seq.splitlines()):
        raise RuntimeError('Formato de secuencias no reconocido: revisión necesaria.')
    meta['database'] = pg.sql('select current_database();')
    meta['schema_sha256'] = hashlib.sha256(normalized(schema)).hexdigest()
    meta['files_sha256'] = {p.name:digest(p) for p in work.iterdir() if p.is_file()}
    meta['captured_at_utc'] = datetime.now(timezone.utc).isoformat()
    meta['snapshot_exported_at_utc'] = snapshot_time
    meta['scope'] = 'PostgreSQL logical database archive plus roles/memberships without passwords'
    meta['not_included'] = ['Role LOGIN passwords','Storage object bytes','External configuration/secrets',
                            'Transient extension-owned tables not included by pg_dump']
    (work/'manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
    return meta


def gpg(datafile, outfile, phrase, decrypt=False):
    with tempfile.TemporaryDirectory(prefix='sigo-gpg-') as home:
        os.chmod(home,0o700)
        args = ['gpg','--homedir',home,'--batch','--yes','--no-symkey-cache',
                '--pinentry-mode','loopback','--passphrase-fd','0','--output',str(outfile)]
        args += ['--decrypt'] if decrypt else ['--symmetric','--cipher-algo','AES256','--s2k-digest-algo','SHA512']
        run(args+[str(datafile)], (phrase+'\n').encode())


def pack(work, folder, phrase):
    tar = folder/'database-private.tar'
    with tarfile.open(tar,'w') as t:
        for p in work.iterdir(): t.add(p,arcname=p.name)
    encrypted = folder/'COMERCIAL-backup.tar.gpg'
    gpg(tar,encrypted,phrase)
    check = folder/'decrypt-check.tar'
    gpg(encrypted,check,phrase,True)
    if digest(tar) != digest(check):
        raise RuntimeError('Falló la comprobación del cifrado.')
    check.unlink(); tar.unlink()
    return encrypted


def unpack(encrypted, folder, phrase):
    tar = folder/'decrypted.tar'
    gpg(encrypted,tar,phrase,True)
    allowed = {'database.dump','roles.sql','schema.sql','toc.txt','sequences.list','sequences.sql','manifest.json'}
    with tarfile.open(tar) as t:
        if set(t.getnames()) != allowed or len(t.getmembers()) != len(allowed):
            raise RuntimeError('El paquete no tiene el inventario exacto esperado.')
        for m in t.getmembers():
            if not m.isfile(): raise RuntimeError('No se admiten enlaces ni directorios en el paquete.')
            with t.extractfile(m) as src,(folder/m.name).open('wb') as dst: shutil.copyfileobj(src,dst)
    tar.unlink()
    meta=json.loads((folder/'manifest.json').read_text())
    for name,expected in meta['files_sha256'].items():
        if name not in allowed or digest(folder/name) != expected:
            raise RuntimeError('Falló la integridad del archive o metadatos.')
    return meta


def restore_files(docker, work, meta, image, keep=False, candidate_dir=None, candidate_probe=None):
    name='sigo-restore-'+secrets.token_hex(6); volume=name+'-data'; box_started=False
    run(docker+['image','inspect',image], timeout=30)
    run(docker+['volume','create','--label','sigo.backup.local=true',volume])
    try:
        run(docker+['run','--rm','--network','none','--user','0','--entrypoint','/bin/sh',
                    '--mount','type=volume,src='+volume+',dst=/sigo-data',image,
                    '-c','chown postgres:postgres /sigo-data; chmod 700 /sigo-data'])
        script="initdb -D /sigo-data -U sigo_restore_operator --auth-local=trust --auth-host=reject --encoding=UTF8 > /tmp/init.log 2>&1 && exec postgres -D /sigo-data -k /tmp -c listen_addresses='' -c shared_preload_libraries=pg_stat_statements"
        run(docker+['run','-d','--network','none','--name',name,'--label','sigo.backup.local=true',
                    '--user','postgres','--entrypoint','/bin/sh','--mount',
                    'type=volume,src='+volume+',dst=/sigo-data',image,'-c',script])
        box_started=True
        info=json.loads(run(docker+['inspect',name]))[0]
        if info['HostConfig']['NetworkMode']!='none' or info['HostConfig']['PortBindings']:
            raise RuntimeError('El destino de restore debe estar sin red ni puertos.')
        pg=PG(docker,name,'sigo_restore_operator','template1')
        for _ in range(60):
            try:
                if pg.sql('select 1;')=='1': break
            except RuntimeError: time.sleep(1)
        else: raise RuntimeError('El PostgreSQL aislado no inició; consultar log privado.')
        run(pg.cmd('psql','-Xq','-v','ON_ERROR_STOP=1'),(work/'roles.sql').read_bytes())
        pg.sql('drop database postgres;') # Only this freshly created, network=none destination.
        with (work/'database.dump').open('rb') as src,LOG.open('ab') as err:
            p=subprocess.run(pg.cmd('pg_restore','--create','--exit-on-error','-d','template1'),
                             stdin=src,stdout=subprocess.DEVNULL,stderr=err,timeout=3600,env=child_env())
            if p.returncode: raise RuntimeError('Restore real falló; NO declarar respaldo recuperable.')
        pg.db=meta['database']
        schema=run(pg.cmd('pg_dump','--schema-only','--create','--no-password'))
        if hashlib.sha256(normalized(schema)).hexdigest()!=meta['schema_sha256']:
            raise RuntimeError('El esquema/ACL/funciones restaurados difieren del original.')
        roles=json.loads(pg.sql(ROLES)); expected_roles=meta['roles']
        roles=[r for r in roles if r['rolname']!='sigo_restore_operator']
        if roles!=expected_roles: raise RuntimeError('Difieren los atributos de roles.')
        def role_sql(b):
            return b'\n'.join(x for x in normalized(b).splitlines() if x and
                              not x.startswith(b'--') and b'sigo_restore_operator' not in x)
        globals_after=run(pg.cmd('pg_dumpall','--roles-only','--no-role-passwords','--no-password'))
        if role_sql(globals_after)!=role_sql((work/'roles.sql').read_bytes()):
            raise RuntimeError('Difieren configuración o membresías de roles restaurados.')
        if json.loads(pg.sql(POLICIES))!=meta['policies']: raise RuntimeError('Difieren políticas RLS.')
        if json.loads(pg.sql(EXTENSIONS))!=meta['extensions']: raise RuntimeError('Difieren extensiones/versiones.')
        if json.loads(pg.sql(LARGE_OBJECTS))!=meta['large_objects']: raise RuntimeError('Difieren large objects.')
        for expected in meta['tables']:
            if table_hash(pg,expected['table'])!=expected:
                raise RuntimeError('Difieren datos restaurados. No aprobar el respaldo.')
        for seq in meta['sequences']:
            # Resolve names using PostgreSQL; the resulting quoted identifier comes from pg_catalog.
            qualified=pg.sql('select format(\'%I.%I\',n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid='+literal(seq['name'])+'::regclass;')
            actual=json.loads(pg.sql('select json_build_object(\'value\',last_value,\'called\',is_called) from '+qualified+';'))
            if actual!={'value':seq['value'],'called':seq['called']}:
                raise RuntimeError('Difiere una secuencia restaurada.')
        candidate_status='NOT_RUN';copy_checks={}
        if candidate_dir:
            candidates=[('catalogo.sql','33dcd3c00c02535f8df262752bc148726345a240de71eb931565f746b8e68046'),
                        ('rls.sql','991d9a777676206cd91f517e8ec09454b54b2051b789350a46433c5a15fc8136')]
            for filename,expected in candidates:
                path=candidate_dir/filename
                if digest(path)!=expected: raise RuntimeError('SQL candidato no coincide con el hash aprobado para ensayo.')
            # These SQL files can only reach this newly created network=none container.
            # Source PG/URI is not present in this object or destination container.
            pg.user='postgres'
            for filename,_ in candidates:
                run(pg.cmd('psql','-Xq','-v','ON_ERROR_STOP=1'),(candidate_dir/filename).read_bytes())
            if pg.sql("select has_table_privilege('anon','public.productos','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')")!='f':
                raise RuntimeError('Falló gate local: permisos anónimos.')
            if pg.sql("select has_table_privilege('authenticated','public.productos','INSERT,UPDATE,DELETE,TRUNCATE')")!='f':
                raise RuntimeError('Falló gate local: permisos de escritura directa.')
            if pg.sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='consultar_productos_sigo' and not p.prosecdef")!='1':
                raise RuntimeError('Falló gate local: contrato del endpoint.')
            null_session="begin read only;set local role authenticated;set local request.jwt.claim.sub='';select count(id)from public.productos;rollback;"
            if pg.sql(null_session)!='0': raise RuntimeError('Falló gate local: acceso sin sesión.')
            if candidate_probe:copy_checks=candidate_probe(pg,meta)
            for expected in meta['tables']:
                if table_hash(pg,expected['table'])!=expected:
                    raise RuntimeError('El ensayo de candidatos alteró filas; NO aprobar gate.')
            candidate_status='PASS_EXACT_SQL_APPLIED_TO_ISOLATED_COPY_ROWS_UNCHANGED'
        return {'restore_status':'PASS_DATABASE_ARCHIVE','destination_network':'none',
                'database_data_schema_roles_policies_acl_sequences':'MATCH',
                'candidate_copy_gate':candidate_status,
                'restored_copy_security_checks':copy_checks,
                'rls_gate_limit':'Synthetic role matrix remains separate; shared consumer scope and production approval still required',
                'scope_limitations':meta['not_included'],
                'deployment_gate':'NOT_AUTHORIZED_BY_THIS_REPORT',
                'container':name if keep else 'removed_after_verification'}
    finally:
        if not keep:
            if box_started: run(docker+['rm','-f','-v',name],timeout=30)
            run(docker+['volume','rm',volume],timeout=30)


def credentials(uri, folder):
    u=urlsplit(uri)
    if u.scheme not in ('postgres','postgresql') or u.port!=5432 or u.hostname is None:
        raise RuntimeError('Se requiere URI PostgreSQL Session pooler, puerto 5432.')
    if not re.fullmatch(r'[a-zA-Z0-9.-]+\.pooler\.supabase\.com',u.hostname):
        raise RuntimeError('El host debe ser el Session pooler oficial de Supabase.')
    if unquote(u.username or '')!='postgres.'+PROJECT or unquote(u.path) not in ('/postgres',''):
        raise RuntimeError('La conexión no corresponde a COMERCIAL/postgres. No continuar.')
    if u.password is None: raise RuntimeError('Falta contraseña PostgreSQL en la URI privada.')
    if any(c in unquote(u.password) for c in '\r\n\x00'):
        raise RuntimeError('Formato de contraseña no admitido en pgpass.')
    if set(parse_qs(u.query)) - {'sslmode'}:
        raise RuntimeError('Usar URI Session pooler sin parámetros adicionales; TLS se fija en verify-full.')
    service='[sigo_backup]\nhost='+u.hostname+'\nport=5432\ndbname=postgres\nuser=postgres.'+PROJECT+'\nsslmode=verify-full\nsslrootcert=system\nconnect_timeout=10\n'
    (folder/'service').write_text(service)
    esc=lambda s:s.replace('\\','\\\\').replace(':','\\:')
    (folder/'pgpass').write_text(':'.join(map(esc,[u.hostname,'5432','postgres','postgres.'+PROJECT,unquote(u.password)]))+'\n')
    for f in folder.iterdir():f.chmod(0o600)


def main():
    global LOG
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['completo','capturar','verificar'])
    p.add_argument('archive',nargs='?')
    p.add_argument('--salida',type=Path,default=Path.home()/'SIGO-respaldos-privados')
    p.add_argument('--imagen-restauracion',default=RESTORE_IMAGE)
    p.add_argument('--ensayar-candidato',action='store_true',help='Ejecutar catalogo.sql/rls.sql exactos SOLO en la copia nueva sin red; nunca en origen.')
    args=p.parse_args()
    for tool in ['docker','gpg']:
        if not shutil.which(tool): raise RuntimeError('Falta '+tool+' instalado en el equipo autorizado.')
    if args.action in ('completo','capturar') and Path('/etc/codex/network-policy.json').exists():
        raise RuntimeError('Esta alternativa se ejecuta en el equipo del titular, fuera del entorno Codex bloqueado. No evade su política TCP.')
    root=args.salida.expanduser().resolve()
    if any((parent/'.git').exists() for parent in [root,*root.parents]):
        raise RuntimeError('La carpeta privada debe estar fuera de cualquier repositorio.')
    root.mkdir(parents=True,exist_ok=True,mode=0o700);root.chmod(0o700)
    folder=root/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(3))
    folder.mkdir(mode=0o700); LOG=folder/'diagnostico-PRIVADO.log'; LOG.touch(mode=0o600)
    print('Directorio PRIVADO: '+str(folder),flush=True)
    docker=docker_command(); run(docker+['info','--format','{{.ServerVersion}}'],timeout=30)
    with tempfile.TemporaryDirectory(prefix='trabajo-',dir=folder) as tmp:
        work=Path(tmp);os.chmod(work,0o700)
        if args.action in ('completo','capturar'):
            print('Sólo COMERCIAL. No migraciones, no ventas. No compartir archivos privados ni contraseñas.')
            uri=os.environ.get('SIGO_BACKUP_DATABASE_URL') or hidden('URI Session pooler COMERCIAL (entrada oculta): ')
            config=work/'conexion';config.mkdir(mode=0o700);credentials(uri,config);uri=None
            run(docker+['pull',CLIENT_IMAGE])
            box='sigo-capture-'+secrets.token_hex(6)
            try:
                run(docker+['run','-d','--name',box,'--user',str(os.getuid())+':'+str(os.getgid()),
                            '--read-only','--tmpfs','/tmp:rw,mode=1777','--cap-drop','ALL',
                            '--security-opt','no-new-privileges','--mount',
                            'type=bind,src='+str(config)+',dst=/run/sigo,readonly',
                            '--entrypoint','/bin/sh',CLIENT_IMAGE,'-c','sleep 2147483647'])
                files=work/'captura';files.mkdir(mode=0o700)
                meta=capture(PG(docker,box,service=True),files)
            finally:
                run(docker+['rm','-f','-v',box],timeout=30)
            print('Captura terminada. Elegir frase de cifrado nueva, distinta de la contraseña de DB.')
            phrase=hidden('Frase de cifrado (mínimo 16 caracteres, guardar en gestor privado): ')
            if len(phrase)<16 or phrase!=hidden('Repetir frase de cifrado: '):
                raise RuntimeError('Frase insuficiente o no coincide. Captura no finalizada.')
            archive=pack(files,folder,phrase)
            report={'status':'CAPTURED_NOT_RESTORED','archive_sha256':digest(archive),
                    'restore_status':'PENDING','production_changes':False,
                    'external_secrets_and_storage_objects':'NOT_INCLUDED'}
            (folder/'estado.json').write_text(json.dumps(report,indent=2))
            print('Archivo cifrado: '+str(archive))
            print('NO es respaldo recuperable verificado hasta ejecutar verificar y obtener PASS.')
            if args.action=='completo':
                checked=work/'verificacion';checked.mkdir(mode=0o700)
                checked_meta=unpack(archive,checked,phrase)
                print('Preparando imagen de restore compatible; destino sin red ni puertos…',flush=True)
                run(docker+['pull',args.imagen_restauracion])
                report=restore_files(docker,checked,checked_meta,args.imagen_restauracion,
                                     candidate_dir=Path(__file__).resolve().parent if args.ensayar_candidato else None)
                report['archive_sha256']=digest(archive)
                report['actual_production_capture_claim']='operator_supplied_connection; not independently observed by Codex'
                (folder/'resultado-sin-secretos.json').write_text(json.dumps(report,indent=2))
                print(json.dumps(report,indent=2))
                print('Informe: '+str(folder/'resultado-sin-secretos.json'))
            phrase=None
        else:
            if not args.archive: raise RuntimeError('Indicar archivo .gpg local; nunca una URL.')
            archive=Path(args.archive).expanduser().resolve()
            phrase=hidden('Frase privada del respaldo (entrada oculta): ')
            meta=unpack(archive,work,phrase);phrase=None
            print('Integridad correcta. Preparando destino Docker sin red ni puertos…',flush=True)
            run(docker+['pull',args.imagen_restauracion])
            report=restore_files(docker,work,meta,args.imagen_restauracion,
                                 candidate_dir=Path(__file__).resolve().parent if args.ensayar_candidato else None)
            report['archive_sha256']=digest(archive)
            report['actual_production_capture_claim']='operator_supplied_archive; not independently observed by Codex'
            (folder/'resultado-sin-secretos.json').write_text(json.dumps(report,indent=2))
            print(json.dumps(report,indent=2))
            print('Informe: '+str(folder/'resultado-sin-secretos.json'))
    print('No se modificó PostgreSQL de producción ni se desplegó la aplicación.')


if __name__=='__main__':
    try:
        main()
    except (Exception,KeyboardInterrupt) as exc:
        # Never echo connection strings, server errors or exception values.
        message='Interrumpido por el operador.' if isinstance(exc,KeyboardInterrupt) else str(exc) if isinstance(exc,RuntimeError) else 'Revisar requisitos y diagnóstico privado; no publicar ese log.'
        print('NO COMPLETADO. '+message,file=sys.stderr)
        if LOG:
            with LOG.open('a') as f: f.write('\nLOCAL_FAILURE_TYPE='+type(exc).__name__+'\n')
        sys.exit(1)
