/* Akademik Teşvik 2026 — bağımsız hesaplama motoru.
 * Kaynak: Akademik Teşvik Ödeneği Yönetmeliği (2018/11834), Tablo 1-4.
 * Para katsayısı: T.C. Hazine ve Maliye Bakanlığı, Temmuz 2026 Sıra No 5.
 * Telif hakları: Bu uygulama AtasoyWeb'in kaynak kodunu kullanmaz.
 */
(function(root, factory) {
  const engine = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  if (root) root.IncentiveEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const PERIODS = Object.freeze({
    '2026-2': { label: 'Temmuz – Aralık 2026', coefficient: 1.575512 },
    '2026-1': { label: 'Ocak – Haziran 2026', coefficient: 1.387871 }
  });
  const TITLES = Object.freeze({
    professor: { label: 'Profesör', multiplier: 1 },
    associate: { label: 'Doçent', multiplier: 0.9 },
    assistant: { label: 'Doktor Öğretim Üyesi', multiplier: 0.8 },
    lecturer: { label: 'Öğretim Görevlisi', multiplier: 0.7 },
    researcher: { label: 'Araştırma Görevlisi', multiplier: 0.7 }
  });
  const FIELDS = Object.freeze({
    A1: 'Eğitim, fen, matematik, mühendislik, sağlık, ziraat, orman ve su ürünleri',
    A2: 'Filoloji, hukuk, ilahiyat, sosyal, beşeri ve idari bilimler, spor bilimleri',
    A3: 'Mimarlık, planlama ve tasarım',
    A4: 'Güzel sanatlar'
  });
  const CATEGORIES = [
    { id: 'project', number: 1, name: 'Proje', cap: 20, icon: 'folder-kanban', hint: 'Sonuçlandırılmış ve uygun Ar-Ge projeleri' },
    { id: 'research', number: 2, name: 'Araştırma', cap: 15, icon: 'flask-conical', hint: 'Kurum dışında, en az dört ay süren araştırmalar' },
    { id: 'publication', number: 3, name: 'Yayın', cap: 30, icon: 'book-open', hint: 'Makaleler, editörlükler, kitaplar ve kayıtlar' },
    { id: 'design', number: 4, name: 'Tasarım', cap: 15, icon: 'pen-tool', hint: 'Özgün tasarım faaliyetleri' },
    { id: 'exhibition', number: 5, name: 'Sergi', cap: 15, icon: 'palette', hint: 'Güzel sanatlar alanındaki sergi ve etkinlikler' },
    { id: 'patent', number: 6, name: 'Patent', cap: 30, icon: 'lightbulb', hint: 'Tescil edilmiş uygun patentler' },
    { id: 'citation', number: 7, name: 'Atıf', cap: 30, icon: 'quote', hint: 'Öz atıflar hariç, uygun yayınlardan atıflar' },
    { id: 'conference', number: 8, name: 'Tebliğ', cap: 20, icon: 'mic', hint: 'Sözlü sunulmuş ve tam metni basılmış uluslararası bildiriler' },
    { id: 'award', number: 9, name: 'Ödül', cap: 20, icon: 'award', hint: 'Yönetmelik kapsamında bulunan bilim ve sanat ödülleri' }
  ];
  function activity(id, category, label, rates, mode='count', details='') {
    return { id, category, label, rates, mode, details };
  }
  const SAME = n => [n,n,n,n];
  const NONE = null;
  const ACTIVITIES = [
    activity('1.1','project','TÜBİTAK 1001, 1003, 1004, 1007, 1505, 2244, 3501; SAYEM, COST ve uluslararası ikili işbirliği',SAME(80),'project','Proje yürütücüsü veya araştırmacı/bursiyer olarak sonuçlandırılmış proje.'),
    activity('1.2','project','TÜBİTAK 1005 ve 3001 projeleri',SAME(70),'project'),
    activity('1.3','project','Horizon 2020 (H2020) projesi',SAME(100),'project'),
    activity('1.4','project','Diğer uluslararası kurumların desteklediği Ar-Ge projesi (en az 9 ay)',SAME(40),'long-project'),
    activity('1.5','project','Diğer ulusal kurumların desteklediği Ar-Ge projesi (en az 9 ay)',SAME(20),'long-project'),
    activity('2.1','research','Yurt dışında yürütülen araştırma',SAME(15),'research','Kurum dışında görevlendirme, başarılı sonuç raporu ve en az dört ay süre gerekir.'),
    activity('2.2','research','Yurt içinde yürütülen araştırma',SAME(10),'research','Kurum dışında görevlendirme, başarılı sonuç raporu ve en az dört ay süre gerekir.'),
    activity('3.1','publication','SCI, SCI-E, SSCI veya AHCI araştırma makalesi',[60,80,60,80],'quartile','Çeyreklik katsayısı: Q1=1, Q2=0,8, Q3=0,5, Q4=0,25; AHCI=0,5.'),
    activity('3.2','publication','SCI, SCI-E, SSCI veya AHCI derleme / kısa makale',[30,40,30,40],'quartile','Editöre mektup, yorum, vaka sunumu, teknik not, araştırma notu ve kitap eleştirisi bu başlıktadır.'),
    activity('3.3','publication','ÜAK tarafından tanımlanan alan endeksli araştırma makalesi',[20,25,20,25],'authors'),
    activity('3.4','publication','Diğer uluslararası hakemli dergide araştırma makalesi',[15,20,15,20],'authors'),
    activity('3.5','publication','ULAKBİM TR Dizin ulusal hakemli dergide araştırma makalesi',[15,20,15,20],'authors'),
    activity('3.6','publication','SCI, SCI-E, SSCI veya AHCI dergisinde baş editörlük',SAME(25),'editor','Farklı dergilerde olsa bile yalnızca bir editörlük değerlendirilebilir.'),
    activity('3.7','publication','ÜAK alan endeksli dergide baş editörlük',SAME(15),'editor'),
    activity('3.8','publication','Diğer uluslararası hakemli dergide baş editörlük',SAME(10),'editor'),
    activity('3.9','publication','ULAKBİM TR Dizin dergisinde baş editörlük',SAME(10),'editor'),
    activity('3.10','publication','Tanınmış uluslararası yayınevi: özgün bilimsel kitap',SAME(100),'authors'),
    activity('3.11','publication','Tanınmış uluslararası yayınevi: kitap editörlüğü',SAME(60),'authors'),
    activity('3.12','publication','Tanınmış uluslararası yayınevi: kitap bölümü',SAME(25),'chapter','Aynı kitapta en çok iki bölüm puanlanır.'),
    activity('3.13','publication','Özgün bilimsel kitap (ulusal yayınevi ibaresine ilişkin yargı kararı saklıdır)',SAME(50),'authors','Bu faaliyetle ilgili Danıştay kararlarını kurumunuza teyit ettirin.'),
    activity('3.14','publication','Özgün bilimsel kitap bölümü (ulusal yayınevi ibaresine ilişkin yargı kararı saklıdır)',SAME(15),'chapter','Aynı kitapta en çok iki bölüm puanlanır. Yargı kararlarını kurumunuza teyit ettirin.'),
    activity('3.15','publication','Uluslararası kişisel ses / görüntü kaydı',[NONE,NONE,NONE,20],'count'),
    activity('3.16','publication','Uluslararası karma ses / görüntü kaydı',[NONE,NONE,NONE,10],'count','Karma kayıtlar kişi sayısından bağımsız olarak tam puanlanır.'),
    activity('3.17','publication','Ulusal kişisel ses / görüntü kaydı',[NONE,NONE,NONE,10],'count'),
    activity('4.1','design','Endüstriyel, çevresel, grafik, sahne, moda veya çalgı tasarımı',SAME(15),'shared'),
    activity('5.1','exhibition','Yurt dışında özgün bireysel sergi / etkinlik',[NONE,NONE,NONE,30],'count'),
    activity('5.2','exhibition','Yurt içinde özgün bireysel sergi / etkinlik',[NONE,NONE,NONE,15],'count'),
    activity('5.3','exhibition','Yurt dışında özgün karma / grup sergisi',[NONE,NONE,NONE,15],'count'),
    activity('5.4','exhibition','Yurt içinde özgün karma / grup sergisi',[NONE,NONE,NONE,8],'count'),
    activity('6.1','patent','Uluslararası patent',SAME(100),'authors'),
    activity('6.2','patent','Ulusal patent (incelemeli)',SAME(60),'authors'),
    activity('7.1','citation','SCI, SCI-E, SSCI veya AHCI kapsamındaki makalelerden atıf',[4,6,4,6],'count'),
    activity('7.2','citation','ÜAK alan endeksli dergilerden atıf',[1.5,3,1.5,3],'count'),
    activity('7.3','citation','Diğer uluslararası hakemli dergilerden atıf',[1,2,1,2],'count'),
    activity('7.4','citation','ULAKBİM TR Dizin ulusal hakemli dergilerden atıf',[1,2,1,2],'count'),
    activity('7.5','citation','Tanınmış uluslararası yayınevinin özgün bilimsel kitabından atıf',[4,8,4,8],'count'),
    activity('7.6','citation','Özgün bilimsel kitaptan atıf (ulusal yayınevi ibaresine ilişkin yargı kararı saklıdır)',[2,4,2,4],'count'),
    activity('7.7','citation','Güzel sanat eserinin uluslararası kaynakta yer alması',[NONE,NONE,NONE,8],'count'),
    activity('7.8','citation','Güzel sanat eserinin ulusal kaynakta yer alması',[NONE,NONE,NONE,4],'count'),
    activity('8.1','conference','Hakemli uluslararası toplantıda sözlü sunulmuş tam metin bildiri',SAME(15),'authors','Sözlü sunum, tam metin, en az beş farklı yabancı ülke katılımı ve yurt dışı tebliğ çoğunluğu koşullarını kontrol edin.'),
    activity('9.1','award','YÖK Yılın Doktora Tezi Ödülü',SAME(100),'count'),
    activity('9.2','award','TÜBİTAK Bilim Ödülü',SAME(100),'count'),
    activity('9.3','award','TÜBA Akademi Ödülü',SAME(100),'count'),
    activity('9.4','award','Yurt dışı kurum / kuruluşun düzenli bilim ödülü',SAME(40),'shared'),
    activity('9.5','award','Yurt içi kurum / kuruluşun düzenli bilim ödülü',SAME(20),'shared'),
    activity('9.6','award','Uluslararası jürili güzel sanat etkinliğinde derece ödülü',[NONE,NONE,NONE,40],'shared'),
    activity('9.7','award','Ulusal jürili güzel sanat etkinliğinde derece ödülü',[NONE,NONE,NONE,20],'shared'),
    activity('9.8','award','Mimarlık ve tasarım alanındaki düzenli yarışmada derece ödülü',[NONE,NONE,20,NONE],'shared')
  ];
  const BY_ID = Object.fromEntries(ACTIVITIES.map(a=>[a.id,a]));
  const FIELD_INDEX = { A1: 0, A2: 1, A3: 2, A4: 3 };
  const QUARTILE = { Q1: 1, Q2: .8, Q3: .5, Q4: .25, AHCI: .5 };
  const DEFAULTS = { field:'A2', title:'associate', period:'2026-2', customCoefficient:PERIODS['2026-2'].coefficient };

  function authorCoefficient(people) {
    const n = Number(people);
    if (!Number.isInteger(n) || n < 1) throw new Error('Yazar/kişi sayısı 1 veya daha büyük bir tam sayı olmalıdır.');
    if (n === 1) return 1;
    if (n === 2) return .8;
    if (n === 3) return .6;
    if (n === 4) return .45;
    return 1/n;
  }
  function num(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    return Number(value);
  }
  function validateEntry(entry, field) {
    const activity = BY_ID[entry?.activityId];
    if (!activity) throw new Error('Tanımlanmamış faaliyet türü.');
    if (!Object.hasOwn(FIELD_INDEX,field)) throw new Error('Geçerli bir akademik alan seçiniz.');
    const rate = activity.rates[FIELD_INDEX[field]];
    if (rate === null) throw new Error('Bu faaliyet seçilen akademik alanda puanlanmıyor.');
    const quantity = num(entry.quantity,1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error('Adet 1–10.000 arasında bir tam sayı olmalıdır.');
    if (['authors','quartile','chapter','shared'].includes(activity.mode)) authorCoefficient(num(entry.people,1));
    if (activity.mode === 'quartile' && !Object.hasOwn(QUARTILE,entry.quartile||'Q1')) throw new Error('Dergi çeyreklik sınıfını seçiniz.');
    if (['project','long-project'].includes(activity.mode) && !['leader','researcher'].includes(entry.role||'leader')) throw new Error('Projedeki rolünüzü seçiniz.');
    if (activity.mode === 'long-project' && (!Number.isInteger(num(entry.projectMonths,0)) || num(entry.projectMonths,0) < 9)) throw new Error('Bu proje için destek süresi en az 9 ay olmalıdır.');
    if (activity.mode === 'research' && (!Number.isInteger(num(entry.months,0)) || num(entry.months,0) < 4)) throw new Error('Araştırma süresi en az dört tam ay olmalıdır.');
    if (activity.mode === 'research' && num(entry.months,0)>240) throw new Error('Araştırma süresi 240 ayı geçemez.');
    if (activity.mode === 'chapter' && !String(entry.bookTitle||'').trim()) throw new Error('Kitap bölümlerini sınırlandırabilmek için kitap adı/ISBN giriniz.');
    return activity;
  }
  function entryBreakdown(entry, field, effectiveQty) {
    const activity = validateEntry(entry,field);
    const rate = activity.rates[FIELD_INDEX[field]];
    const quantity = effectiveQty===undefined ? num(entry.quantity,1) : effectiveQty;
    let multiplier = 1;
    const factors=[];
    if (['authors','quartile','chapter'].includes(activity.mode)) {
      const k = authorCoefficient(num(entry.people,1));
      multiplier*=k; factors.push(`k=${parseFloat(k.toFixed(6))}`);
    }
    if (activity.mode==='shared') {
      const k=1/num(entry.people,1);
      multiplier*=k; factors.push(`kişi payı=1/${num(entry.people,1)}`);
    }
    if (activity.mode==='quartile') {
      const p=QUARTILE[entry.quartile||'Q1'];
      multiplier*=p; factors.push(`p=${p}`);
    }
    if (['project','long-project'].includes(activity.mode)) {
      const r=entry.role==='researcher'?.5:1;
      multiplier*=r; factors.push(`r=${r}`);
    }
    if (activity.mode==='research') {
      multiplier*=num(entry.months,4);
      factors.push(`ay=${num(entry.months,4)}`);
    }
    const score= CATEGORIES.find(c=>c.id===activity.category).cap * rate / 100 * multiplier * quantity;
    const formula = `${CATEGORIES.find(c=>c.id===activity.category).cap} × ${rate}/100 × ${factors.length?factors.join(' × ')+' × ':''}${quantity}`;
    return { score, formula, rate, activity, quantity, multiplier };
  }
  function calculate(state) {
    const field = state?.field;
    const title = state?.title;
    if (!Object.hasOwn(FIELD_INDEX,field)) throw new Error('Alan seçiniz.');
    if (!Object.hasOwn(TITLES,title)) throw new Error('Akademik unvan seçiniz.');
    const coefficient = num(state.customCoefficient, PERIODS['2026-2'].coefficient);
    if (!Number.isFinite(coefficient) || coefficient <= 0 || coefficient>100) throw new Error('Maaş katsayısı geçersiz.');
    const entries = Array.isArray(state.entries)?state.entries:[];
    const chapterCounts={};
    const editorCandidates=entries.map((e,index)=>({e,index,activity:BY_ID[e.activityId]}))
      .filter(x=>x.activity?.mode==='editor' && x.activity.rates[FIELD_INDEX[field]]!==null);
    editorCandidates.sort((a,b)=>b.activity.rates[FIELD_INDEX[field]]-a.activity.rates[FIELD_INDEX[field]] || a.index-b.index);
    const countedEditorIndex=editorCandidates.length?editorCandidates[0].index:-1;
    const calculated=[];
    for (let entryIndex=0;entryIndex<entries.length;entryIndex++) {
      const e=entries[entryIndex];
      const a=BY_ID[e.activityId];
      if (!a) throw new Error('Tanımlanmamış faaliyet türü.');
      if (a.rates[FIELD_INDEX[field]]===null) {
        calculated.push({score:0,formula:'Seçilen alanda puanlanmaz',rate:0,activity:a,entry:e,effectiveQty:0,warnings:['Bu faaliyet seçili bilim alanında puanlanmaz; alanı değiştirince tekrar etkinleşebilir.'],category:a.category});
        continue;
      }
      validateEntry(e,field);
      let effectiveQty = num(e.quantity,1);
      const warnings=[];
      if (a.mode==='editor') {
        if (entryIndex!==countedEditorIndex) { effectiveQty=0; warnings.push('Yalnızca en yüksek puanlı bir baş editörlük puanlanabilir.'); }
        else if(effectiveQty>1) {effectiveQty=1; warnings.push('Baş editörlükte en çok bir faaliyet puanlanır.');}
      }
      if (a.mode==='chapter') {
        const book=String(e.bookTitle||'').trim().toLocaleLowerCase('tr-TR');
        const already=chapterCounts[book]||0;
        effectiveQty=Math.max(0,Math.min(effectiveQty,2-already));
        chapterCounts[book]=already+effectiveQty;
        if (effectiveQty<num(e.quantity,1)) warnings.push('Aynı kitapta en çok iki bölüm değerlendirmeye alınır.');
      }
      const b=entryBreakdown(e,field,effectiveQty);
      calculated.push({ ...b, entry:e, effectiveQty, warnings, category:a.category });
    }
    const groups=CATEGORIES.map(c=>{
      const records=calculated.filter(x=>x.category===c.id);
      const raw=records.reduce((sum,r)=>sum+r.score,0);
      return {...c, raw, score:Math.min(c.cap,raw), overflow:Math.max(0,raw-c.cap), count:records.reduce((s,r)=>s+r.effectiveQty,0)};
    });
    const subtotal=groups.reduce((s,g)=>s+g.score,0);
    const total=Math.min(100,subtotal);
    const eligible=total>=30-1e-9;
    const gross= eligible? 9500*coefficient*TITLES[title].multiplier*total/100:0;
    return {total,subtotal,eligible,gross,coefficient,groups,entries:calculated,rawTotal:groups.reduce((s,g)=>s+g.raw,0)};
  }
  function cleanImport(data) {
    if (!data || typeof data!=='object' || !Array.isArray(data.entries)) throw new Error('Bu dosya geçerli bir teşvik yedeği değil.');
    if(data.entries.length>10000) throw new Error('Yedek çok fazla kayıt içeriyor.');
    const settings={...DEFAULTS,
      field:Object.hasOwn(FIELD_INDEX,data.field)?data.field:DEFAULTS.field,
      title:Object.hasOwn(TITLES,data.title)?data.title:DEFAULTS.title,
      period:Object.hasOwn(PERIODS,data.period)?data.period:'custom',
      customCoefficient:num(data.customCoefficient,DEFAULTS.customCoefficient)
    };
    const entries=data.entries.map((e,i)=>({
      id:String(e.id||`item-${i}`).slice(0,80),
      activityId:String(e.activityId||''),
      quantity:num(e.quantity,1),
      people:num(e.people,1),
      months:num(e.months,4),
      projectMonths:num(e.projectMonths,9),
      role:String(e.role||'leader'),
      quartile:String(e.quartile||'Q1'),
      bookTitle:String(e.bookTitle||'').slice(0,250),
      note:String(e.note||'').slice(0,500)
    }));
    for (const entry of entries) {
      const activity=BY_ID[entry.activityId];
      if (!activity) throw new Error('Yedekte tanınmayan faaliyet kodu var.');
      const validField=['A1','A2','A3','A4'].find((f,i)=>activity.rates[i]!==null);
      validateEntry(entry, validField);
    }
    calculate({...settings,entries});
    return {...settings, entries};
  }
  return {PERIODS,TITLES,FIELDS,CATEGORIES,ACTIVITIES,BY_ID,DEFAULTS,QUARTILE,authorCoefficient,validateEntry,entryBreakdown,calculate,cleanImport};
});
