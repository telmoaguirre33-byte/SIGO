"""Synthetic only. No cloud credentials, production connections or paid resources."""
import base64, hashlib, hmac, json, os, pathlib, re, secrets, shutil, subprocess, time
ROOT = pathlib.Path.cwd()
WORK = ROOT / ".recovery-private"
OUT = ROOT / "recovery-evidence"
OUT.mkdir(exist_ok=True)
WORK.mkdir(exist_ok=True, mode=0o700)
E = {"executionHead": os.environ.get("GITHUB_SHA"), "productionData": False,
     "productionApplied": False, "providerBackupAccredited": False,
     "upstreamCommit": "d4584290813a59954d7d6f098a5fb31ff433afaa",
     "method": "logical PG17 database archives + custom role + Storage bytes + synthetic Edge files; fresh JWT keys",
     "checks": [], "images": {}, "status": "RUNNING",
     "limits": ["Synthetic self-hosted compatibility only; no COMERCIAL export or restore",
                "OAuth, SMTP/SMS, ARCA, webhooks and external providers disabled; not operational acceptance",
                "Does not relocate commercial release binding or authorize production migrations"]}
def command(args, data=None):
    p = subprocess.run([str(a) for a in args], input=data, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, timeout=600)
    if p.returncode:
        raise RuntimeError("Command failed: " + " ".join(str(a) for a in args[:8]) +
                           "\n" + p.stderr.decode(errors="replace")[-2000:])
    return p.stdout
def dc(stage, *args, data=None):
    return command(["docker", "compose", "-p", "sigo-recovery-"+stage,
                    "-f", WORK/stage/"isolated.json", *args], data)
def sql(stage, text, db="postgres"):
    return dc(stage, "exec", "-T", "db", "psql", "-X", "-v", "ON_ERROR_STOP=1",
              "-U", "supabase_admin", "-d", db, "-At", data=text.encode()).decode().strip()
def jwt(key, role):
    enc=lambda b: base64.urlsafe_b64encode(b).rstrip(b"=")
    t=int(time.time())
    body=enc(json.dumps({"role":role,"iss":"synthetic-recovery","iat":t,"exp":t+7200},separators=(",",":")).encode())
    head=enc(b'{"alg":"HS256","typ":"JWT"}')+b"."+body
    return (head+b"."+enc(hmac.new(key.encode(),head,hashlib.sha256).digest())).decode()
def prepare(stage):
    folder=WORK/stage
    shutil.copytree(ROOT/".recovery-upstream/docker", folder)
    key=secrets.token_hex(32)
    values={"POSTGRES_PASSWORD":secrets.token_hex(24),"JWT_SECRET":key,
      "ANON_KEY":jwt(key,"anon"),"SERVICE_ROLE_KEY":jwt(key,"service_role"),
      "DASHBOARD_PASSWORD":secrets.token_hex(24),"SECRET_KEY_BASE":secrets.token_hex(48),
      "REALTIME_DB_ENC_KEY":secrets.token_hex(8),"VAULT_ENC_KEY":secrets.token_hex(16),
      "PG_META_CRYPTO_KEY":secrets.token_hex(32),"OPENAI_API_KEY":"",
      "LOGFLARE_PUBLIC_ACCESS_TOKEN":secrets.token_hex(24),"LOGFLARE_PRIVATE_ACCESS_TOKEN":secrets.token_hex(24),
      "S3_PROTOCOL_ACCESS_KEY_ID":secrets.token_hex(16),"S3_PROTOCOL_ACCESS_KEY_SECRET":secrets.token_hex(32),
      "ENABLE_EMAIL_AUTOCONFIRM":"true","ENABLE_PHONE_SIGNUP":"false","ENABLE_PHONE_AUTOCONFIRM":"false",
      "SMTP_HOST":"127.0.0.1","SMTP_PORT":"1","SMTP_USER":"","SMTP_PASS":"",
      "SITE_URL":"http://synthetic.invalid","SUPABASE_PUBLIC_URL":"http://api-gw:8000",
      "API_EXTERNAL_URL":"http://api-gw:8000/auth/v1"}
    lines=[]
    for line in (folder/".env.example").read_text().splitlines():
        k=line.split("=",1)[0]
        lines.append(k+"="+values[k] if k in values else line)
    (folder/".env").write_text("\n".join(lines)+"\n")
    # No remote Deno imports, outbound calls, email or cloud credentials.
    (folder/"volumes/functions/main/index.ts").write_text(
        'Deno.serve({port:9000}, () => new Response("synthetic-edge-ok"));\n')
    config=json.loads(command(["docker","compose","--project-directory",folder,
       "--env-file",folder/".env","-f",folder/"docker-compose.yml","config","--no-interpolate","--format","json"]))
    config["name"]="sigo-recovery-"+stage
    config["networks"]={"default":{"internal":True}}
    for name, volume in config.get("volumes",{}).items():
        volume["name"]="sigo-recovery-"+stage+"-"+name
    for service, spec in config["services"].items():
        spec.pop("container_name",None)
        spec.pop("ports",None)
        spec["restart"]="no"
        assert not spec.get("network_mode")
        for vol in spec.get("volumes",[]):
            assert "docker.sock" not in str(vol)
        if service=="supavisor":
            spec["environment"]["RLIMIT_NOFILE"]="65536"
            spec["ulimits"]={"nofile":{"soft":65536,"hard":65536}}
        if service=="db":
            spec["command"] += ["-c","cron.launch_active_jobs=off"]
        if service in ["realtime","supavisor"]:
            spec["environment"]["ERL_FLAGS"]="+S 2:2"
        image=spec["image"]
        if image not in E["images"]:
            command(["docker","pull",image])
            digest=json.loads(command(["docker","image","inspect",image]))[0]["RepoDigests"][0]
            E["images"][image]=digest
        spec["image"]=E["images"][image]
    (folder/"isolated.json").write_text(json.dumps(config))
    private=WORK/(stage+"-client")
    private.mkdir(mode=0o700)
    (private/"config.json").write_text(json.dumps({"anon":values["ANON_KEY"],
        "service":values["SERVICE_ROLE_KEY"],"password":secrets.token_hex(20)}))
    return private
