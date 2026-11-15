"""Same-origin YÖK import service. Run: python server.py."""
import hashlib
import html
import re
from urllib.parse import urlparse, parse_qs, urljoin, urlencode, urlunparse
from datetime import date
from pathlib import Path
import requests
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify, send_from_directory
from yok_profile import collect_profile, SECTION_SPECS
from yok_modern import collect_modern_profile, search_modern, publication_summary

ROOT = Path(__file__).parent
BASE = 'https://akademik.yok.gov.tr/AkademikArama/'
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024


def validate_yok_url(url):
    u = urlparse(url)
    if (u.scheme != 'https' or u.hostname != 'akademik.yok.gov.tr'
            or u.port not in (None, 443) or u.username or u.password
            or not (u.path.startswith('/AkademikArama/') or u.path == '/AkademikArama' or u.path == '/academician-details')):
        raise ValueError('Yalnızca HTTPS YÖK Akademik bağlantıları kabul edilir.')
    return url


def profile_target(value):
    value = html.unescape(str(value).strip()).replace('\\&', '&').replace('\\_', '_')
    if value.startswith(('https://', 'http://')):
        u = urlparse(value)
        # Legacy public profile URLs may use HTTP; requests always use HTTPS.
        u = u._replace(scheme='https', fragment='')
        target = validate_yok_url(urlunparse(u))
        if u.path == '/academician-details':
            author = parse_qs(u.query).get('authorGuidId', [''])[0]
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', author):
                raise ValueError('authorGuidId içeren tam yeni YÖK profil bağlantısını girin.')
            return author, target
        if u.path not in ('/AkademikArama/view/viewAuthor.jsp',
                          '/AkademikArama/AkademisyenGorevOgrenimBilgileri'):
            if u.path.rsplit('/', 1)[-1] not in {spec[2] for spec in SECTION_SPECS}:
                raise ValueError('YÖK profil veya akademik bilgi bölümü bağlantısını girin.')
            author = parse_qs(u.query).get('authorId', [''])[0]
            target = BASE + 'AkademisyenGorevOgrenimBilgileri?' + urlencode({'islem':'direct', 'authorId':author})
        author = parse_qs(u.query).get('authorId', [''])[0]
        # Preserve the supplied endpoint, sira and other query parameters.
    else:
        author = value
        target = BASE + 'AkademisyenGorevOgrenimBilgileri?' + urlencode({'islem': 'direct', 'authorId': author})
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', author):
        raise ValueError('authorId içeren tam YÖK profil bağlantısını girin. Oturumdaki çıplak viewAuthor.jsp adresi yeterli değildir.')
    return author, target


def identity(value):
    return profile_target(value)[0]


class YokPage(str):
    def __new__(cls, content, url):
        page = super().__new__(cls, content)
        page.url = url
        return page


def publication_kind(label):
    label = str(label).casefold().replace('\u0307', '')
    if any(x in label for x in ('bildiri', 'konferans', 'tebliğ')):
        return 'Bildiri'
    if 'kitap' in label:
        return 'Kitap'
    if 'makale' in label:
        return 'Makale'
    return 'Yayın'


