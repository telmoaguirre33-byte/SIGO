-- The CLI linter attempts to install an extension. This preflight never does.
-- The extension must already exist; absence is a visible failure, not a skip.
BEGIN READ ONLY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'plpgsql_check') THEN
    RAISE EXCEPTION 'LINT_EXTENSION_MISSING: read-only preflight cannot install plpgsql_check';
  END IF;
END $$;
SELECT format('%I.plpgsql_check_function', n.nspname) AS lint_function
FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'plpgsql_check'
\gset
-- Same PL/pgSQL/non-trigger coverage and managed-schema exclusions as db lint.
SELECT json_build_object('schema', n.nspname, 'function', p.proname, 'diagnostics', d.issue::json)
FROM pg_catalog.pg_namespace n
JOIN pg_catalog.pg_proc p ON p.pronamespace = n.oid
JOIN pg_catalog.pg_language l ON p.prolang = l.oid
CROSS JOIN LATERAL :lint_function(p.oid, format := 'json') AS d(issue)
WHERE l.lanname = 'plpgsql' AND p.prorettype <> 2279
AND n.nspname NOT LIKE ALL (ARRAY[
  'information\_schema', 'pg\_%', '\_analytics', '\_realtime', '\_supavisor',
  'pgbouncer', 'pgmq', 'pgsodium', 'pgtle', 'supabase\_migrations', 'vault'
]);
ROLLBACK;
