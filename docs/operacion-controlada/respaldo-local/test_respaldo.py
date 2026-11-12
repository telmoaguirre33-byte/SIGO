import tempfile
import unittest
import warnings
from pathlib import Path
from unittest.mock import patch
import respaldo as b


class Guardas(unittest.TestCase):
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