def parse_records(content, year, source, kind, include_all=False):
    """Extract bibliographic rows; ambiguous dates stay in review, never in scores."""
    soup = BeautifulSoup(content, 'html.parser')
    records = {}
    for row in soup.select('table tr, .publication-item, .yayin-item'):
        cells = row.find_all('td', recursive=False)
        if not cells and row.name == 'tr':
            continue
        title_el = None
        for selector in ('.baslika strong a', '.baslika a', '.baslika strong', '.publication-title', '.baslika', 'strong a', 'strong', 'b a', 'b'):
            title_el = row.select_one(selector)
            if title_el:
                break
        if not title_el:
            continue
        title = title_el.get_text(' ', strip=True)
        if len(title) < 2:
            continue
        text = row.get_text(' ', strip=True)
        # Remove title before inspecting years: titles and DOI digits are not dates.
        meta = text.replace(title, '', 1)
        meta = re.sub(r'(?:https?://\S+|\b(?:doi|isbn|issn)\s*:?\s*\S+|\b10\.\d{4,9}/\S+)', '', meta, flags=re.I)
        labeled = re.search(r'(?:Yayın Yılı|Basım Yılı|Basim Yili|Yıl|YIL|Year)\s*[:：]?\s*((?:19|20)\d{2})', meta, re.I)
        years = [int(labeled[1])] if labeled else []
        if not years:
            years = [int(x) for x in re.findall(r'\(\s*((?:19|20)\d{2})\s*\)', meta)]
        if not years:
            # Explicit table year column or a full calendar date (conference dates).
            years = [int(c.get_text(strip=True)) for c in cells if re.fullmatch(r'(?:19|20)\d{2}', c.get_text(strip=True))]
        if not years:
            years = [int(x) for x in re.findall(r'(?<![\d./])\d{1,2}[./-]\d{1,2}[./-]((?:19|20)\d{2})(?!\d)', meta)]
        if not years:
            years = [int(x) for x in re.findall(r'(?<!\w)\d{1,2}\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+((?:19|20)\d{2})(?!\d)', meta, re.I)]
        years = set(years)
        record_year = next(iter(years)) if len(years) == 1 else None
        if not include_all and record_year is not None and record_year != year:
            continue
        normalized = re.sub(r'\W', '', title.casefold())
        key = hashlib.sha256((str(year) + normalized).encode()).hexdigest()[:24]
        records[key] = dict(key=key, title=title, year=record_year, requestedYear=year,
                            kind=publication_kind(kind), metadata=text[:6000], source=source,
                            dateWarning='' if record_year else 'Faaliyet yılı künyeden kesin belirlenemedi. Yılı kaynak üzerinden doğrulayın.')
    return list(records.values())


def publication_links(content, base, author, default='Yayın'):
    """Only follow discovered tab/page URLs; never invent opaque pubType tokens."""
    soup = BeautifulSoup(content, 'html.parser')
    found = {}
    for node in soup.select('a[href], [data-href], [onclick]'):
        candidates = [node.get('href', ''), node.get('data-href', '')]
        candidates += re.findall(r"['\"]([^'\"]*AkademisyenYayinBilgileri[^'\"]*)['\"]", node.get('onclick', ''))
        for value in candidates:
            if not value or value.startswith(('#', 'javascript:')):
                continue
            url = urljoin(base, html.unescape(value))
            if urlparse(url).path != '/AkademikArama/AkademisyenYayinBilgileri':
                continue
            if urlparse(url).scheme == 'http' and urlparse(url).hostname == 'akademik.yok.gov.tr':
                url = urlunparse(urlparse(url)._replace(scheme='https'))
            try:
                validate_yok_url(url)
            except ValueError:
                continue
            query = parse_qs(urlparse(url).query)
            if query.get('authorId', [author])[0] != author:
                continue
            if not query.get('pubType'):
                continue
            url = urlunparse(urlparse(url)._replace(fragment=''))
            label = node.get_text(' ', strip=True)
            found[url] = label if publication_kind(label) != 'Yayın' else default
    return list(found.items())


