"""Adapter for the public YÖK Akademik JSON services observed on 2026-11-10.

Only endpoints used by the new public website are called. No login/private routes.
"""
import hashlib
import html
import json
import re
import time
from datetime import date
from urllib.parse import urlencode, quote

import requests

ORIGIN = 'https://akademik.yok.gov.tr'
API = ORIGIN + '/api'
IMPORT_SECTIONS = {'article','conference','book','project','award'}
ALLOWED = {'/akademisyen/detay','/akademisyen/list','/yayin/ana/tur/list','/yayin/list','/yayin/detay','/proje/list','/odul/list'}

LABELS = {'article':'Makaleler','book':'Kitaplar / Kitap bölümleri','conference':'Bildiriler',
          'editor':'Editörlükler','referee':'Hakemlikler','project':'Projeler','award':'Ödüller',
          'patent':'Patentler','art':'Sanatsal faaliyetler','membership':'Üyelikler',
          'course':'Dersler','thesis':'Yönetilen Tezler','administration':'İdari Görevler',
          'education':'Öğrenim bilgileri','employment':'Akademik görevler'}
LISTS = [('project','/proje/list'),('award','/odul/list')]


def profile_url(author):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', str(author)):
        raise ValueError('Geçerli authorGuidId içeren YÖK profil bağlantısını girin.')
    return ORIGIN + '/academician-details?' + urlencode({'authorGuidId':author})


def fold(value):
    return html.unescape(str(value or '')).casefold().replace('\u0307','').translate(str.maketrans('ıöüçşğ','ioucsg'))


def api_get(session, path, params=None):
    if path not in ALLOWED:
        raise ValueError('İzin verilmeyen YÖK veri adresi.')
    response = session.get(API + path, params=params or {}, timeout=(8,25), allow_redirects=False)
    if response.status_code != 200:
        raise ValueError(f'YÖK veri servisi HTTP {response.status_code} döndürdü ({path}).')
    if len(response.content) > 8*1024*1024:
        raise ValueError('YÖK veri yanıtı boyut sınırını aştı.')
    try:
        data = response.json()
    except ValueError as exc:
        raise ValueError('YÖK JSON verisi yerine başka bir sayfa döndürdü; boş sonuç sayılmadı.') from exc
    if not isinstance(data,dict) or data.get('result') is not True or 'data' not in data:
        message = data.get('errorMessage') if isinstance(data,dict) else None
        raise ValueError('YÖK veri yanıtı doğrulanamadı: ' + str(message or path))
    return data['data']


def list_all(get, path, params, deadline, max_pages=50):
    items, seen = [], set()
    total = None
    for page in range(1,max_pages+1):
        if time.monotonic() > deadline:
            return items, page-1, total, 'Toplam aktarım süresi sınırına ulaşıldı.'
        try:
            payload = get(path,{**params,'page':page,'length':100})
        except (ValueError,requests.RequestException) as exc:
            if page==1:raise
            return items,page-1,total,'Sonraki sayfa alınamadı: '+str(exc)
        if isinstance(payload,list):
            return payload,1,len(payload),''
        if not isinstance(payload,dict) or not isinstance(payload.get('data'),list):
            raise ValueError('Liste yanıtının yapısı değişmiş; kayıt listesi bulunamadı.')
        batch = payload['data']
        try:
            total = int(payload['totalElements'])
            pages = int(payload['totalPages'])
        except (KeyError,TypeError,ValueError) as exc:
            raise ValueError('Sayfalama toplamları okunamadı; tam aktarım doğrulanamadı.') from exc
        if total < 0 or pages < 0:
            raise ValueError('Geçersiz sayfalama toplamı.')
        added=0
        for row in batch:
            if not isinstance(row,dict):
                raise ValueError('Kayıt nesnesi geçersiz.')
            ids=[(k,row[k]) for k in ('yayinId','projeId','patentId','odulId','dersId','uyelikId','sanatsalFaaliyetId','idariGorevId','personelAkademikUnvanBilgisiId') if row.get(k) not in (None,'',0,'0')]
            stable={k:v for k,v in row.items() if not k.endswith('Id') and k not in ('yayinAnaTur','yayinTuru','projeTuru')}
            key=json.dumps(ids or stable,sort_keys=True,ensure_ascii=False)
            if key in seen:
                continue
            seen.add(key);items.append(row);added+=1
        if not batch or page >= pages:
            return items,page,total,'' if len(items)==total else f'Kaynak {total} kayıt bildirdi; {len(items)} farklı kayıt alınabildi.'
        if not added:
            return items,page,total,'Kaynak aynı sayfayı tekrarladı; aktarım eksik.'
    return items,max_pages,total,'50 sayfa sınırına ulaşıldı; aktarım eksik olabilir.'


