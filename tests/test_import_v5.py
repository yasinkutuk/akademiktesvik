"""Offline HTML layout and HTTP regressions; fixtures are synthetic, not live YÖK captures."""
import unittest
from unittest.mock import patch, Mock
from server import app, publication_kind, parse_records, publication_links, profile_target, checked_get, BASE, YokPage

PROFILE = '<div class="profile-user-info"><h3>Örnek Akademisyen</h3></div>'

def link(token, label, extra=''):
    return f'<a href="{BASE}AkademisyenYayinBilgileri?authorId=ABC&amp;pubType={token}{extra}">{label}</a>'


class V5Tests(unittest.TestCase):
    def test_bootstraps_raw_author_in_profile_controller(self):
        self.assertIn('AkademisyenGorevOgrenimBilgileri?', profile_target('ABC')[1])

    def test_single_cell_book_and_explicit_year_column(self):
        html = '<table><tr><td><div class="baslika"><strong><a>Kitap başlığı 2021</a></strong></div>Yazar A. Basım Yılı: 2025 ISBN:97820240000</td></tr><tr><td>2025</td><td><b>İkinci kitap</b> Yayınevi</td></tr></table>'
        rows = parse_records(html, 2025, BASE, 'Kitaplar')
        self.assertEqual([r['title'] for r in rows], ['Kitap başlığı 2021', 'İkinci kitap'])
        self.assertTrue(all(r['year'] == 2025 and r['kind'] == 'Kitap' for r in rows))

    def test_conference_dates_and_doi_not_a_date(self):
        html = '<table><tr><td><b>Birinci bildiri</b> Kongre: 10-12 Mayıs 2025</td></tr><tr><td><b>İkinci bildiri</b> 21.09.2025</td></tr><tr><td><b>DOI başlık</b> DOI:10.10.2025/example</td></tr></table>'
        rows = parse_records(html, 2025, BASE, 'Bildiriler')
        self.assertEqual([r['year'] for r in rows], [2025, 2025, None])
        self.assertTrue(all(r['kind'] == 'Bildiri' for r in rows))

    def test_conflicting_dates_require_review(self):
        rows=parse_records('<table><tr><td><strong>Belirsiz</strong> (2024) (2025)</td></tr></table>',2025,BASE,'Makale')
        self.assertIsNone(rows[0]['year'])
        self.assertTrue(rows[0]['dateWarning'])

    def test_discovers_click_and_data_tabs_without_guessing_tokens(self):
        content = f'<button onclick="location.href=\'AkademisyenYayinBilgileri?authorId=ABC&pubType=opaque\'">Kitaplar</button><a data-href="AkademisyenYayinBilgileri?pubType=other">Bildiriler</a>'
        links=publication_links(content,BASE,'ABC')
        self.assertEqual(len(links),2)
        self.assertEqual([label for _,label in links], ['Kitaplar','Bildiriler'])
        self.assertFalse(publication_links(link('x','Makaleler').replace('authorId=ABC','authorId=OTHER'), BASE,'ABC'))

    def test_turkish_uppercase_kind(self):
        self.assertEqual(publication_kind('BİLDİRİLER'), 'Bildiri')
        self.assertEqual(publication_kind('KİTAPLAR'), 'Kitap')

    def test_query_relative_pagination(self):
        base=BASE+'AkademisyenYayinBilgileri?authorId=ABC&pubType=opaque'
        links=publication_links('<a href="?authorId=ABC&amp;pubType=opaque&amp;page=2">2</a>',base,'ABC','Makaleler')
        self.assertEqual(len(links),1)
        self.assertIn('page=2',links[0][0])
        self.assertEqual(links[0][1],'Makaleler')

    @patch('server.checked_get')
    def test_all_types_and_pagination_same_session(self, fetch):
        profile=PROFILE + link('article','Makaleler')+link('book','Kitaplar')+link('conf','Bildiriler')
        pages=[profile,
          '<table><tr><td><strong>Makale A</strong> (2025)</td></tr></table>'+link('article','2','&amp;page=2'),
          '<table><tr><td><b>Kitap A</b> Yıl: 2025</td></tr></table>',
          '<table><tr><td><b>Bildiri A</b> 01.06.2025</td></tr></table>',
          '<table><tr><td><strong>Makale B</strong> (2025)</td></tr><tr><td><strong>Makale A</strong> (2025)</td></tr></table>']
        fetch.side_effect=pages
        response=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':'ABC'})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(len(response.json['records']),4)
        self.assertEqual({r['kind'] for r in response.json['records']},{'Makale','Kitap','Bildiri'})
        self.assertEqual(fetch.call_count,5)
        self.assertEqual(len({id(c.args[0]) for c in fetch.call_args_list}),1)

    @patch('server.checked_get')
    def test_one_failed_tab_reported_as_partial(self, fetch):
        fetch.side_effect=[PROFILE+link('a','Makaleler')+link('b','Kitaplar'),'<table><tr><td><b>Makale</b> (2025)</td></tr></table>',ValueError('HTTP 403')]
        response=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':'ABC'})
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.json['partial'])
        self.assertTrue(any('403' in w for w in response.json['warnings']))

    @patch('server.checked_get')
    def test_all_failed_tabs_are_not_empty_success(self, fetch):
        fetch.side_effect=[PROFILE+link('a','Makaleler'),ValueError('HTTP 403')]
        response=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':'ABC'})
        self.assertEqual(response.status_code,422)

    @patch('server.checked_get')
    def test_full_view_registers_author_before_reading_jsp(self, fetch):
        fetch.side_effect=['',PROFILE+link('a','Makaleler'),'<table><tr><td><b>Makale</b> (2025)</td></tr></table>']
        target=BASE+'view/viewAuthor.jsp?authorId=ABC&islem=direct'
        response=app.test_client().post('/api/yok/import',json={'year':2025,'researcherId':target})
        self.assertEqual(response.status_code,200,response.json)
        self.assertIn('AkademisyenGorevOgrenimBilgileri',fetch.call_args_list[0].args[1])
        self.assertEqual(fetch.call_args_list[1].args[1],target)

    @patch('server.checked_get')
    def test_name_search_preserves_form_and_returns_candidates(self, fetch):
        home='<form method="post" action="AkademisyenArama"><input name="aramaTerim"><input type="hidden" name="token" value="opaque"><input type="checkbox" name="akademisyenCheckbox"></form>'
        category='<a href="view/searchResultviewListAuthor.jsp">Akademisyenler</a>'
        results='<table><tr><td><a href="../AkademisyenGorevOgrenimBilgileri?authorId=ABC&islem=direct">ÖRNEK KİŞİ</a></td><td>Örnek Üniversitesi / Tıp</td></tr></table>'
        fetch.side_effect=[YokPage(home,BASE),YokPage(category,BASE+'AkademisyenArama'),YokPage(results,BASE+'view/searchResultviewListAuthor.jsp')]
        response=app.test_client().post('/api/yok/search',json={'name':'Örnek Kişi'})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['candidates'][0]['name'],'ÖRNEK KİŞİ')
        payload=fetch.call_args_list[1].kwargs['data']
        self.assertEqual(payload['aramaTerim'],'Örnek Kişi')
        self.assertEqual(payload['token'],'opaque')
        self.assertEqual(payload['akademisyenCheckbox'],'on')

    def test_search_post_redirect_switches_to_get(self):
        session=Mock();session.headers={}
        session.post.return_value=Mock(status_code=302,headers={'Location':'view/results.jsp'})
        session.get.return_value=Mock(status_code=200,content=b'<p>Results</p>')
        checked_get(session,BASE+'AkademisyenArama',data={'aramaTerim':'Örnek'})
        self.assertEqual(session.post.call_count,1)
        self.assertEqual(session.get.call_count,1)

    def test_invalid_bodies(self):
        for endpoint in ('search','import'):
            self.assertEqual(app.test_client().post('/api/yok/'+endpoint,json=[]).status_code,422)
        self.assertEqual(app.test_client().post('/api/yok/search',json={'name':'a'}).status_code,422)