def checked_get(session, url, *, data=None):
    # Follow redirects manually so every destination is checked before fetching.
    seen = set()
    for hop in range(6):
        validate_yok_url(url)
        if url in seen:
            raise ValueError('YÖK yönlendirme döngüsü oluşturdu. Yeni profil bağlantısıyla tekrar deneyin.')
        seen.add(url)
        response = (session.post(url, data=data, timeout=(8, 25), allow_redirects=False)
                    if data is not None else session.get(url, timeout=(8, 25), allow_redirects=False))
        if response.status_code not in (301, 302, 303, 307, 308):
            break
        location = response.headers.get('Location')
        if not location:
            raise ValueError('YÖK geçersiz bir yönlendirme döndürdü.')
        if response.status_code in (301, 302, 303):
            data = None
        previous = url
        url = urljoin(url, location)
        destination = urlparse(url)
        if destination.scheme == 'http' and destination.hostname == 'akademik.yok.gov.tr':
            url = urlunparse(destination._replace(scheme='https'))
        try:
            validate_yok_url(url)
        except ValueError as exc:
            raise ValueError('YÖK profil dışına yönlendirdi. Bağlantı oturuma bağlı veya süresi dolmuş olabilir; bu yönlendirmeden yayın aktarılmadı.') from exc
        session.headers['Referer'] = previous
    else:
        raise ValueError('YÖK çok fazla yönlendirme döndürdü.')
    if response.status_code != 200:
        raise ValueError(f'YÖK erişimi başarısız (HTTP {response.status_code}). Erişim engeli veya doğrulama olabilir; boş sonuç olarak aktarılmadı.')
    if len(response.content) > 4 * 1024 * 1024:
        raise ValueError('YÖK yanıtı boyut sınırını aştı.')
    soup = BeautifulSoup(response.content, 'html.parser')
    visible = ' '.join(soup.stripped_strings).casefold()
    compact = re.sub(r'\s+', '', visible)
    if any(term in visible for term in ('request is forbidden', 'access denied', 'erişim engellendi', 'erişim reddedildi')) or compact.startswith('403'):
        raise ValueError('YÖK erişimi engellendi. Sunucu HTTP 200 döndürse bile sayfa 403/Forbidden içeriği taşıyor. Bu bir araştırmacı ID hatası değildir.')
    if soup.select_one('input[name*=captcha], iframe[src*=captcha]') or 'access denied' in soup.get_text().lower():
        raise ValueError('YÖK insan doğrulaması istiyor. Doğrulamayı kendi tarayıcınızda tamamlayın.')
    session.headers['Referer'] = url
    return YokPage(str(soup), url)


def profile_name(soup):
    """Accept known profile layouts, but never an arbitrary error-page heading."""
    for selector in ('.profile-user-info h3', '.profile-user-info h4',
                     '.profile-info h3', '.profile-info h4', 'h3.profile-username'):
        node = soup.select_one(selector)
        if node and node.get_text(' ', strip=True):
            return node.get_text(' ', strip=True)
    # YÖK also uses a standalone h4 for the name, with title in h6.
    # Researcher ID + institutional email are independent profile evidence.
    text = soup.get_text(' ', strip=True)
    has_identity = re.search(r'Araştırmacı\s*ID\s*:\s*\d+', text, re.I)
    has_contact = soup.select_one('a[href^="mailto:"]')
    if has_identity and has_contact:
        excluded = ('ÜNİVERSİTE', 'FAKÜLTE', 'BÖLÜM', 'ANABİLİM', 'BİLGİ', 'GÖREV',
                    'MAKALE', 'YAYIN', 'PROJE', 'ÖĞRENİM', 'UNVAN', 'DOKTOR')
        for node in soup.select('h3, h4'):
            name = node.get_text(' ', strip=True)
            upper = name.upper()
            if 2 <= len(name.split()) <= 8 and len(name) <= 150 and not any(x in upper for x in excluded) and not re.search(r'[\d/@:]', name):
                return name
    # Older pages have a titled heading. Require a real publication tab too.
    if soup.select_one('a[href*="AkademisyenYayinBilgileri"]'):
        for node in soup.select('h3, h4'):
            text = node.get_text(' ', strip=True)
            if re.search(r'\b(PROF|DOÇ|DR|ARAŞ|ÖĞR)\b', text, re.I) and len(text) <= 250:
                return text
    return None