def network(stage):
    name="sigo-recovery-"+stage+"_default"
    n=json.loads(command(["docker","network","inspect",name]))[0]
    assert n["Internal"] is True
    ids=dc(stage,"ps","-q").decode().split()
    for ident in ids:
        d=json.loads(command(["docker","inspect",ident]))[0]
        assert not d["HostConfig"].get("PortBindings")
        assert set(d["NetworkSettings"]["Networks"])=={name}
    # Positive control is performed by real Auth/Storage HTTP tests on this same network.
    probe="""const net=require('node:net');const probe=(host,port,positive)=>new Promise((resolve,reject)=>{const s=net.connect({host,port});s.setTimeout(2000);s.on('connect',()=>{s.destroy();positive?resolve():reject(Error('Unexpected external connectivity'))});s.on('error',e=>positive?reject(e):resolve());s.on('timeout',()=>{s.destroy();positive?reject(Error('Internal control timed out')):resolve()})});(async()=>{await probe('db',5432,true);await Promise.all(['1.1.1.1','8.8.8.8'].map(h=>probe(h,443,false)))})().catch(e=>{console.error(e.message);process.exitCode=1});"""
    command(["docker","run","--rm","--network",name,E["images"]["node:24-alpine"],"node","-e",probe])
    E["checks"].append(stage+": internal network, all containers confined, zero published ports, positive internal DB TCP and two negative external TCP probes")
def client(stage, mode):
    return command(["docker","run","--rm","--network","sigo-recovery-"+stage+"_default",
        "-v",str(WORK/(stage+"-client"))+":/private",
        "-v",str(ROOT/"scripts/recovery-ci/client.mjs")+":/client.mjs:ro",
        E["images"]["node:24-alpine"],"node","/client.mjs",mode])
