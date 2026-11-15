"""Synthetic contract tests for the live-observed public JSON schema."""
import unittest
from unittest.mock import Mock, patch
from server import app, profile_target
from yok_modern import api_get, list_all, normalize, suggested_draft, collect_modern_profile, search_modern, profile_url, year_value
AUTHOR='ABC123'
TYPES=[{'value':k,'label':v} for k,v in [('a','MAKALE'),('b','KİTAP'),('c','BİLDİRİ'),('e','EDİTÖRLÜK'),('r','HAKEMLİK')]]
ART={'yayinId':1,'yayinAdi':'Test makalesi','yil':'2025','yayinTuruAdi':'SSCI','kapsam':'1'}
DETAIL={**ART,'yazarSayisi':'2','dergiQuartileListesi':[{'metrikTuru':'JCI','yil':'2025','quartile':'Q1'},{'metrikTuru':'JIF','yil':'2025','quartile':'Q2'},{'metrikTuru':'JIF','yil':'2024','quartile':'Q4'}]}
def fake_api(path,params):
    if path=='/akademisyen/detay':return {'authorGuidId':AUTHOR,'personelAdiSoyadi':'Örnek Kişi'}
    if path=='/analiz/total-count-by-academician':return [{'label':'publications','count':4}]
    if path=='/yayin/ana/tur/list':return TYPES
    if path=='/yayin/detay':return DETAIL if str(params['yayinId'])=='1' else {'yayinId':params['yayinId'],'yazarSayisi':'1'}
    if path=='/yayin/list':
        rows={'a':[ART],'b':[{'yayinId':2,'yayinAdi':'Kitap','bolumAdi':'Bölüm','yil':'2025','kapsam':'1','isbn':'123'}],'c':[{'yayinId':3,'yayinAdi':'Özet','yil':'2025','yayinTuruAdi':'Özet bildiri'}],'e':[{'yayinId':4,'yayinAdi':'Editörlük','yil':'2025','yayinTuruAdi':'SSCI'}],'r':[]}[params['yayinAnaTurId']]
    elif path=='/proje/list':rows=[{'projeId':1,'projeAdi':'TÜBİTAK 1001','bitisyil':'2025','projeDurumuAd':'Tamamlandı','projeEkip':[{'authorGuidId':AUTHOR,'projedekiGoreviAd':'Araştırmacı'}]}]
    elif path.startswith('/tez/'):return []
    else:rows=[]
    return {'data':rows,'totalElements':len(rows),'totalPages':int(bool(rows)),'page':1,'length':100}