def year_value(value):
    value=str(value or '').strip()
    if re.fullmatch(r'(?:19|20)\d{2}',value):
        return int(value)
    match=re.fullmatch(r'\d{1,2}[./-]\d{1,2}[./-]((?:19|20)\d{2})',value)
    if match:
        return int(match[1])
    match=re.match(r'^((?:19|20)\d{2})-\d{2}-\d{2}(?:T|$)',value)
    return int(match[1]) if match else None


FIELD_LABELS={'yayinAdi':'Yayın / kitap adı','bolumAdi':'Kitap bölümü','yazarAdi':'Yazarlar',
 'yazarSayisi':'Toplam yazar sayısı','yayinTuruAdi':'Kaynak yayın türü / endeks',
 'yil':'Yıl','yayinYeri':'Dergi / yayınevi / toplantı','endeksAdi':'Endeks',
 'basTarih':'Başlangıç tarihi','bitTarih':'Bitiş tarihi','doi':'DOI','isbn':'ISBN','issn':'ISSN',
 'dergiQuartileListesi':'Dergi Q kayıtları','projeAdi':'Proje adı','projeTuruAd':'Proje türü',
 'projeDurumuAd':'Proje durumu','baslangicTarihi':'Başlangıç','bitisTarihi':'Bitiş',
 'projeEkip':'Proje ekibi','odulAdi':'Ödül','odulTarih':'Ödül yılı','kurulusAdi':'Kurum',
 'personelAdiSoyadi':'Ad Soyad','kadroUnvanAdi':'Kadro unvanı','universiteAd':'Üniversite',
 'fakulteAd':'Fakülte','bolumAd':'Bölüm','tezAdi':'Tez','dersAdi':'Ders','gorevAdi':'Görev'}
SKIP={'ozet','atifListesi','anahtarKelimeler','authorImage','cinsiyet'}


def readable(row):
    lines=[]
    for key,value in row.items():
        if key in SKIP or value is None or value=='' or value==[] or key.endswith('En'):
            continue
        # Encrypted/internal fields are not bibliographic evidence.
        if key not in FIELD_LABELS and (key.endswith('Id') or key in ('yayinAnaTur','yayinTuru','kapsam','ulke','projeTuru')):
            continue
        if isinstance(value,(list,dict)):
            value=json.dumps(value,ensure_ascii=False)
        lines.append(f'{FIELD_LABELS.get(key,key)}: {html.unescape(str(value))}')
    return '\n'.join(lines)


