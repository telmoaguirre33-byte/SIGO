import tempfile
import unittest
import warnings
from pathlib import Path
from unittest.mock import patch
import respaldo as b


class Guardas(unittest.TestCase):
    def test_extension_owner_restore_rejects_any_source_or_other_container(self):
        from types import SimpleNamespace
        for pg in [SimpleNamespace(service=True,box='sigo-restore-synthetic'),SimpleNamespace(service=False,box='source-box')]:
            with self.assertRaises(RuntimeError):b.restore_archive_preserving_extension_owners(pg,Path('/nonexistent'),{})

    def test_schema_diagnostic_never_prints_definitions_names_or_values(self):
        import json
        result=b.schema_difference_summary(b"CREATE FUNCTION private_name()returns text AS $$select 'sensitive_value'$$;",b"SET private_setting = 'other_sensitive_value';")
        encoded=json.dumps(result)
        for hidden in ['private_name','sensitive_value','private_setting','other_sensitive_value']:
            self.assertNotIn(hidden,encoded)
        self.assertFalse(result['same_line_multiset'])
        self.assertTrue(b.schema_difference_summary(b'line a\nline b',b'line b\nline a')['same_line_multiset'])

    def test_bootstrap_restore_keeps_attributes_and_membership_grantor(self):
        sql=b'CREATE ROLE postgres;\nCREATE ROLE supabase_admin;\nALTER ROLE supabase_admin WITH SUPERUSER;\nGRANT pg_monitor TO postgres GRANTED BY supabase_admin;\n'
        restored=b.roles_for_bootstrap(sql,'supabase_admin')
        self.assertEqual(restored,sql.replace(b'CREATE ROLE supabase_admin;\n',b''))
        for bad in [sql.replace(b'CREATE ROLE supabase_admin;\n',b''),sql+b'CREATE ROLE supabase_admin;\n']:
            with self.assertRaises(RuntimeError):b.roles_for_bootstrap(bad,'supabase_admin')
        with self.assertRaises(RuntimeError):b.roles_for_bootstrap(sql,'unreviewed')

    def test_tls_and_pgpass_without_environment_or_argument_secrets(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            b.credentials('postgresql://postgres.'+b.PROJECT+':p%3Aa%5Css@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require',p)
            self.assertIn('sslmode=verify-full', (p/'service').read_text())
            self.assertIn('sslrootcert=system', (p/'service').read_text())
            self.assertIn(r'p\:a\\ss', (p/'pgpass').read_text())
            self.assertEqual((p/'pgpass').stat().st_mode & 0o777, 0o600)

    def test_wrong_connection_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            good='postgresql://postgres.'+b.PROJECT+':dummy@aws-0-us-east-2.pooler.supabase.com:5432/postgres'
            for bad in [good.replace(b.PROJECT,'other'),good.replace(':5432',':6543'),
                        good.replace('.com:','.com.evil.invalid:'),good.replace('/postgres','/other'),
                        good.replace('dummy','bad%0Aline')]:
                with self.subTest(case='invalid connection'),self.assertRaises(RuntimeError):
                    b.credentials(bad,Path(d))

    def test_policy_role_order_only_is_normalized(self):
        a=b'CREATE POLICY p ON public.x FOR SELECT TO authenticated, anon USING (true);'
        c=b'CREATE POLICY p ON public.x FOR SELECT TO anon, authenticated USING (true);'
        self.assertEqual(b.normalized(a),b.normalized(c))
        self.assertNotEqual(b.normalized(a),b.normalized(c.replace(b'(true)',b'(false)')))
        self.assertNotEqual(b.normalized(a),b.normalized(c.replace(b'SELECT',b'DELETE')))
        self.assertNotEqual(b.normalized(a),b.normalized(c.replace(b'anon, ',b'')))

    def test_no_echo_fallback_is_permitted(self):
        def unavailable(prompt):
            warnings.warn('no tty',b.getpass.GetPassWarning)
        with patch.object(b.getpass,'getpass',unavailable):
            with self.assertRaises(b.getpass.GetPassWarning): b.hidden('private: ')


if __name__=='__main__': unittest.main()
