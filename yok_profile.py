"""Public profile section collection. No browser execution and no invented records."""
import hashlib
import html
import re
from time import monotonic
from urllib.parse import urljoin, urlparse, parse_qs, parse_qsl, urlencode, urlunparse
from bs4 import BeautifulSoup
import requests

BASE = 'https://akademik.yok.gov.tr/AkademikArama/'
# Publication tokens below come from the user's supplied real section links.
# Discovered per-profile links take precedence over these fallbacks.
SECTION_SPECS = [
    ('book', 'Kitaplar', 'AkademisyenYayinBilgileri', 'q3SMeouSUM6tBWypaNs06Q', ['publication']),
    ('article', 'Makaleler', 'AkademisyenYayinBilgileri', '5Eaxq5GEK5ukOf71Zpm7dA', ['publication']),
    ('conference', 'Bildiriler', 'AkademisyenYayinBilgileri', 'iHDPgsbZ-szm5UHCxj3mmg', ['conference']),
    ('project', 'Projeler', 'AkademisyenProjeBilgileri', None, ['project']),
    ('award', 'Ödüller', 'AkademisyenOdulBilgileri', None, ['award']),
]
SPECS = {s[0]: s for s in SECTION_SPECS}


def fold(value):
    return str(value).casefold().replace('\u0307', '').translate(str.maketrans('ıöüçşğ', 'ioucsg'))


def section_for(url, label='', current=None):
    path = urlparse(url).path.rsplit('/', 1)[-1]
    if path == 'AkademisyenYayinBilgileri':
        label = fold(label)
        for key, term in [('book', 'kitap'), ('article', 'makale'), ('conference', 'bildiri')]:
            if term in label:
                return key
        token = parse_qs(urlparse(url).query).get('pubType', [''])[0]
        for spec in SECTION_SPECS[:3]:
            if spec[3] == token:
                return spec[0]
        return current if current in ('book', 'article', 'conference') else None
    return next((s[0] for s in SECTION_SPECS if s[2] == path), None)


def section_links(content, base, author, current=None):
    soup = BeautifulSoup(content, 'html.parser')
    result = {}
    for node in soup.select('a[href], [data-href], [onclick]'):
        values = [node.get('href', ''), node.get('data-href', '')]
        values += re.findall(r"['\"]([^'\"]*(?:Akademisyen|\?)[^'\"]*)['\"]", node.get('onclick', ''))
        for value in values:
            if not value or value.startswith(('#', 'javascript:')):
                continue
            url = urljoin(base, html.unescape(value))
            parsed = urlparse(url)
            if (parsed.hostname != 'akademik.yok.gov.tr' or parsed.scheme not in ('http', 'https')
                    or parsed.username or parsed.password or parsed.port not in (None, 80, 443)
                    or parsed.path.rsplit('/', 1)[0] != '/AkademikArama'):
                continue
            query = parse_qs(parsed.query)
            if query.get('authorId', [author])[0] != author:
                continue
            key = section_for(url, node.get_text(' ', strip=True), current)
            if not key:
                continue
            # Query-only pagers may rely on the current tab token; reuse observed values.
            if SPECS[key][3] and not query.get('pubType'):
                base_query = parse_qs(urlparse(base).query)
                if section_for(base, current=current) != key or not base_query.get('pubType'):
                    continue
                query['pubType'] = base_query['pubType']
            query.setdefault('authorId', [author])
            url = urlunparse(parsed._replace(scheme='https', netloc='akademik.yok.gov.tr', fragment='', query=urlencode(query, doseq=True)))
            result[url] = key
    return [(url, key) for url, key in result.items()]


def seed_sections(profile, profile_url, author):
    discovered = section_links(profile, profile_url, author)
    targets = []
    for key, label, endpoint, token, categories in SECTION_SPECS:
        matches = [(url, k) for url, k in discovered if k == key]
        if matches:
            targets.extend(matches)
        else:
            query = {'authorId': author}
            if token:
                query['pubType'] = token
            targets.append((BASE + endpoint + '?' + urlencode(query), key))
    return targets


def visible_text(content):
    soup = BeautifulSoup(content, 'html.parser')
    for node in soup.select('script, style, nav, header, footer, noscript'):
        node.decompose()
    body = soup.select_one('#authorContent, .tab-content, .content-wrapper, main') or soup.body or soup
    return body.get_text('\n', strip=True)[:60000]