def suggested_draft(section,row,author,year):
    draft={};notes=[]
    people=str(row.get('yazarSayisi') or '').strip()
    if people.isdigit() and 1<=int(people)<=10000:
        draft['people']=people
    label=fold(row.get('yayinTuruAdi'));index=fold(row.get('endeksAdi'))
    scope=str(row.get('kapsam',''))
    if section=='article':
        if re.search(r'\b(ssci|sci|sci-e|scie|ahci)\b',label+' '+index):
            draft['activityId']='3.2' if 'derleme' in label else '3.1'
            notes.append('Araştırma/derleme ayrımı ve faaliyet kodu kullanıcı tarafından doğrulanmalıdır.')
        elif 'tr dizin' in label:
            draft['activityId']='3.5'
        if 'ahci' in label:
            draft['quartile']='AHCI'
        qrows=row.get('dergiQuartileListesi') or []
        qset={str(q.get('quartile')).upper() for q in qrows if isinstance(q,dict) and str(q.get('metrikTuru','')).upper()=='JIF' and year_value(q.get('yil'))==year}
        qset &= {'Q1','Q2','Q3','Q4'}
        if len(qset)==1 and draft.get('quartile')!='AHCI':
            draft['quartile']=next(iter(qset));notes.append('Q önerisi: yayın yılıyla eşleşen JIF kayıtları. JCI kullanılmadı.')
        elif len(qset)>1 and draft.get('quartile')!='AHCI':
            notes.append('Aynı yayın yılı için farklı JIF Q dilimleri var; doğru dilimi seçin.')
    if section=='book':
        chapter=bool(row.get('bolumAdi'))
        if scope in ('0','1'):
            draft['activityId']=('3.12' if scope=='1' else '3.14') if chapter else ('3.10' if scope=='1' else '3.13')
            notes.append('Kitap kodu kaynak kapsamına göre önerildi; yayınevi tanınırlığı ve eser türünü doğrulayın.')
        if chapter:
            draft['bookTitle']=str(row.get('isbn') or row.get('yayinAdi') or '')[:250]
    if section=='conference' and 'tam metin' in label and scope=='1':
        draft['activityId']='8.1';notes.append('Sözlü sunum, tam metin ve uluslararası toplantı koşullarını doğrulayın.')
    if section=='editor':
        if re.search(r'\b(ssci|sci|scie|sci-e|ahci)\b',label):draft['activityId']='3.6'
        elif 'tr dizin' in label:draft['activityId']='3.9'
        notes.append('YÖK editörlük kaydı baş editörlük uygunluğunu tek başına kanıtlamaz.')
    if section=='project':
        team=row.get('projeEkip') or []
        own=[p for p in team if isinstance(p,dict) and str(p.get('authorGuidId'))==author]
        if len(own)==1:
            role=fold(own[0].get('projedekiGoreviAd'))
            if role=='yurutucu':draft['role']='leader'
            elif role in ('arastirmaci','bursiyer'):draft['role']='researcher'
        text=fold(str(row.get('projeTuruAd'))+' '+str(row.get('projeAdi')))
        match=re.search(r'tubitak\s*[:/-]?\s*(1001|1003|1004|1007|1505|2244|3501|1005|3001)\b',text)
        if match:draft['activityId']='1.2' if match[1] in ('1005','3001') else '1.1'
        if 'horizon 2020' in text or re.search(r'\bh2020\b',text):draft['activityId']='1.3'
        notes.append('Takvimde geçen süre destek süresi sayılmadı; destek programı ve sonuçlanma koşullarını doğrulayın.')
    return draft,notes


def normalize(section,item,author,requested_year,detail=None):
    row={**item,**(detail or {})}
    if row.get('authorGuidId') and str(row['authorGuidId'])!=author:
        raise ValueError('Kayıt başka bir akademisyene ait; aktarılmadı.')
    title_fields={'project':['projeAdi'],'award':['odulAdi'],'patent':['patentBaslik'],
       'art':['etkinlikAdi'],'course':['dersAdi'],'thesis':['tezAdi'],'membership':['kurulusAdi'],
       'administration':['gorevAdi'],'employment':['kadroUnvanAdi'],'education':['akademikBirimAdi','programAdi']}
    if section in ('book','article','conference','editor','referee'):
        title=(row.get('bolumAdi') if section=='book' else None) or row.get('yayinAdi')
        year=year_value(row.get('yil'))
        id_key='yayinId'
    else:
        title=next((row.get(k) for k in title_fields.get(section,[]) if row.get(k)),None)
        fields={'project':['bitisyil','bitisTarihi'],'award':['odulTarih'],'patent':['tescilTarihi','patentTarih'],
          'art':['bitTarih','basTarih'],'course':['yil'],'thesis':['yil','bitisTarihi'],
          'membership':['baslangicTarihi'],'administration':['bitisTarihi','baslangicTarihi'],
          'education':['bitisTarihi'],'employment':['baslangicTarihi']}.get(section,[])
        year=next((year_value(row.get(k)) for k in fields if year_value(row.get(k)) is not None),None)
        id_key={'project':'projeId','award':'odulId','patent':'patentId','art':'sanatsalFaaliyetId',
          'course':'dersId','thesis':'yonTezId','membership':'uyelikId','administration':'idariGorevId',
          'employment':'personelAkademikUnvanBilgisiId'}.get(section,'id')
    if not title:
        raise ValueError('Kaynak kaydın başlığı okunamadı; sayfa yapısı değişmiş olabilir.')
    title=html.unescape(str(title))[:2000]
    raw_id=row.get(id_key)
    fallback=json.dumps(item,sort_keys=True,ensure_ascii=False)
    key=hashlib.sha256((author+':'+section+':'+str(raw_id or fallback)).encode()).hexdigest()[:24]
    old_title=str(item.get('yayinAdi') or title)
    legacy=hashlib.sha256((author+':'+section+':'+str(year)+':'+re.sub(r'\W','',old_title.casefold())).encode()).hexdigest()[:24]
    draft,notes=suggested_draft(section,row,author,year)
    exclusion=''
    if section=='conference' and 'ozet bildiri' in fold(row.get('yayinTuruAdi')):
        exclusion='Kaynak türü özet bildiri. Mevcut motorun tam metin bildiri faaliyetine otomatik dahil edilmez.'
    if section=='project' and fold(row.get('projeDurumuAd')) not in ('tamamlandi','completed'):
        exclusion='Proje kaynağında tamamlandığı doğrulanmıyor; sonuçlanmış proje puanına otomatik alınmaz.'
    return dict(key=key,legacyKey=legacy,legacyKeys=[hashlib.sha256((str(requested_year)+re.sub(r'\W','',old_title.casefold())).encode()).hexdigest()[:24]] if year in (None,requested_year) else [],title=title,year=year,requestedYear=requested_year,
        section=section,sectionLabel=LABELS[section],kind=LABELS[section],metadata=readable(row)[:6000],
        source=profile_url(author),sourceId=str(raw_id or ''),suggestedDraft=draft,
        dateWarning='' if year is not None else 'Faaliyet / tamamlanma / tescil yılını kaynak üzerinden doğrulayın.',
        importNotes=notes,scoreExclusion=exclusion)


