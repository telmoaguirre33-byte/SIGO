import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import custodia as k
import respaldo as b


class CustodyGuards(unittest.TestCase):
    def test_key_roundtrip_after_discarding_original_home(self):
        with tempfile.TemporaryDirectory() as d:
            work=Path(d);b.LOG=work/'private.log';b.LOG.touch()
            package=k.create_key(work)
            self.assertFalse((work/'new-key').exists())
            # Simulates private storage serialization, not retained GPG keyring.
            persisted=json.dumps(package);fp=package['fingerprint'];package=None
            phrase=work/'phrase';phrase.write_text('synthetic recovery test only')
            recovered=json.loads(persisted)
            wrapped=work/'wrapped.gpg'
            k.public_encrypt(phrase,wrapped,work,recovered)
            self.assertEqual(k.recover_phrase(wrapped,work,json.loads(persisted)),phrase.read_text())
            self.assertEqual(fp,recovered['fingerprint'])
            self.assertFalse((work/'public-only').exists())
            self.assertFalse((work/'recovered-key').exists())

    def test_modified_storage_chunk_fails_before_decryption(self):
        prefix=k.c.PREFIX+'/synthetic'
        index={'format':'sigo-encrypted-backup-v1','public_recipient':'A'*40,'files':[
            {'name':'COMERCIAL-backup.tar.gpg','sha256':'0'*64,'chunks':[
                {'path':prefix+'/a.bin','sha256':hashlib.sha256(b'original').hexdigest(),'encoding':'binary'}]}]}
        with tempfile.TemporaryDirectory() as d,patch.object(k.c,'http',side_effect=[json.dumps(index).encode(),b'changed']):
            with self.assertRaisesRegex(RuntimeError,'CHUNK_HASH_MISMATCH'):
                k.download_persisted('synthetic',prefix,Path(d),'A'*40)

    def test_storage_index_cannot_read_other_prefix(self):
        prefix=k.c.PREFIX+'/synthetic'
        index={'format':'sigo-encrypted-backup-v1','public_recipient':'A'*40,'files':[
            {'name':'recovery-phrase.gpg','sha256':'0'*64,'chunks':[
                {'path':'customer/certificate.pem','sha256':'0'*64,'encoding':'binary'}]}]}
        with tempfile.TemporaryDirectory() as d,patch.object(k.c,'http',return_value=json.dumps(index).encode()) as http:
            with self.assertRaisesRegex(RuntimeError,'OBJECT_REJECTED'):
                k.download_persisted('synthetic',prefix,Path(d),'A'*40)
            self.assertEqual(http.call_count,1)

    def test_unprivileged_vault_access_blocks_key_write(self):
        class Denied:
            def sql(self,q):return 'f'
        with self.assertRaisesRegex(RuntimeError,'PRIVILEGES_REJECTED'):
            k.save_key(Denied(),{'private_key':'synthetic'},'sigo122_recovery_test')


if __name__=='__main__':unittest.main()
