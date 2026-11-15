"""Index statistics, strict publication scope, cache and summary HTTP contract."""
import unittest,time
from unittest.mock import patch
from server import app
from yok_modern import count_publication_indices,publication_summary,_SUMMARY_CACHE

AUTHOR='SUMMARY_TEST'
TYPES=[{'label':'MAKALE','value':'a'},{'label':'BİLDİRİ','value':'c'},{'label':'KİTAP','value':'b'},{'label':'EDİTÖRLÜK','value':'editor'}]
def fake(path,params):
    if path=='/akademisyen/detay':return {'authorGuidId':params['authorGuidId'],'personelAdiSoyadi':'Test Akademisyen','orcid':'SHOULD_NOT_RETURN'}
    if path=='/yayin/ana/tur/list':return TYPES
    if path=='/yayin/list':
        rows={'a':[{'yayinId':1,'yayinTuruAdi':'SSCI','endeksAdi':'SCOPUS'}],'c':[{'yayinId':2,'yayinTuruAdi':'Tam metin bildiri','endeksAdi':'Scopus'}],'b':[{'yayinId':3,'yayinTuruAdi':'Bilimsel Kitap','endeksAdi':'Diğer'}]}[params['yayinAnaTurId']]
        return {'data':rows,'totalElements':len(rows),'totalPages':1}
    raise AssertionError('Unexpected summary request: '+path)

class SummaryTests(unittest.TestCase):
    def test_ssci_does_not_inflate_sci_and_overlap_is_explicit(self):
        result=count_publication_indices([{'yayinId':1,'yayinTuruAdi':'SSCI','endeksAdi':'Scopus'}, {'yayinId':2,'yayinTuruAdi':'SCI-E'}, {'yayinId':3,'endeksAdi':'AHCI'}])
        self.assertEqual(result['counts'],{'SSCI':1,'SCI':1,'AHCI':1,'SCOPUS':1})
        self.assertEqual(result['totalPublications'],3)
    def test_sci_aliases(self):
        rows=[{'yayinId':i,'endeksAdi':label} for i,label in enumerate(['SCI','SCI-E','SCIE','SCI-Expanded','Science Citation Index Expanded'],1)]
        self.assertEqual(count_publication_indices(rows)['counts']['SCI'],5)
    def test_long_index_names(self):
        result=count_publication_indices([{'yayinId':1,'endeksAdi':'Social Sciences Citation Index'}, {'yayinId':2,'endeksAdi':'Arts & Humanities Citation Index'}])
        self.assertEqual(result['counts']['SSCI'],1);self.assertEqual(result['counts']['SCI'],0);self.assertEqual(result['counts']['AHCI'],1)
    def test_title_or_journal_does_not_prove_index(self):
        r=count_publication_indices([{'yayinId':1,'yayinAdi':'SCI and SCOPUS bibliography','yayinYeri':'SSCI Journal','endeksAdi':'Diğer'}])
        self.assertEqual(sum(r['counts'].values()),0);self.assertEqual(r['otherOrUnspecified'],1)
    def test_unique_per_index(self):
        a={'yayinId':1,'yayinTuruAdi':'SSCI'}
        r=count_publication_indices([a,a,{**a,'endeksAdi':'Scopus'}])
        self.assertEqual(r['totalPublications'],1);self.assertEqual(r['counts']['SSCI'],1);self.assertEqual(r['counts']['SCOPUS'],1)
    def test_only_three_publication_types_no_detail_project_or_editor_requests(self):
        calls=[]
        def get(path,params):calls.append((path,params));return fake(path,params)
        r=publication_summary(AUTHOR,get)
        self.assertEqual(r['counts'],{'SSCI':1,'SCI':0,'AHCI':0,'SCOPUS':2});self.assertEqual(r['totalPublications'],3)
        self.assertEqual(r['typeCounts'],{'article':1,'conference':1,'book':1})
        self.assertEqual([params['yayinAnaTurId'] for path,params in calls if path=='/yayin/list'],['a','c','b'])
        self.assertTrue(all(path in ('/akademisyen/detay','/yayin/ana/tur/list','/yayin/list') for path,_ in calls))
        self.assertNotIn('profile',r);self.assertNotIn('orcid',str(r))
    def test_missing_source_type_is_error_not_zero(self):
        def get(path,params):return TYPES[:1] if path=='/yayin/ana/tur/list' else fake(path,params)
        with self.assertRaisesRegex(ValueError,'filtre'):publication_summary(AUTHOR,get)
    def test_wrong_profile_stops_before_lists(self):
        with self.assertRaisesRegex(ValueError,'kimli'):publication_summary(AUTHOR,lambda *a:{'authorGuidId':'OTHER','personelAdiSoyadi':'Başka'})
    def test_genuine_empty_is_zero(self):
        def get(path,params):return {'data':[],'totalElements':0,'totalPages':0} if path=='/yayin/list' else fake(path,params)
        r=publication_summary(AUTHOR,get);self.assertEqual(r['totalPublications'],0);self.assertFalse(r['partial'])
    def test_failed_type_does_not_look_complete(self):
        def get(path,params):
            if path=='/yayin/list' and params['yayinAnaTurId']=='a':raise ValueError('HTTP 403')
            return fake(path,params)
        r=publication_summary(AUTHOR,get);self.assertTrue(r['partial']);self.assertIsNone(r['typeCounts']['article']);self.assertTrue(any('403' in w for w in r['warnings']))
    def test_all_failed_is_error(self):
        def get(path,params):
            if path=='/yayin/list':raise ValueError('HTTP 403')
            return fake(path,params)
        with self.assertRaisesRegex(ValueError,'tamamlanamadı'):publication_summary(AUTHOR,get)
    @patch('yok_modern.api_get',side_effect=lambda session,path,params:fake(path,params))
    def test_cache_is_per_profile_and_refreshable(self,get):
        _SUMMARY_CACHE.clear()
        first=publication_summary(AUTHOR);self.assertEqual(get.call_count,5)
        first['counts']['SSCI']=999
        second=publication_summary(AUTHOR);self.assertEqual(get.call_count,5);self.assertEqual(second['counts']['SSCI'],1)
        publication_summary('OTHER_PROFILE');self.assertEqual(get.call_count,10)
        publication_summary(AUTHOR,refresh=True);self.assertEqual(get.call_count,15)
        _SUMMARY_CACHE[AUTHOR]=(time.monotonic()-301,second)
        publication_summary(AUTHOR);self.assertEqual(get.call_count,20)
        _SUMMARY_CACHE.clear()
    @patch('server.publication_summary',return_value={'counts':{'SSCI':1}})
    def test_route_resolves_profile_link(self,get):
        r=app.test_client().post('/api/yok/publication-summary',json={'researcherId':'https://akademik.yok.gov.tr/academician-details?authorGuidId='+AUTHOR,'refresh':True})
        self.assertEqual(r.status_code,200);get.assert_called_once_with(AUTHOR,refresh=True)
    def test_bad_body_rejected(self):
        for body in [[],{}, {'researcherId':'https://evil.example/'}]:
            self.assertEqual(app.test_client().post('/api/yok/publication-summary',json=body).status_code,422)