FIXTURE = """
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;
CREATE ROLE sigo_recovery_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE TABLE public.sigo_recovery_probe (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 tenant_id uuid not null, label text not null);
ALTER TABLE public.sigo_recovery_probe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sigo_recovery_probe FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sigo_recovery_probe TO authenticated;
GRANT USAGE ON SCHEMA public TO sigo_recovery_runtime;
GRANT SELECT ON public.sigo_recovery_probe TO sigo_recovery_runtime;
CREATE POLICY recovery_tenant ON public.sigo_recovery_probe TO authenticated,sigo_recovery_runtime
 USING(user_id=(SELECT auth.uid())) WITH CHECK(user_id=(SELECT auth.uid()));
INSERT INTO public.sigo_recovery_probe(user_id,tenant_id,label)
 SELECT id,gen_random_uuid(),email FROM auth.users WHERE email LIKE '%@recovery.invalid';
CREATE FUNCTION public.sigo_recovery_count() RETURNS bigint LANGUAGE sql STABLE SECURITY INVOKER
 SET search_path='' AS 'SELECT count(*) FROM public.sigo_recovery_probe';
REVOKE ALL ON FUNCTION public.sigo_recovery_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sigo_recovery_count() TO authenticated;
CREATE POLICY recovery_storage_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='synthetic-recovery' AND owner_id=(SELECT auth.uid())::text);
CREATE POLICY recovery_storage_write ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='synthetic-recovery' AND owner_id=(SELECT auth.uid())::text);
SELECT vault.create_secret('synthetic-vault-value','sigo_recovery_secret');
NOTIFY pgrst, 'reload schema';
"""
SNAPSHOT = """
SELECT jsonb_build_object(
'version',current_setting('server_version'),
'extensions',(SELECT jsonb_agg(jsonb_build_array(extname,extversion) ORDER BY extname) FROM pg_extension),
'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolbypassrls,rolcanlogin) ORDER BY rolname) FROM pg_roles),
'memberships',(SELECT jsonb_agg(jsonb_build_array(r.rolname,m.rolname,a.admin_option) ORDER BY r.rolname,m.rolname) FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member),
'policies',(SELECT jsonb_agg(jsonb_build_array(schemaname,tablename,policyname,roles,qual,with_check) ORDER BY schemaname,tablename,policyname) FROM pg_policies),
'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef,p.proconfig,p.proacl) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage')),
'users',(SELECT jsonb_agg(jsonb_build_array(id,email,encrypted_password) ORDER BY id) FROM auth.users),
'probe',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sigo_recovery_probe t),
'objects',(SELECT jsonb_agg(jsonb_build_array(bucket_id,name,owner_id,metadata) ORDER BY bucket_id,name) FROM storage.objects),
'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.sigo_recovery_probe'::regclass)
);
"""
stages=[]
try:
    command(["docker","pull","node:24-alpine"])
    E["images"]["node:24-alpine"]=json.loads(command(["docker","image","inspect","node:24-alpine"]))[0]["RepoDigests"][0]
    source=prepare("source")
    target=prepare("target")
    # Encryption material is part of the private synthetic backup; JWT signing keys remain independent.
    source_env=dict(line.split("=",1) for line in (WORK/"source/.env").read_text().splitlines() if "=" in line and not line.startswith("#"))
    target_lines=[]
    for line in (WORK/"target/.env").read_text().splitlines():
        name=line.split("=",1)[0]
        target_lines.append(name+"="+source_env[name] if name in ("POSTGRES_PASSWORD","VAULT_ENC_KEY") else line)
    (WORK/"target/.env").write_text("\n".join(target_lines)+"\n")
    # The same synthetic passwords are reused only for user login validation, never JWT signing.
    source_cfg=json.loads((source/"config.json").read_text())
    target_cfg=json.loads((target/"config.json").read_text())
    target_cfg["password"]=source_cfg["password"]
    (target/"config.json").write_text(json.dumps(target_cfg))
    stages.append("source")
    print("Starting source database on internal network",flush=True)
    dc("source","up","-d","--wait","--wait-timeout","180","db")
    network("source")
    print("Starting complete source Supabase stack",flush=True)
    dc("source","up","-d","--wait","--wait-timeout","180")
    network("source")
    assert int(sql("source","SHOW server_version_num;"))//10000==17
    E["checks"].append("real Supabase PostgreSQL server 17; pinned official images")
    client("source","seed-auth")
    sql("source",FIXTURE)
    time.sleep(2)
    client("source","seed-storage")
    assert dc("source","exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1","-h","supavisor","-p","5432","-U","postgres.your-tenant-id","-d","postgres","-At","-c","SELECT 'pooler-ready';").decode().strip()=="pooler-ready"
    E["checks"].append("source real GoTrue users/sessions + PostgREST/RLS/RPC + private Storage upload and readback")
    # Quiesce every service before capturing consistent synthetic database and Storage archives.
    dc("source","stop",*[s for s in json.loads((WORK/"source/isolated.json").read_text())["services"] if s!="db"])
    before=sql("source",SNAPSHOT)
    assert sql("source","SELECT decrypted_secret='synthetic-vault-value' FROM vault.decrypted_secrets WHERE name='sigo_recovery_secret';")=="t"
    databases=sql("source","SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname;").splitlines()
    # Preserve every custom/managed role and membership, retaining destination-only passwords.
    role_sql=dc("source","exec","-T","db","pg_dumpall","-U","supabase_admin","--roles-only","--no-role-passwords").decode()
    role_lines=[]
    for line in role_sql.splitlines():
        match=re.fullmatch(r"CREATE ROLE (.+);",line)
        if match:
            ident=match.group(1)
            name=ident[1:-1].replace('""','"') if ident.startswith('"') else ident
            literal="'"+name.replace("'","''")+"'"
            line="DO $recovery$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname="+literal+") THEN CREATE ROLE "+ident+"; END IF; END $recovery$;"
        role_lines.append(line)
    role_sql="\n".join(role_lines)
    archives={}
    for db in databases:
        assert db.replace("_","").isalnum()
        content=dc("source","exec","-T","db","pg_dump","-U","supabase_admin","-Fc","-d",db)
        archives[db]=WORK/(db+".dump")
        archives[db].write_bytes(content)
    key=dc("source","exec","-T","db","sh","-c","if test -f /etc/postgresql-custom/pgsodium_root.key; then cat /etc/postgresql-custom/pgsodium_root.key; fi")
    shutil.copy2(source/"source-users.json",target/"source-users.json")
    # Actual file bytes are backed up separately; PostgreSQL metadata alone is insufficient.
    storage_backup=WORK/"storage.tar"
    command(["sudo","tar","-cpf",storage_backup,"-C",WORK/"source/volumes/storage","."])
    functions_backup=WORK/"functions.tar"
    command(["tar","-cpf",functions_backup,"-C",WORK/"source/volumes/functions","."])
    E["archiveSha256"]={db:hashlib.sha256(p.read_bytes()).hexdigest() for db,p in archives.items()}
    E["storageArchiveSha256"]=hashlib.sha256(storage_backup.read_bytes()).hexdigest()
    dc("source","down","--volumes")
    stages.append("target")
    # Brand new cluster. No target API, Auth, Storage or background consumer runs during restore.
    dc("target","up","-d","--wait","--wait-timeout","180","db")
    network("target")
    if key:
        keyfile=WORK/"synthetic-pgsodium.key"
        keyfile.write_bytes(key)
        ident=dc("target","ps","-q","db").decode().strip()
        dc("target","stop","db")
        command(["docker","cp",keyfile,ident+":/etc/postgresql-custom/pgsodium_root.key"])
        dc("target","up","-d","--wait","--wait-timeout","90","db")
    sql("target",role_sql,db="template1")
    restore_started=time.monotonic()
    for db,path in archives.items():
        sql("target",'DROP DATABASE IF EXISTS "'+db+'" WITH (FORCE);',db="template1")
        sql("target",'CREATE DATABASE "'+db+'" OWNER postgres TEMPLATE template0;',db="template1")
        dc("target","exec","-T","db","pg_restore","--exit-on-error","--single-transaction",
           "-U","supabase_admin","-d",db,data=path.read_bytes())
    assert sql("target",SNAPSHOT)==before, "full database security/catalog/data snapshot differs after restore"
    assert sql("target","SELECT decrypted_secret='synthetic-vault-value' FROM vault.decrypted_secrets WHERE name='sigo_recovery_secret';")=="t"
    command(["sudo","mkdir","-p",WORK/"target/volumes/storage"])
    command(["sudo","tar","-xpf",storage_backup,"-C",WORK/"target/volumes/storage"])
    command(["tar","-xpf",functions_backup,"-C",WORK/"target/volumes/functions"])
    E["checks"].append("all non-template databases restored with PG17 pg_restore --exit-on-error --single-transaction; catalog/roles/RLS/functions/Auth hashes/data identical; Vault decrypts")
    E["restoreSeconds"]=round(time.monotonic()-restore_started,2)
    dc("target","up","-d","--wait","--wait-timeout","180")
    network("target")
    client("target","verify-restored")
    assert dc("target","exec","-T","db","psql","-X","-v","ON_ERROR_STOP=1","-h","supavisor","-p","5432","-U","postgres.your-tenant-id","-d","postgres","-At","-c","SELECT 'pooler-ready';").decode().strip()=="pooler-ready"
    E["checks"].append("real session-pooler SQL succeeds before backup and after restore with preserved synthetic encryption material")
    E["checks"].append("restored real GoTrue password login; preserved users; source JWT and bad password rejected; RLS tenant separation; invoker RPC; Storage SHA256 and private denial; restored synthetic Edge file")
    E["services"]=list(json.loads((WORK/"target/isolated.json").read_text())["services"])
    E["status"]="PASS_SYNTHETIC_FULL_STACK_NOT_COMMERCIAL_ACCREDITATION"
except Exception as error:
    E["status"]="FAIL"
    E["error"]=str(error)
    diagnostics=[]
    for stage in stages:
        try:
            text=dc(stage,"logs","--no-color","--tail","60","supavisor").decode(errors="replace")
            for line in (WORK/stage/".env").read_text().splitlines():
                if "=" in line and re.search(r"PASSWORD|SECRET|KEY|TOKEN",line.split("=",1)[0]):
                    value=line.split("=",1)[1].strip('"')
                    if value:
                        text=text.replace(value,"[REDACTED_SYNTHETIC]")
            diagnostics.append({"stage":stage,"supavisor":text[-12000:]})
        except Exception: pass
    E["diagnostics"]=diagnostics
    raise
finally:
    (OUT/"result.json").write_text(json.dumps(E,indent=2)+"\n")
    print(json.dumps({"status":E["status"],"checks":E["checks"],"error":E.get("error"),"diagnostics":E.get("diagnostics")},indent=2))
    for stage in stages:
        try: dc(stage,"down","--volumes","--remove-orphans")
        except Exception: pass
