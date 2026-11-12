import base64,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import cloud as c
import cloud_pipeline as p


class CloudGuardas(unittest.TestCase):
    def test_misnamed_service_key_is_not_sent_to_management_api(self):
        with patch.dict(os.environ,{'SUPABASE_ACCESS_TOKEN':'"Bearer sb_secret_synthetic_only"'},clear=True),patch.object(c,'http')as http:
            self.assertEqual(c.storage_key(),'sb_secret_synthetic_only');http.assert_not_called()

    def test_foreign_jwt_key_is_rejected_before_network(self):
        payload=base64.urlsafe_b64encode(json.dumps({'role':'service_role','ref':'other'}).encode()).decode().rstrip('=')
        with patch.dict(os.environ,{'SUPABASE_ACCESS_TOKEN':'fake.'+payload+'.signature'},clear=True),patch.object(c,'http')as http:
            with self.assertRaises(RuntimeError):c.storage_key()
            http.assert_not_called()

    def test_foreign_database_never_probed(self):
        with patch.dict(os.environ,{'SUPABASE_DB_URL':'postgresql://postgres:dummy@db.other.supabase.co:5432/postgres'},clear=True):
            self.assertEqual(list(c.urls()),[])

    def test_password_requires_known_project_and_only_its_region(self):
        with patch.dict(os.environ,{'SUPABASE_DB_PASSWORD':'dummy','SUPABASE_PROJECT_REF':c.b.PROJECT},clear=True):
            values=list(c.urls());self.assertEqual(len(values),2)
            self.assertTrue(all('postgres.'+c.b.PROJECT in v and '-us-east-2.pooler.supabase.com:5432/' in v for v in values))
        with patch.dict(os.environ,{'SUPABASE_DB_PASSWORD':'dummy','SUPABASE_PROJECT_REF':'other'},clear=True):
            self.assertEqual(list(c.urls()),[])

    def test_storage_is_private_and_unchanged(self):
        with patch.object(c,'http',return_value=json.dumps({'id':c.BUCKET,'public':True}).encode()):
            with self.assertRaises(RuntimeError):c.bucket_metadata('dummy')

    def test_only_ciphertext_files_private_paths_no_upsert(self):
        objects={}
        def http(url,key,method='GET',data=None,headers=None,management=False):
            if method=='POST':
                self.assertEqual(headers['x-upsert'],'false')
                objects[url]=data;return b'{}'
            upload_url=url.replace('/object/authenticated/','/object/')
            return objects[upload_url]
        with tempfile.TemporaryDirectory()as d,patch.object(c,'http',http):
            f=Path(d)/'fixture.gpg';f.write_bytes(b'synthetic ciphertext placeholder')
            out=p.persist('dummy',{'allowed_mime_types':['application/json'],'file_size_limit':16384},[f],c.PREFIX+'/synthetic')
            self.assertEqual(out['private_storage_readback'],'PASS')
            self.assertTrue(all('/'+c.PREFIX+'/synthetic/'in u for u in objects))
            plain=Path(d)/'database.dump';plain.write_bytes(b'never upload')
            with self.assertRaises(RuntimeError):p.persist('dummy',{},[plain],c.PREFIX+'/synthetic')


if __name__=='__main__':unittest.main()
