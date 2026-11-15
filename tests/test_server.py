import unittest
from unittest.mock import patch
import requests
from server import app, identity, parse_records, checked_get, profile_name

HTML = '''<table class="table"><tbody><tr><td>1</td><td><strong>Test 2024 başlık</strong> A, B (2025). DOI:10.2023/example</td></tr><tr><td>2</td><td><strong>Eski</strong> (2024)</td></tr><tr><td>3</td><td><strong>Yılı belirsiz</strong> DOI:10.2025/example</td></tr></tbody></table>'''
class ImportTests(unittest.TestCase):
    def test_exact_year_without_title_or_doi(self):
        records=parse_records(HTML,2025,'https://akademik.yok.gov.tr/','Makale')
        self.assertEqual([r['title'] for r in records], ['Test 2024 başlık', 'Yılı belirsiz'])
        self.assertIsNone(records[1]['year'])
        self.assertTrue(records[1]['dateWarning'])
        self.assertEqual(records[0]['key'],parse_records(HTML,2025,'other','Makale')[0]['key'])
    def test_identity(self):
        self.assertEqual(identity('12345'),'12345')
        self.assertEqual(identity('https://akademik.yok.gov.tr/AkademikArama/view/viewAuthor.jsp?authorId=ABC123'),'ABC123')
        for value in ['https://evil.example/?authorId=123','../secret','']:
            with self.assertRaises(ValueError):identity(value)
    def test_untrusted_url(self):
        with self.assertRaises(ValueError):checked_get(requests.Session(),'https://evil.example/')
    def test_invalid_year(self):
        self.assertEqual(app.test_client().post('/api/yok/import',json={'year':1999,'researcherId':'123'}).status_code,422)
    @patch('server.checked_get')
    def test_import_deduplicates(self, fetch):
        fetch.side_effect=['<div class="profile-user-info"><h3>Test Akademisyen</h3></div><p>Araştırmacı ID : 123</p><a href="/AkademikArama/AkademisyenYayinBilgileri?authorId=123&amp;pubType=abc">Makaleler</a>',HTML]
        result=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':'123'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(len(result.json['records']),2)
    @patch('server.checked_get', side_effect=ValueError('HTTP 403'))
    def test_block_is_not_empty_success(self, fetch):
        result=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':'123'})
        self.assertEqual(result.status_code,422)
        self.assertIn('403',result.json['error'])
    def test_legacy_heading_requires_profile_evidence(self):
        from bs4 import BeautifulSoup
        html='<h4>PROF. DR. TEST AKADEMİSYEN</h4><a href="AkademisyenYayinBilgileri?authorId=ABC">Makaleler</a>'
        self.assertEqual(profile_name(BeautifulSoup(html,'html.parser')), 'PROF. DR. TEST AKADEMİSYEN')
        self.assertIsNone(profile_name(BeautifulSoup('<h4>Sunucu hatası</h4>','html.parser')))
    def test_forbidden_body_with_success_status(self):
        from unittest.mock import Mock
        session=Mock()
        session.get.return_value=Mock(status_code=200,content=b'<h4>4 0 3</h4>Request is forbidden')
        with self.assertRaisesRegex(ValueError, 'erişimi engellendi'):
            checked_get(session,'https://akademik.yok.gov.tr/AkademikArama/view/viewAuthor.jsp')
    @patch('server.checked_get',return_value='<h4>Profil yok</h4>')
    def test_numeric_id_diagnostic(self, fetch):
        result=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':'123'})
        self.assertEqual(result.status_code,422)
        self.assertIn('dönüşümünü desteklemiyor',result.json['error'])
    def test_supplied_yasin_profile_layout(self):
        from bs4 import BeautifulSoup
        html='<h6>DOKTOR ÖĞRETİM ÜYESİ (Unvan:Doçent)</h6><h4>YASİN KÜTÜK</h4><h4></h4><h4>GEBZE TEKNİK ÜNİVERSİTESİ/İŞLETME FAKÜLTESİ</h4><a href="mailto:yasinkutuk@gtu.edu.tr">yasinkutuk[at]gtu.edu.tr</a><p>Araştırmacı ID : 196992</p><p>ORCID:0000-0003-2304-8309</p><h4>SABANCI ÜNİVERSİTESİ</h4>'
        self.assertEqual(profile_name(BeautifulSoup(html,'html.parser')),'YASİN KÜTÜK')
    @patch('server.checked_get')
    def test_wrong_numeric_identity_rejected(self, fetch):
        fetch.return_value='<div class="profile-user-info"><h3>Başka Kişi</h3></div><p>Araştırmacı ID : 111</p>'
        response=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':'196992'})
        self.assertEqual(response.status_code,422)
        self.assertIn('Yanlış kişinin',response.json['error'])
    def test_exact_supplied_url_is_preserved(self):
        from server import profile_target
        url='https://akademik.yok.gov.tr/AkademikArama/AkademisyenGorevOgrenimBilgileri?islem=direct&sira=_D2bDdARDMCOgjHVGzFVZw&authorId=A889BB7F1D78318D'
        self.assertEqual(profile_target(url),('A889BB7F1D78318D',url))
        self.assertEqual(profile_target(url.replace('&','&amp;'))[1],url)
        self.assertEqual(profile_target(url.replace('&', chr(92)+'&'))[1],url)
    def test_safe_redirect_keeps_session_and_final_url(self):
        from unittest.mock import Mock
        from server import checked_get
        session=Mock();session.headers={}
        session.get.side_effect=[Mock(status_code=302, headers={'Location':'view/viewAuthor.jsp'},content=b''),Mock(status_code=200,content=b'<h4>Profile</h4>')]
        page=checked_get(session,'https://akademik.yok.gov.tr/AkademikArama/AkademisyenGorevOgrenimBilgileri?authorId=ABC')
        self.assertEqual(page.url,'https://akademik.yok.gov.tr/AkademikArama/view/viewAuthor.jsp')
        self.assertEqual(session.get.call_count,2)
    def test_external_redirect_not_fetched(self):
        from unittest.mock import Mock
        session=Mock();session.headers={}
        session.get.return_value=Mock(status_code=302,headers={'Location':'https://example.com/'})
        with self.assertRaises(ValueError):checked_get(session,'https://akademik.yok.gov.tr/AkademikArama/view/viewAuthor.jsp')
        self.assertEqual(session.get.call_count,1)
    @patch('server.checked_get')
    def test_import_uses_full_target_and_final_page_for_relative_links(self, fetch):
        from server import YokPage
        target='https://akademik.yok.gov.tr/AkademikArama/AkademisyenGorevOgrenimBilgileri?islem=direct&sira=_D2bDdARDMCOgjHVGzFVZw&authorId=A889BB7F1D78318D'
        final='https://akademik.yok.gov.tr/AkademikArama/view/viewAuthor.jsp'
        fetch.side_effect=[YokPage('<div class="profile-user-info"><h3>YASİN KÜTÜK</h3></div><a href="../AkademisyenYayinBilgileri?pubType=abc">Makaleler</a>',final),HTML]
        response=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':target})
        self.assertEqual(response.status_code,200)
        self.assertEqual(fetch.call_args_list[0].args[1],target)
        self.assertEqual(fetch.call_args_list[1].args[1],'https://akademik.yok.gov.tr/AkademikArama/AkademisyenYayinBilgileri?pubType=abc')
    def test_private_files_not_served(self):
        self.assertEqual(app.test_client().get('/server.py').status_code,404)
        with app.test_client().get('/') as response:
            self.assertEqual(response.status_code,200)
if __name__=='__main__':unittest.main()