@app.post('/api/yok/publication-summary')
def yok_publication_summary():
    try:
        data=request.get_json(force=True)
        if not isinstance(data,dict):raise ValueError('Geçerli bir JSON nesnesi gönderin.')
        author,_=profile_target(data.get('researcherId',''))
        return jsonify(publication_summary(author,refresh=data.get('refresh') is True))
    except (ValueError,TypeError) as exc:
        return jsonify(error=str(exc)),422
    except requests.RequestException:
        return jsonify(error='Yayın özetine bağlanılamadı. Tekrar deneyin.'),502


@app.post('/api/yok/search')
def search_yok():
    try:
        data = request.get_json(force=True)
        if not isinstance(data, dict):
            raise ValueError('Geçerli bir JSON nesnesi gönderin.')
        name = str(data.get('name', '')).strip()
        if data.get('source') == 'modern':
            return jsonify(search_modern(name))
        if not 3 <= len(name) <= 150:
            raise ValueError('En az 3 karakterlik ad ve soyad girin.')
        with requests.Session() as session:
            session.headers['User-Agent'] = 'AkademikTesvik/5.0 (user-initiated search)'
            home = checked_get(session, BASE)
            soup = BeautifulSoup(home, 'html.parser')
            field = soup.select_one('input[name="aramaTerim"]')
            form = field.find_parent('form') if field else None
            if not form:
                raise ValueError('YÖK ad arama formu bulunamadı. Tam profil bağlantısıyla aktarımı deneyin.')
            payload = {}
            for node in form.select('input[name]'):
                if node.get('type') in ('submit', 'button', 'radio', 'checkbox'):
                    if not node.has_attr('checked') and not (node.get('type') == 'checkbox' and re.search(r'(akademisyen|author)', node['name'], re.I)):
                        continue
                payload[node['name']] = node.get('value', 'on' if node.get('type') == 'checkbox' else '')
            payload['aramaTerim'] = name
            payload.setdefault('islem', '1')
            target = urljoin(getattr(home, 'url', BASE), form.get('action') or 'AkademisyenArama')
            validate_yok_url(target)
            method = form.get('method', 'get').lower()
            page = checked_get(session, target, data=payload) if method == 'post' else checked_get(session, target + ('&' if '?' in target else '?') + urlencode(payload))
            soup = BeautifulSoup(page, 'html.parser')
            category = soup.select_one('a[href*="searchResultviewListAuthor"], a[href*="searchResultListAuthor"]')
            if not category:
                category = next((a for a in soup.select('a[href]') if re.match(r'^Akademisyenler(?:\s|\(|$)', a.get_text(' ', strip=True), re.I)), None)
            if category:
                page = checked_get(session, urljoin(getattr(page, 'url', target), category['href']))
                soup = BeautifulSoup(page, 'html.parser')
            candidates = {}
            for link in soup.select('a[href*="authorId="]'):
                url = urljoin(getattr(page, 'url', target), link['href'])
                try:
                    author, url = profile_target(url)
                except ValueError:
                    continue
                title = link.get_text(' ', strip=True)
                if not title:
                    continue
                row = link.find_parent('tr') or link.find_parent('li') or link.parent
                candidates[author] = dict(name=title, affiliation=row.get_text(' ', strip=True)[:1500], url=url)
            if not candidates and not re.search(r'(sonuç bulunamadı|kayıt bulunamadı|sonuç bulunamamıştır|0 sonuç)', soup.get_text(' ', strip=True), re.I):
                raise ValueError('YÖK arama sonuçları okunamadı veya sayfa yapısı değişti. Tam profil bağlantısını kullanın.')
            return jsonify(candidates=list(candidates.values())[:100], warnings=['Aynı isimdeki kişileri kurum ve bölüm bilgisiyle kontrol edip profilinizi seçin. İlk sayfadaki en çok 100 sonuç gösterilir.'])
    except (ValueError, TypeError) as exc:
        return jsonify(error=str(exc)), 422
    except requests.RequestException:
        return jsonify(error='YÖK aramasına bağlanılamadı. Tam profil bağlantısını deneyin.'), 502