def type_section(label):
    label=fold(label)
    return {'makale':'article','article':'article','bildiri':'conference','presentation':'conference',
            'kitap':'book','book':'book','editorluk':'editor','editorial':'editor','hakemlik':'referee','referee':'referee'}.get(label)


def collect_modern_profile(author,year,fetch=None):
    url=profile_url(author);deadline=time.monotonic()+240
    with requests.Session() as session:
        session.headers.update({'User-Agent':'AkademikTesvik/10.0 (user-initiated public profile import)',
                                'Accept':'application/json','Referer':url})
        get=fetch or (lambda path,params=None:api_get(session,path,params))
        info=get('/akademisyen/detay',{'authorGuidId':author})
        if not isinstance(info,dict) or str(info.get('authorGuidId'))!=author or not info.get('personelAdiSoyadi'):
            raise ValueError('Dönen profilin authorGuidId ve kimlik bilgileri doğrulanamadı.')
        name=html.unescape(str(info['personelAdiSoyadi']))
        warnings=[];records=[];reports=[]
        try:
            types=get('/yayin/ana/tur/list',{})
            if not isinstance(types,list):raise ValueError('Yayın türü listesi okunamadı.')
            publication_jobs=[]
            for t in types:
                section=type_section(t.get('label')) if isinstance(t,dict) else None
                if section in ('article','conference','book') and t.get('value'):
                    publication_jobs.append((section,'/yayin/list',{'yayinAnaTurId':t['value']}))
        except (ValueError,requests.RequestException) as exc:
            publication_jobs=[];warnings.append('Yayın türleri alınamadı: '+str(exc))
        known={job[0] for job in publication_jobs}
        for section in ('book','article','conference'):
            if section not in known:
                reports.append(dict(id=section,label=LABELS[section],status='failed',count=0,pages=0,
                     source=url,error='Kaynak yayın türü/tokeni keşfedilemedi.',rawText=''))
        jobs=publication_jobs+[(section,path,{}) for section,path in LISTS]
        for section,path,extra in jobs:
            report=dict(id=section,label=LABELS[section],status='failed',count=0,pages=0,source=url,error='',rawText='')
            try:
                rows,pages,total,error=list_all(get,path,{'authorGuidId':author,**extra},deadline)
                report['pages']=pages;report['expectedCount']=total
                section_records=[];errors=[]
                for item in rows:
                    detail=None
                    if section in ('book','article','conference') and year_value(item.get('yil'))==year:
                        if time.monotonic()>deadline:
                            errors.append('Yayın ayrıntıları için süre sınırına ulaşıldı.')
                        else:
                            try:
                                detail=get('/yayin/detay',{'yayinId':item['yayinId']})
                                if not isinstance(detail,dict) or str(detail.get('yayinId'))!=str(item['yayinId']):
                                    raise ValueError('Yayın ayrıntısı kimliği eşleşmedi.')
                            except (ValueError,requests.RequestException,KeyError) as exc:
                                detail=None;errors.append(f"{item.get('yayinId')}: ayrıntı alınamadı ({exc})")
                    try:section_records.append(normalize(section,item,author,year,detail))
                    except ValueError as exc:errors.append(str(exc))
                report['count']=len(section_records)
                report['error']=' '.join(([error] if error else [])+list(dict.fromkeys(errors)))[:2000]
                report['status']='partial' if report['error'] else ('loaded' if section_records else 'empty')
                report['rawText']='\n\n'.join(r['metadata'] for r in section_records)[:60000]
                records.extend(section_records)
            except (ValueError,requests.RequestException) as exc:
                report['error']=str(exc)
            reports.append(report)
        for report in reports:
            if report['status'] in ('partial','failed'):
                warnings.append(report['label']+': '+report['error'])
        warnings+=['Veriler yeni YÖK açık profil servislerinden alındı. Ayrıntılar seçilen faaliyet yılı için zenginleştirildi; diğer yıllar için ilgili yılı seçip tekrar getirin.',
          'Faaliyet kodu, yazar sayısı, Q dilimi ve uygunluk önerileri hesaplamaya kendiliğinden eklenmez; inceleme ve iki aşamalı onay gerekir.',
          'Toplam WoS/Scopus/Scholar atıf sayıları teşvik atıf puanı sayılmadı. Yıl, kaynak türü ve öz atıf ayrımı bu toplamlarla doğrulanamaz.']
        return dict(name=name,year=year,records=records,sections=reports,identity={'name':name,'source':url},
          origin='modern-api',counts={r['id']:r.get('expectedCount') for r in reports},partial=any(r['status'] in ('partial','failed') for r in reports),
          warnings=warnings,retrievedAt=date.today().isoformat())