def explicit_year(text, cells):
    # Completion/registration dates matter for projects and patents; don't use start year.
    end = re.search(r'(?:Bitiş|Tamamlanma|Tescil|Veriliş)\s*(?:Tarihi|Yılı)?\s*[:：]?\s*(?:\d{1,2}[./-]\d{1,2}[./-])?((?:19|20)\d{2})', text, re.I)
    if end:
        return int(end[1])
    labeled = re.search(r'(?:Yayın Yılı|Basım Yılı|Yıl|Year)\s*[:：]?\s*((?:19|20)\d{2})', text, re.I)
    if labeled:
        return int(labeled[1])
    years = {int(c.get_text(strip=True)) for c in cells if re.fullmatch(r'(?:19|20)\d{2}', c.get_text(strip=True))}
    if not years:
        text = re.sub(r'https?://\S+|\b(?:DOI|ISBN|ISSN)\s*:?\s*\S+', '', text, flags=re.I)
        years = {int(match) for matches in re.findall(r'\(\s*((?:19|20)\d{2})\s*\)|(?<![\w./])(?:\d{1,2}[./-]\d{1,2}[./-])((?:19|20)\d{2})(?!\d)', text) for match in matches if match}
    return next(iter(years)) if len(years) == 1 else None


def extract_hints(text, section):
    """Only explicit metadata labels; no Q1/single-author/project-role defaults."""
    draft = {}
    m = re.search(r'(?:Yazar|Buluşçu|Kişi)\s*Sayısı\s*[:：]\s*(\d{1,5})', text, re.I)
    if m:
        draft['people'] = m[1]
    m = re.search(r'(?:Quartile|Çeyreklik|Q\s*Dilimi)\s*[:：]\s*(Q[1-4]|AHCI)\b', text, re.I)
    if m:
        draft['quartile'] = m[1].upper()
    m = re.search(r'(?:Destek Süresi|Proje Süresi|Süre)\s*[:：]\s*(\d+)\s*ay\b', text, re.I)
    if m:
        draft['projectMonths'] = m[1]
    m = re.search(r'(?:Görev|Rol)\s*[:：]\s*(Yürütücü|Araştırmacı|Bursiyer)', text, re.I)
    if m:
        draft['role'] = 'leader' if fold(m[1]) == 'yurutucu' else 'researcher'
    normalized = fold(text)
    if section == 'project':
        program = re.search(r'tubitak\s*[:/-]?\s*(1001|1003|1004|1007|1505|2244|3501|1005|3001)\b', normalized)
        if program:
            draft['activityId'] = '1.2' if program[1] in ('1005', '3001') else '1.1'
        elif re.search(r'horizon\s*2020|\bH2020\b', text, re.I):
            draft['activityId'] = '1.3'
    if section == 'award':
        for phrase, code in [('yok yilin doktora tezi', '9.1'), ('tubitak bilim odulu', '9.2'), ('tuba akademi odulu', '9.3')]:
            if phrase in normalized:
                draft['activityId'] = code
    return draft


def parse_section(content, section, year, source, parse_publications):
    if section not in SPECS:
        raise ValueError('Bu bölüm aktarım kapsamı dışında.')
    spec = SPECS[section]
    label, categories = spec[1], spec[4]
    if section in ('book', 'article', 'conference'):
        rows = parse_publications(content, year, source, label, include_all=True)
    else:
        soup = BeautifulSoup(content, 'html.parser')
        rows = []
        for row in soup.select('table tr, .publication-item, .yayin-item, .timeline-item'):
            cells = row.find_all('td', recursive=False)
            if row.name == 'tr' and not cells:
                continue
            text = row.get_text(' ', strip=True)
            if len(text) < 3:
                continue
            title = None
            for selector in ('.baslika a', '.baslika strong', '.baslika', '.publication-title', 'strong a', 'strong', 'b', 'h3', 'h4'):
                node = row.select_one(selector)
                if node:
                    title = node.get_text(' ', strip=True)
                    break
            if not title:
                # Plain table layouts (courses, appointments, memberships) have no strong tag.
                candidates = [c.get_text(' ', strip=True) for c in cells if not re.fullmatch(r'[\d\s./-]*', c.get_text(' ', strip=True))]
                title = max(candidates, key=len) if candidates else None
            if not title:
                continue
            table = row.find_parent('table')
            headers = table.select('thead th') if table else []
            if not headers and table:
                first = table.find('tr')
                headers = first.find_all('th', recursive=False) if first else []
            labeled_cells = []
            if len(headers) == len(cells):
                labeled_cells = [head.get_text(' ', strip=True) + ': ' + cell.get_text(' ', strip=True)
                                 for head, cell in zip(headers, cells)]
            # Preserve field labels as well as values for review and metadata extraction.
            metadata = (' | '.join(labeled_cells) if labeled_cells else text)
            year_text = metadata.replace(title, '', 1)
            rows.append(dict(title=title[:2000], metadata=metadata[:6000], year=explicit_year(year_text, cells)))
    result = {}
    for row in rows:
        row.update(section=section, sectionLabel=label, kind=label, scoreCategories=categories,
                   requestedYear=year, source=source, suggestedDraft=extract_hints(row['metadata'], section))
        row['legacyKey'] = hashlib.sha256((str(year) + re.sub(r'\W', '', row['title'].casefold())).encode()).hexdigest()[:24] if row['year'] in (None, year) else ''
        author = parse_qs(urlparse(source).query).get('authorId', [''])[0]
        row['key'] = hashlib.sha256((author + ':' + section + ':' + str(row['year']) + ':' + re.sub(r'\W', '', row['title'].casefold())).encode()).hexdigest()[:24]
        row['dateWarning'] = '' if row['year'] is not None else 'Yıl kesin belirlenemedi. Puanlama için faaliyet/tamamlanma/tescil yılını kaynaktan doğrulayın.'
        result[row['key']] = row
    return list(result.values())


