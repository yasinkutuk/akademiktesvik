"""Synthetic fixtures for all 11 supplied endpoints. No live access claims."""
import unittest
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs
from server import app, parse_records, BASE, YokPage
from yok_profile import SECTION_SPECS, seed_sections, section_links, parse_section, collect_profile

PROFILE = '<div class="profile-user-info"><h3>Örnek Akademisyen</h3></div><p>ORCID: 0000-0000-0000-0000</p>'


class ProfileTests(unittest.TestCase):
    def test_only_five_seeds_and_supplied_tokens(self):
        seeds = seed_sections(PROFILE, BASE, '598E2C85E193D914')
        self.assertEqual(len(seeds), 5)
        self.assertEqual(len({key for _, key in seeds}), 5)
        for url, key in seeds:
            self.assertEqual(parse_qs(urlparse(url).query)['authorId'], ['598E2C85E193D914'])
        self.assertEqual(parse_qs(urlparse(seeds[0][0]).query)['pubType'], ['q3SMeouSUM6tBWypaNs06Q'])

    def test_discovered_per_profile_token_takes_precedence(self):
        profile=PROFILE+'<a href="AkademisyenYayinBilgileri?authorId=ABC&amp;pubType=observed">Kitaplar</a>'
        seeds=seed_sections(profile,BASE,'ABC')
        self.assertIn('pubType=observed',seeds[0][0])

    def test_all_types_plain_table_rows_and_all_years(self):
        for key,label,_,_,categories in SECTION_SPECS:
            with self.subTest(key=key):
                title='<strong>Örnek eser</strong>' if key in ('book','article','conference') else 'Örnek görev veya faaliyet'
                page=f'<table><tr><th>Yıl</th><th>Kayıt</th></tr><tr><td>2025</td><td>{title}</td></tr><tr><td>2020</td><td><strong>Eski faaliyet</strong></td></tr></table>'
                rows=parse_section(page,key,2025,BASE,parse_records)
                self.assertEqual(len(rows),2)
                self.assertEqual({r['year'] for r in rows},{2025,2020})
                self.assertTrue(all(r['scoreCategories']==categories for r in rows))

    def test_project_completion_and_explicit_hints(self):
        page='<table><tr><td><b>TÜBİTAK 1001 projesi</b> Başlangıç: 01.01.2022 Bitiş Tarihi: 03.06.2025 Görev: Araştırmacı Destek Süresi: 36 ay</td></tr></table>'
        row=parse_section(page,'project',2025,BASE,parse_records)[0]
        self.assertEqual(row['year'],2025)
        self.assertEqual(row['suggestedDraft'],{'role':'researcher','projectMonths':'36','activityId':'1.1'})

    def test_project_completion_column_labels_preserved(self):
        page='<table><thead><tr><th>Proje Adı</th><th>Başlangıç Tarihi</th><th>Bitiş Tarihi</th><th>Görev</th></tr></thead><tbody><tr><td>TÜBİTAK 1001 Örnek Projesi</td><td>01.01.2022</td><td>06.09.2025</td><td>Yürütücü</td></tr></tbody></table>'
        row=parse_section(page,'project',2025,BASE,parse_records)[0]
        self.assertEqual(row['year'],2025)
        self.assertIn('Bitiş Tarihi: 06.09.2025',row['metadata'])
        self.assertEqual(row['suggestedDraft']['role'],'leader')

    def test_pasted_section_link_resolves_profile(self):
        from server import profile_target
        author,url=profile_target(BASE+'AkademisyenYayinBilgileri?pubType=q3SMeouSUM6tBWypaNs06Q&authorId=598E2C85E193D914')
        self.assertEqual(author,'598E2C85E193D914')
        self.assertIn('AkademisyenGorevOgrenimBilgileri',url)

    def test_unknown_fields_do_not_default_to_single_author_or_q1(self):
        page='<table><tr><td><strong>Örnek Makale</strong> (2025) DOI:10.2024/example</td></tr></table>'
        row=parse_section(page,'article',2025,BASE,parse_records)[0]
        self.assertNotIn('people',row['suggestedDraft'])
        self.assertNotIn('quartile',row['suggestedDraft'])

    def test_source_and_category_names_never_generate_fake_activities(self):
        with self.assertRaisesRegex(ValueError,'kapsamı dışında'):
            parse_section('<p>Henüz bilgi girilmedi.</p>','course',2025,BASE,parse_records)

    def test_foreign_author_and_external_urls_not_followed(self):
        page='<a href="https://evil.example/AkademikArama/AkademisyenProjeBilgileri?authorId=ABC">Projeler</a><a href="AkademisyenPatentBilgileri?authorId=OTHER">Patentler</a>'
        self.assertEqual(section_links(page,BASE,'ABC'),[])

    def test_relative_pager_preserves_observed_pubtype(self):
        base=BASE+'AkademisyenYayinBilgileri?authorId=ABC&pubType=observed'
        targets=section_links('<a href="?page=2">2</a>',base,'ABC','article')
        self.assertEqual(len(targets),1)
        self.assertEqual(parse_qs(urlparse(targets[0][0]).query)['pubType'],['observed'])

    def test_collect_reports_each_failed_empty_and_unparsed_section(self):
        def fetch(session,url):
            endpoint=urlparse(url).path
            if 'Odul' in endpoint:
                raise ValueError('HTTP 403')
            if 'Proje' in endpoint:
                return '<p>Bu bölümün yapısı değişmiş.</p>'
            return '<p>Kayıt bulunmamaktadır.</p>'
        data=collect_profile(None,PROFILE,BASE,'ABC','Örnek Akademisyen',2025,fetch,parse_records)
        reports={s['id']:s for s in data['sections']}
        self.assertEqual(len(reports),5)
        self.assertEqual(reports['award']['status'],'failed')
        self.assertEqual(reports['book']['status'],'empty')
        self.assertEqual(reports['project']['status'],'unparsed')
        self.assertIn('yapısı değişmiş',reports['project']['rawText'])
        self.assertTrue(data['partial'])
        self.assertEqual(data['records'],[])

    @patch('server.checked_get')
    def test_full_scope_endpoint_collects_five_sections_same_session(self,fetch):
        def response(session,url):
            if 'GorevOgrenim' in url:
                return YokPage(PROFILE,BASE+'view/viewAuthor.jsp')
            return f'<table><tr><td>2025</td><td><strong>{urlparse(url).path} {parse_qs(urlparse(url).query).get("pubType",[""])[0]}</strong></td></tr></table>'
        fetch.side_effect=response
        result=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':'ABC','scope':'profile'})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(len(result.json['sections']),5)
        self.assertEqual(len(result.json['records']),5)
        self.assertFalse(result.json['partial'])
        self.assertEqual(fetch.call_count,6)
        self.assertEqual(len({id(c.args[0]) for c in fetch.call_args_list}),1)
        self.assertNotIn('profile',result.json)
        self.assertEqual(set(result.json['identity']),{'name','source'})

    def test_same_title_different_sections_do_not_merge(self):
        page='<table><tr><td><strong>Ortak başlık</strong> (2025)</td></tr></table>'
        book=parse_section(page,'book',2025,BASE,parse_records)[0]
        article=parse_section(page,'article',2025,BASE,parse_records)[0]
        self.assertNotEqual(book['key'],article['key'])