def search_modern(name,fetch=None):
    name=str(name or '').strip()
    if not 3<=len(name)<=150:raise ValueError('En az 3 karakterlik ad ve soyad girin.')
    with requests.Session() as session:
        session.headers.update({'User-Agent':'AkademikTesvik/10.0','Accept':'application/json'})
        get=fetch or (lambda path,params=None:api_get(session,path,params))
        data=get('/akademisyen/list',{'personelAdiSoyadi':name,'page':1,'length':100})
        if not isinstance(data,dict) or not isinstance(data.get('data'),list):raise ValueError('YÖK arama sonuçları okunamadı.')
        candidates=[]
        for row in data['data']:
            if not isinstance(row,dict) or not row.get('authorGuidId') or not row.get('personelAdiSoyadi'):continue
            person=str(row['personelAdiSoyadi'])
            # Never turn an ignored server filter into unrelated candidate results.
            if not all(token in fold(person) for token in fold(name).split()):continue
            candidates.append(dict(name=person,url=profile_url(row['authorGuidId']),affiliation=' / '.join(str(row[k]) for k in ('kadroUnvanAdi','universiteAd','fakulteAd','bolumAd') if row.get(k))))
        return dict(candidates=candidates,warnings=['Kurum ve bölüm bilgilerini kontrol edip kendi profilinizi seçin. İlk sayfadaki en çok 100 aday gösterilir.'])


# Small process-local cache: only aggregate counts, never profile text or raw papers.
from collections import OrderedDict
from threading import Lock
_SUMMARY_CACHE = OrderedDict()
_SUMMARY_LOCK = Lock()
_SUMMARY_TTL = 300


def count_publication_indices(rows):
    indexed={'SSCI':set(),'SCI':set(),'AHCI':set(),'SCOPUS':set()}
    unique=set()
    for row in rows:
        ident=str(row.get('yayinId') or '')
        if not ident:
            if not row.get('doi') and not row.get('yayinAdi'):raise ValueError('Yayın kimliği ve başlığı okunamadı; indeks sayımı doğrulanamadı.')
            ident=json.dumps([row.get('doi'),row.get('yayinAdi'),row.get('yil'),row.get('yazarAdi')],ensure_ascii=False)
        unique.add(ident)
        # Do not infer an index from paper titles, journals, or opaque IDs.
        text=fold(' '.join(str(row.get(k) or '') for k in ('yayinTuruAdi','yayinTuruAdiEn','endeksAdi'))).replace('–','-').replace('—','-')
        if re.search(r'(?<![a-z0-9])ssci(?![a-z0-9])|social sciences citation index',text):indexed['SSCI'].add(ident)
        if re.search(r'(?<![a-z0-9])(?:sci(?:\s*-?\s*(?:e|expanded))?|scie)(?![a-z0-9])|(?<!social )science citation index',text):indexed['SCI'].add(ident)
        if re.search(r'(?<![a-z0-9])(?:ahci|a\s*&\s*hci)(?![a-z0-9])|arts\s*(?:&|and)\s*humanities citation index',text):indexed['AHCI'].add(ident)
        if re.search(r'(?<![a-z0-9])scopus(?![a-z0-9])',text):indexed['SCOPUS'].add(ident)
    covered=set().union(*indexed.values())
    return dict(counts={key:len(value) for key,value in indexed.items()},totalPublications=len(unique),otherOrUnspecified=len(unique-covered))