@app.post('/api/yok/import')
def import_yok():
    try:
        data = request.get_json(force=True)
        if not isinstance(data, dict):
            raise ValueError('Geçerli bir JSON nesnesi gönderin.')
        year = int(data.get('year', 0))
        if not 2000 <= year <= date.today().year:
            raise ValueError('Faaliyet yılı 2000 ile bu yıl arasında olmalıdır.')
        author, profile_url = profile_target(data.get('researcherId', ''))
        if data.get('source') == 'modern' or urlparse(profile_url).path == '/academician-details':
            return jsonify(collect_modern_profile(author, year))
        with requests.Session() as session:
            session.headers['User-Agent'] = 'AkademikTesvik/7.0 (user-initiated academic profile import)'
            # JSP views alone do not register the selected author in a new session.
            if urlparse(profile_url).path.endswith('/viewAuthor.jsp'):
                checked_get(session, BASE + 'AkademisyenGorevOgrenimBilgileri?' + urlencode({'islem':'direct', 'authorId':author}))
            profile = checked_get(session, profile_url)
            profile_url = getattr(profile, 'url', profile_url)
            soup = BeautifulSoup(profile, 'html.parser')
            name = profile_name(soup)
            if not name:
                if author.isdecimal():
                    raise ValueError('Sayısal YÖKSİS araştırmacı ID’sinden profil çözümlenemedi. Bu sürüm sayısal ID → authorId dönüşümünü desteklemiyor. YÖK profilinizin authorId içeren tam bağlantısını girin.')
                raise ValueError('YÖK yanıtında araştırmacı profili bulunamadı. Profil bağlantısını tarayıcıda açıp kontrol edin; oturum veya sayfa yapısı değişikliği olabilir.')
            if author.isdecimal():
                reported_id = re.search(r'Araştırmacı\s*ID\s*:\s*(\d+)', soup.get_text(' ', strip=True), re.I)
                if not reported_id or int(reported_id[1]) != int(author):
                    raise ValueError('Dönen profilin araştırmacı ID’si girilen numarayla doğrulanamadı. Yanlış kişinin yayınları aktarılmadı; tam YÖK profil bağlantısı gereklidir.')
            if data.get('scope') == 'profile':
                return jsonify(collect_profile(session, profile, profile_url, author, name, year, checked_get, parse_records))
            records = []
            links = publication_links(profile, profile_url, author)
            if not links:
                raise ValueError('YÖK yayın sekmeleri bulunamadı; sayfa yapısı değişmiş olabilir. Eksik veriyle hesaplama yapılmadı.')
            visited = set()
            discovered_kinds = {publication_kind(label) for _, label in links}
            warnings = []
            failures = 0
            while links and len(visited) < 60:
                url, label = links.pop(0)
                if url in visited:
                    continue
                visited.add(url)
                try:
                    page = checked_get(session, url)
                    final_url = getattr(page, 'url', url)
                    records.extend(parse_records(page, year, final_url, label))
                    discovered = publication_links(page, final_url, author, label)
                    discovered_kinds.update(publication_kind(k) for _, k in discovered)
                    links.extend((u, k) for u, k in discovered
                                 if u not in visited and u not in [item[0] for item in links])
                except (ValueError, requests.RequestException) as exc:
                    failures += 1
                    warnings.append(f'{label} sekmesi/sayfası alınamadı: {str(exc) if isinstance(exc, ValueError) else "bağlantı hatası"}')
            if failures == len(visited):
                raise ValueError('Yayın sayfaları alınamadı. ' + ' '.join(warnings))
            if links:
                warnings.append('60 sayfa sınırına ulaşıldı; aktarım eksik olabilir.')
            missing = {'Makale', 'Kitap', 'Bildiri'} - discovered_kinds
            if missing:
                warnings.append('Şu türlerin ayrı sekmeleri keşfedilemedi; bu türlerdeki aktarım eksik olabilir: ' + ', '.join(sorted(missing)))
            unique = {r['key']: r for r in records}
            if not unique:
                warnings.append('Seçilen yıl için ayrıştırılabilir kayıt bulunamadı. Bu sonuç o yıl faaliyet olmadığı anlamına gelmez.')
            warnings += ['Kayıtlar yalnızca inceleme listesine alınır; ön onay ve ayrı hesaplama onayı olmadan puana dahil edilmez.',
                         'Yılı belirsiz kayıtların yılını, faaliyet kodunu, yazar sayısını, Q dilimini ve teşvik uygunluğunu kaynaktan doğrulayın.']
            return jsonify(name=name, year=year, records=list(unique.values()),
                           partial=bool(failures or links or missing), warnings=warnings)

    except (ValueError, TypeError) as exc:
        return jsonify(error=str(exc)), 422
    except requests.RequestException:
        return jsonify(error='YÖK bağlantısı kurulamadı veya zaman aşımına uğradı. Daha sonra yeniden deneyin.'), 502