class ModernTests(unittest.TestCase):
    def test_urls(self):
        self.assertEqual(profile_target(profile_url(AUTHOR)),(AUTHOR,profile_url(AUTHOR)))
        for bad in ['https://evil.example/academician-details?authorGuidId=ABC','https://akademik.yok.gov.tr/academician-details?authorGuidId=../x']:
            with self.assertRaises(ValueError):profile_target(bad)
    def test_api_allowlist(self):
        session=Mock()
        for path in ['https://evil.example/','/admin/user','/tez/yurt/ici/yonetilen/../../secret']:
            with self.assertRaises(ValueError):api_get(session,path,{})
        session.get.assert_not_called()
    def test_redirect_and_html_are_errors(self):
        session=Mock();response=Mock(status_code=302);session.get.return_value=response
        with self.assertRaisesRegex(ValueError,'302'):api_get(session,'/yayin/list',{})
        self.assertFalse(session.get.call_args.kwargs['allow_redirects'])
        response.status_code=200;response.content=b'<p>blocked</p>';response.json.side_effect=ValueError('HTML')
        with self.assertRaisesRegex(ValueError,'JSON'):api_get(session,'/yayin/list',{})
    def test_false_result_is_error(self):
        session=Mock();session.get.return_value=Mock(status_code=200,content=b'{}')
        session.get.return_value.json.return_value={'result':False,'data':[],'errorMessage':'engelli'}
        with self.assertRaisesRegex(ValueError,'engelli'):api_get(session,'/yayin/list',{})
    def test_one_based_pagination(self):
        calls=[]
        def fetch(path,params):
            calls.append(params['page']);return {'data':[{'id':params['page']}],'totalElements':3,'totalPages':3}
        rows,_,_,error=list_all(fetch,'/yayin/list',{},float('inf'))
        self.assertEqual(calls,[1,2,3]);self.assertEqual(len(rows),3);self.assertEqual(error,'')
    def test_partial_page_failure_preserves_rows(self):
        def fetch(path,params):
            if params['page']==2:raise ValueError('HTTP 403')
            return {'data':[{'id':1}],'totalElements':2,'totalPages':2}
        rows,_,_,error=list_all(fetch,'/yayin/list',{},float('inf'))
        self.assertEqual(rows,[{'id':1}]);self.assertIn('403',error)
    def test_empty_with_nonzero_total_is_partial(self):
        rows,_,_,error=list_all(lambda *a:{'data':[],'totalElements':59,'totalPages':1},'/yayin/list',{},float('inf'))
        self.assertEqual(rows,[]);self.assertIn('59',error)
    def test_repeated_page_stops(self):
        rows,_,_,error=list_all(lambda *a:{'data':[{'id':1}],'totalElements':3,'totalPages':3},'/yayin/list',{},float('inf'))
        self.assertEqual(len(rows),1);self.assertIn('tekrarladı',error)
    def test_explicit_authors_and_year_jif(self):
        row=normalize('article',ART,AUTHOR,2025,DETAIL)
        self.assertEqual(row['suggestedDraft']['people'],'2');self.assertEqual(row['suggestedDraft']['quartile'],'Q2')
        self.assertEqual(row['source'],profile_url(AUTHOR))
    def test_conflicting_jif_requires_choice(self):
        d={**DETAIL,'dergiQuartileListesi':DETAIL['dergiQuartileListesi']+[{'metrikTuru':'JIF','yil':'2025','quartile':'Q3'}]}
        hints,notes=suggested_draft('article',d,AUTHOR,2025)
        self.assertNotIn('quartile',hints);self.assertTrue(any('farklı' in n for n in notes))
    def test_no_jci_or_other_year_q_default(self):
        d={**DETAIL,'dergiQuartileListesi':[{'metrikTuru':'JCI','yil':'2025','quartile':'Q1'},{'metrikTuru':'JIF','yil':'2024','quartile':'Q1'}]}
        self.assertNotIn('quartile',suggested_draft('article',d,AUTHOR,2025)[0]);self.assertNotIn('people',suggested_draft('article',ART,AUTHOR,2025)[0])
    def test_chapters_keep_book_identity_and_distinct_ids(self):
        a={'yayinId':1,'yayinAdi':'Aynı kitap','bolumAdi':'Bölüm 1','yil':'2025','isbn':'123','kapsam':'1'};b={**a,'yayinId':2,'bolumAdi':'Bölüm 2'}
        x,y=[normalize('book',r,AUTHOR,2025) for r in (a,b)]
        self.assertEqual(x['title'],'Bölüm 1');self.assertNotEqual(x['key'],y['key']);self.assertEqual(x['suggestedDraft']['bookTitle'],y['suggestedDraft']['bookTitle'])
    def test_project_role_matches_owner_and_no_duration_guess(self):
        p={'projeId':4,'projeAdi':'Proje','projeDurumuAd':'Tamamlandı','baslangicTarihi':'01.01.2020','bitisTarihi':'01.06.2025','projeEkip':[{'authorGuidId':'OTHER','projedekiGoreviAd':'Yürütücü'},{'authorGuidId':AUTHOR,'projedekiGoreviAd':'Araştırmacı'}]}
        row=normalize('project',p,AUTHOR,2025)
        self.assertEqual(row['year'],2025);self.assertEqual(row['suggestedDraft']['role'],'researcher');self.assertNotIn('projectMonths',row['suggestedDraft'])
    def test_ongoing_and_abstract_are_info_only(self):
        row=normalize('project',{'projeId':1,'projeAdi':'Devam','projeDurumuAd':'Devam ediyor','baslangicTarihi':'2025'},AUTHOR,2025)
        self.assertIsNone(row['year']);self.assertTrue(row['scoreExclusion'])
        row=normalize('conference',{'yayinId':2,'yayinAdi':'Özet','yil':'2025','yayinTuruAdi':'Özet bildiri'},AUTHOR,2025)
        self.assertTrue(row['scoreExclusion'])
    def test_course_year_range_not_single_year(self):self.assertIsNone(year_value('2025-2026'))
    def test_wrong_owner_rejected(self):
        with self.assertRaisesRegex(ValueError,'başka'):normalize('course',{'authorGuidId':'OTHER','dersId':1,'dersAdi':'Ders'},AUTHOR,2025)
    def test_full_collection(self):
        calls=[]
        def fetch(path,params):calls.append(path);return fake_api(path,params)
        data=collect_modern_profile(AUTHOR,2025,fetch)
        self.assertFalse(data['partial']);self.assertEqual(len(data['records']),4);self.assertEqual(len(data['sections']),5);self.assertEqual(calls.count('/yayin/detay'),3)
        self.assertNotIn('profile',data);self.assertEqual(set(data['identity']),{'name','source'})
        self.assertTrue(all(p in ('/akademisyen/detay','/yayin/ana/tur/list','/yayin/list','/yayin/detay','/proje/list','/odul/list') for p in calls))
    def test_count_mismatch_reported(self):
        calls=[]
        def fetch(path,params):
            calls.append(path);result=fake_api(path,params)
            if path=='/proje/list':result['totalElements']=2
            return result
        data=collect_modern_profile(AUTHOR,2025,fetch)
        self.assertTrue(data['partial']);self.assertTrue(any('2 kayıt' in s for s in data['warnings']))
        self.assertNotIn('/analiz/total-count-by-academician',calls)
    def test_profile_identity_checked_first(self):
        fetch=Mock(return_value={'authorGuidId':'OTHER','personelAdiSoyadi':'Başka'})
        with self.assertRaisesRegex(ValueError,'kimlik'):collect_modern_profile(AUTHOR,2025,fetch)
        self.assertEqual(fetch.call_count,1)
    def test_name_search_verified_field_and_unrelated_filter(self):
        fetch=Mock(return_value={'data':[{'authorGuidId':AUTHOR,'personelAdiSoyadi':'YASİN KÜTÜK'},{'authorGuidId':'OTHER','personelAdiSoyadi':'Bambaşka'}]})
        self.assertEqual(len(search_modern('Yasin Kütük',fetch)['candidates']),1);self.assertIn('personelAdiSoyadi',fetch.call_args.args[1])
    @patch('server.collect_modern_profile',return_value={'name':'Test','records':[]})
    def test_new_url_routes_modern(self,collect):
        result=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':profile_url(AUTHOR)})
        self.assertEqual(result.status_code,200);collect.assert_called_once_with(AUTHOR,2025)
    @patch('server.collect_modern_profile',return_value={'name':'Test','records':[]})
    def test_updated_ui_uses_modern_for_raw_id(self,collect):
        result=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':AUTHOR,'source':'modern'})
        self.assertEqual(result.status_code,200);collect.assert_called_once_with(AUTHOR,2025)