def publication_summary(author,fetch=None,refresh=False):
    url=profile_url(author)
    if fetch is None and not refresh:
        with _SUMMARY_LOCK:
            cached=_SUMMARY_CACHE.get(author)
            if cached and time.monotonic()-cached[0]<_SUMMARY_TTL:
                _SUMMARY_CACHE.move_to_end(author)
                return json.loads(json.dumps(cached[1]))
    with requests.Session() as session:
        session.headers.update({'User-Agent':'AkademikTesvik/11.0 (user-initiated publication summary)','Accept':'application/json','Referer':url})
        get=fetch or (lambda path,params=None:api_get(session,path,params))
        info=get('/akademisyen/detay',{'authorGuidId':author})
        if not isinstance(info,dict) or str(info.get('authorGuidId'))!=author or not info.get('personelAdiSoyadi'):
            raise ValueError('Yayın özeti için profil kimliği doğrulanamadı.')
        types=get('/yayin/ana/tur/list',{})
        if not isinstance(types,list):raise ValueError('Yayın türleri okunamadı.')
        tokens={}
        for t in types:
            section=type_section(t.get('label')) if isinstance(t,dict) else None
            if section in ('article','conference','book') and t.get('value'):
                tokens.setdefault(section,[])
                if t['value'] not in tokens[section]:tokens[section].append(t['value'])
        if set(tokens)!={'article','conference','book'}:raise ValueError('Kaynakta makale, bildiri veya kitap filtresi bulunamadı; eksik türler sıfır sayılmadı.')
        rows=[];warnings=[];total=0;deadline=time.monotonic()+50;type_counts={}
        for section,values in tokens.items():
            section_rows=[];section_failed=False
            for token in values:
                try:
                    items,pages,expected,error=list_all(get,'/yayin/list',{'authorGuidId':author,'yayinAnaTurId':token},deadline)
                    if error and not items:raise ValueError(error)
                    for item in items:
                        if item.get('authorGuidId') and str(item['authorGuidId'])!=author:raise ValueError('Özet listesinde başka bir araştırmacının kaydı döndü.')
                    section_rows.extend(items);total+=expected or 0
                    if error:warnings.append(LABELS[section]+': '+error)
                except (ValueError,requests.RequestException) as exc:
                    section_failed=True;warnings.append(LABELS[section]+': '+str(exc))
            rows.extend(section_rows);type_counts[section]=None if section_failed else count_publication_indices(section_rows)['totalPublications']
        if warnings and not rows:raise ValueError('Yayın özeti tamamlanamadı: '+' '.join(warnings))
        result=count_publication_indices(rows)
        result.update(name=html.unescape(str(info['personelAdiSoyadi'])),source=url,scope='all-years-publications',typeCounts=type_counts,
            expectedPublications=total,partial=bool(warnings),warnings=warnings,
            note='Tüm yıllardaki makale, bildiri ve kitap kayıtları sayılır; editörlükler dahil edilmez. SCI kartı SCI/SCI-E/SCIE kayıtlarını kapsar. Yalnızca kaynakta açıkça belirtilen indeksler sayıldı; aynı yayın birden fazla kartta yer alabilir. Bu sayılar teşvik puanı değildir.',
            retrievedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
        if fetch is None and not result['partial']:
            with _SUMMARY_LOCK:
                _SUMMARY_CACHE[author]=(time.monotonic(),json.loads(json.dumps(result)))
                _SUMMARY_CACHE.move_to_end(author)
                while len(_SUMMARY_CACHE)>128:_SUMMARY_CACHE.popitem(last=False)
        return result
