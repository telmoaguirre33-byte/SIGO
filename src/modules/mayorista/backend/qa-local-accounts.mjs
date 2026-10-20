import {assertSharedFixture} from '../tests/shared-fixture-policy.mjs';
/** Solo metadata privada dentro del namespace sintético ya validado. */
export async function installQaLocalAccounts(pool){
 await assertSharedFixture(pool);
 await pool.query(`CREATE TABLE IF NOT EXISTS mayorista_private.qa_local_accounts(
  user_id uuid primary key REFERENCES mayorista_private.usuarios(user_id),empresa_id uuid not null,activo boolean not null default true);
  CREATE TABLE IF NOT EXISTS mayorista_private.qa_local_sessions(
  session_id uuid primary key REFERENCES mayorista_private.sesiones(session_id),user_id uuid not null REFERENCES mayorista_private.qa_local_accounts(user_id),empresa_id uuid not null);
  ALTER TABLE mayorista_private.qa_local_accounts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE mayorista_private.qa_local_sessions ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON mayorista_private.qa_local_accounts,mayorista_private.qa_local_sessions FROM public,anon,authenticated;`);
}