@app.post('/api/yok/import-html')
def import_saved_yok():
    """Parse user-saved public pages locally when the source blocks server requests."""
    try:
        data = request.get_json(force=True)
        if not isinstance(data, dict):
            raise ValueError('Geçerli bir JSON nesnesi gönderin.')
        year = int(data.get('year', 0))
        if not 2000 <= year <= date.today().year:
            raise ValueError('Geçerli bir faaliyet yılı seçin.')
        author, profile_url = profile_target(data.get('researcherId', ''))
        pages = data.get('pages')
        if not isinstance(pages, list) or not 1 <= len(pages) <= 40:
            raise ValueError('1–40 kaydedilmiş HTML sayfası seçin.')
        saved, profile = {}, ''
        for page in pages:
            if not isinstance(page, dict) or not isinstance(page.get('content'), str):
                raise ValueError('HTML sayfası geçersiz.')
            section, content = page.get('section'), page['content']
            if section not in {s[0] for s in SECTION_SPECS}:
                raise ValueError('Her dosya için bir profil bölümü seçin.')
            saved.setdefault(section, []).append(content)
        if not saved:
            raise ValueError('En az bir akademik bilgi bölümü yükleyin.')
        name = str(data.get('name', '')).strip()
        if not 3 <= len(name) <= 250:
            raise ValueError('Akademisyenin adını ve soyadını girin.')
        from yok_profile import section_for, seed_sections
        saved_targets = dict(seed_sections(profile, profile_url, author))
        def read_saved(session, url):
            section = saved_targets.get(url) or section_for(url)
            if section not in saved:
                raise ValueError('Bu bölüm için HTML sayfası yüklenmedi.')
            content = '\n'.join(saved[section])
            text = BeautifulSoup(content, 'html.parser').get_text(' ', strip=True).casefold()
            if any(term in text for term in ('request is forbidden', 'access denied', 'erişim engellendi')):
                raise ValueError('Kaydedilen dosya erişim engeli sayfası; akademik veri içermiyor.')
            return YokPage(content, url)
        # Seeds must use known tab URLs; no external requests occur in this route.
        result = collect_profile(None, profile or '<p>Yüklenen sayfalardan aktarım</p>', profile_url,
                                 author, name, year, read_saved, parse_records, follow_links=False)
        result['origin'] = 'saved-html'
        result['warnings'].insert(0, 'Veriler seçtiğiniz kaydedilmiş HTML dosyalarından okundu; canlı YÖK kontrolü yapılmadı. Tüm dosyaların aynı akademisyene ait olduğunu inceleyin.')
        return jsonify(result)
    except (ValueError, TypeError) as exc:
        return jsonify(error=str(exc)), 422


@app.get('/')
def index():
    return send_from_directory(ROOT, 'index.html')


@app.get('/<name>')
def asset(name):
    if name not in {'app.js', 'engine.js', 'styles.css'}:
        return '', 404
    return send_from_directory(ROOT, name)


if __name__ == '__main__':
    from waitress import serve
    serve(app, host='127.0.0.1', port=8000, threads=4)