class SavedHtmlTests(unittest.TestCase):
    @patch('server.checked_get')
    def test_saved_pages_parse_without_any_network_request(self,fetch):
        pages=[{'section':'book','content':'<table><tr><td><b>Kaydedilmiş kitap</b> (2025)</td></tr></table>'},
               {'section':'award','content':'<table><tr><td>2025</td><td>Örnek ödül</td></tr></table>'}]
        response=app.test_client().post('/api/yok/import-html',json={'year':2025,'researcherId':'ABC','name':'Örnek Akademisyen','pages':pages})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['origin'],'saved-html')
        self.assertEqual(len(response.json['records']),2)
        self.assertEqual(len(response.json['sections']),5)
        self.assertTrue(response.json['partial'])
        self.assertFalse(fetch.called)

    def test_saved_profile_pages_are_no_longer_accepted(self):
        response=app.test_client().post('/api/yok/import-html',json={'year':2025,'researcherId':'ABC','name':'Örnek Akademisyen','pages':[{'section':'profile','content':PROFILE}]})
        self.assertEqual(response.status_code,422)
    def test_forbidden_html_does_not_become_a_fake_record(self):
        response=app.test_client().post('/api/yok/import-html',json={'year':2025,'researcherId':'ABC','name':'Örnek Akademisyen','pages':[{'section':'book','content':'<h1>Request is forbidden</h1>'}]})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['records'],[])
        self.assertTrue(response.json['partial'])
        self.assertEqual(response.json['sections'][0]['status'],'failed')

    def test_invalid_or_unassigned_pages_rejected(self):
        for pages in ([],[{'section':'unknown','content':'<p>Test</p>'}],[None]):
            response=app.test_client().post('/api/yok/import-html',json={'year':2025,'researcherId':'ABC','name':'Örnek Akademisyen','pages':pages})
            self.assertEqual(response.status_code,422)