def collect_profile(session, profile, profile_url, author, name, year, fetch, parse_publications, follow_links=True):
    queue = seed_sections(profile, profile_url, author)
    sections = {s[0]: dict(id=s[0], label=s[1], status='pending', count=0, pages=0, error='', rawText='', source='') for s in SECTION_SPECS}
    records, visited, warnings = {}, set(), []
    started = monotonic()
    while queue and len(visited) < 80 and monotonic() - started < 240:
        url, section = queue.pop(0)
        fingerprint = (urlparse(url).path, tuple(sorted(parse_qsl(urlparse(url).query))))
        if fingerprint in visited:
            continue
        visited.add(fingerprint)
        report = sections[section]
        report['source'] = report['source'] or url
        try:
            page = fetch(session, url)
            final = getattr(page, 'url', url)
            # Reject an explicit different author after an allowed redirect.
            if parse_qs(urlparse(final).query).get('authorId', [author])[0] != author:
                raise ValueError('Dönen sayfa başka bir araştırmacıya ait.')
            rows = parse_section(page, section, year, url, parse_publications)
            for row in rows:
                records[row['key']] = row
            report['pages'] += 1
            report['rawText'] = (report['rawText'] + '\n' + visible_text(page)).strip()[:60000]
            discovered = section_links(page, final, author, section) if follow_links else []
            for target, key in discovered:
                if (urlparse(target).path, tuple(sorted(parse_qsl(urlparse(target).query)))) not in visited and (target, key) not in queue:
                    queue.append((target, key))
        except (ValueError, requests.RequestException) as exc:
            message = str(exc) if isinstance(exc, ValueError) else 'Bağlantı hatası veya zaman aşımı.'
            report['error'] = (report['error'] + ' ' + message).strip()[:2000]
    if queue:
        warnings.append('Sayfa veya toplam süre sınırına ulaşıldı. Bazı bölümler eksik olabilir.')
    for key, report in sections.items():
        report['count'] = sum(r['section'] == key for r in records.values())
        if report['pages']:
            if report['error'] or any(k == key for _, k in queue):
                report['status'] = 'partial'
            elif report['count']:
                report['status'] = 'loaded'
            elif re.search(r'(kayıt bulunamadı|kayıt bulunmamaktadır|sonuç bulunamadı|yayını bulunmamaktadır|bilgisi bulunmamaktadır|henüz.*eklenmemiş)', report['rawText'], re.I):
                report['status'] = 'empty'
            else:
                report['status'] = 'unparsed'
                report['error'] = 'Sayfa alındı ancak yapılandırılmış kayıt çıkarılamadı. Kaynak metni kontrol edin; boş olduğu varsayılmadı.'
        else:
            report['status'] = 'failed' if report['error'] else 'not_attempted'
        if report['status'] in ('partial', 'failed', 'unparsed', 'not_attempted'):
            warnings.append(report['label'] + ': ' + (report['error'] or 'Alınamadı; sayfa/süre sınırı.'))
    warnings += ['Tüm yılların kayıtları pop-up içinde gösterilir. Hesaplamaya yalnızca seçilen faaliyet yılına ait ve uygunluğu doğrulanmış kayıtlar alınır.',
                 'Aktarım kapsamı makale, bildiri, kitap, proje ve ödül ile sınırlıdır. Faaliyet kodu ve gerekli ayrıntılar doğrulanmalıdır.']
    return dict(name=name, year=year, records=list(records.values()), sections=list(sections.values()),
                identity=dict(name=name, source=profile_url),
                partial=any(s['status'] not in ('loaded', 'empty') for s in sections.values()), warnings=warnings)
