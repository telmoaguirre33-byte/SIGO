import os
import unittest
from unittest.mock import patch
import rls_autorizado as r


class ExactRlsGuards(unittest.TestCase):
    def test_file_bytes_equal_authorized_hash(self):
        self.assertEqual(r.hashlib.sha256(r.approved_bytes()).hexdigest(),r.APPROVED_SHA)

    def test_single_psql_invocation_receives_only_exact_file(self):
        class Source:
            service=True
            def cmd(self,*args):return ['docker','exec','-e','PGOPTIONS=-c default_transaction_read_only=on',*args]
        with patch.object(r.b,'run')as run:
            r.execute_exact_file(Source())
            run.assert_called_once()
            self.assertEqual(run.call_args.args[1],r.approved_bytes())
            self.assertIn('PGOPTIONS=-c default_transaction_read_only=off',run.call_args.args[0])

    def test_non_source_connection_refused_before_sql(self):
        class Other:service=False
        with patch.object(r.b,'run')as run:
            with self.assertRaisesRegex(RuntimeError,'SOURCE_CONNECTION_REQUIRED'):r.execute_exact_file(Other())
            run.assert_not_called()

    def test_missing_explicit_approval_refused_before_network(self):
        with patch.dict(os.environ,{},clear=True),patch.object(r.urllib.request,'urlopen')as http:
            with self.assertRaisesRegex(RuntimeError,'CONSENT_REQUIRED'):r.verify_owner_consent()
            http.assert_not_called()
