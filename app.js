/* Akademik Teşvik 2026, vanilla JavaScript istemcisi. Harici bağımlılık yok. */
(function() {
  'use strict';
  const E = window.IncentiveEngine;
  const KEY = 'akademik-tesvik-2026-v1';
  const $ = id => document.getElementById(id);
  const tr = (n,d=2) => new Intl.NumberFormat('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
  const money = n => new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(n);
  const ico = name => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const escapeHTML = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state = {...E.DEFAULTS, entries:[]};
  let editingId = null;
  let modalActivity = null;
  let toastTimer;
  let searchTerm = '';

  function readLocal() {
    try { const raw=localStorage.getItem(KEY); if(raw) state=E.cleanImport(JSON.parse(raw)); }
    catch(err) { console.warn('Kaydedilmiş veriler okunamadı:',err.message); }
  }
  function save() {
    try { localStorage.setItem(KEY,JSON.stringify({...state,version:1,updatedAt:new Date().toISOString()}));
      $('save-indicator').textContent='Değişiklikler cihazınıza kaydedildi';
    } catch(err) {$('save-indicator').textContent='Yerel depolamaya yazılamadı';}
  }
  function toast(message,error=false) {
    const el=$('toast'); el.textContent=message;el.className='toast'+(error?' error':'');el.hidden=false;
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,3700);
  }
  function setupProfile() {
    $('title-input').innerHTML=Object.entries(E.TITLES).map(([id,t])=>`<option value="${id}">${escapeHTML(t.label)}</option>`).join('');
    $('field-input').innerHTML=Object.entries(E.FIELDS).map(([id,t])=>`<option value="${id}">${id} — ${escapeHTML(t)}</option>`).join('');
    $('period-input').innerHTML=Object.entries(E.PERIODS).map(([id,p])=>`<option value="${id}">${escapeHTML(p.label)}</option>`).join('')+'<option value="custom">Özel dönem / katsayı</option>';
    $('title-input').value=state.title;
    $('field-input').value=state.field;
    $('period-input').value=state.period;
    $('coefficient-input').value=state.customCoefficient;
    updateFieldDescription();
    $('title-input').addEventListener('change',ev=>{state.title=ev.target.value;changed(false);});
    $('field-input').addEventListener('change',ev=>{state.field=ev.target.value;updateFieldDescription();changed(true);});
    $('period-input').addEventListener('change',ev=>{
      state.period=ev.target.value;
      if(E.PERIODS[state.period]) state.customCoefficient=E.PERIODS[state.period].coefficient;
      $('coefficient-input').value=state.customCoefficient;changed(false);
    });
    $('coefficient-input').addEventListener('change',ev=>{
      const n=Number(ev.target.value);
      if(!Number.isFinite(n)||n<=0||n>100){ev.target.value=state.customCoefficient;toast('Geçerli bir aylık katsayı giriniz.',true);return;}
      state.customCoefficient=n;
      state.period='custom';$('period-input').value='custom';changed(false);
    });
  }
  function updateFieldDescription() {$('field-description').querySelector('span').textContent=`${state.field}: ${E.FIELDS[state.field]}. Faaliyet türlerinin puanlama oranları alana göre değişir.`;}
  function setupNav() {
    $('category-nav').innerHTML=E.CATEGORIES.map(c=>`<button type="button" data-to="${c.id}" title="${escapeHTML(c.name)}">${ico(c.icon)}${c.name}<span class="nav-num" id="nav-count-${c.id}">0</span></button>`).join('');
    $('category-nav').addEventListener('click',e=>{const b=e.target.closest('[data-to]');if(!b)return;const group=$(`category-${b.dataset.to}`);if(group){group.open=true;group.scrollIntoView({behavior:'smooth',block:'start'});} });
    $('go-top').addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
  }
  function renderSections() {
    let found=0;
    $('sections').innerHTML=E.CATEGORIES.map(c=>{
      const rows=E.ACTIVITIES.filter(a=>a.category===c.id && (!searchTerm||`${a.id} ${a.label} ${a.details} ${c.name}`.toLocaleLowerCase('tr-TR').includes(searchTerm)));
      if(!rows.length)return '';
      found+=rows.length;
      return `<details class="activity-section" id="category-${c.id}" ${searchTerm || ['project','publication','citation'].includes(c.id)?'open':''}>
        <summary><span class="category-icon">${ico(c.icon)}</span><div class="category-identity"><strong>${c.number}. ${c.name}</strong><small>${escapeHTML(c.hint)}</small></div><div class="summary-meta"><span class="summary-count">${rows.length} alt faaliyet</span><span class="cap-badge">MAKS. ${c.cap} P</span>${ico('chevron').replace('<svg','<svg class="section-arrow"')}</div></summary>
        <div class="activity-items">${rows.map(a=>{
          const rate=a.rates[['A1','A2','A3','A4'].indexOf(state.field)];
          const eligible=rate!==null;
          return `<div class="activity-item${eligible?'':' disabled'}"><span class="activity-code">${a.id}</span><div class="activity-detail"><strong>${escapeHTML(a.label)}</strong>${a.details?`<small>${escapeHTML(a.details)}</small>`:''}</div>${eligible?`<button type="button" class="add-button" aria-label="${escapeHTML(a.id)} faaliyetini ekle" title="Faaliyeti ekle" data-add="${a.id}">${ico('plus')}</button>`:'<span class="not-available">Bu alanda yok</span>'}</div>`;
        }).join('')}</div></details>`;
    }).join('');
    $('no-results').hidden=found>0;
  }
  function getEntryFromModal() {
    const form=$('add-form');
    const get=name=>form.elements.namedItem(name)?.value;
    return {
      id:editingId || `a-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      activityId:modalActivity.id,
      quantity:Number(get('quantity')||1),
      people:Number(get('people')||1),
      months:Number(get('months')||4),
      projectMonths:Number(get('projectMonths')||9),
      role:get('role')||'leader',quartile:get('quartile')||'Q1',
      bookTitle:String(get('bookTitle')||'').trim(), note:String(get('note')||'').trim()
    };
  }
  function inputField(label,name,type,value,min=1,max=10000,wide=false) {
    return `<label class="field-block${wide?' full-width':''}">${label}<input name="${name}" type="${type}" min="${min}" max="${max}" step="1" required value="${escapeHTML(value)}"></label>`;
  }
  function selectField(label,name,options,value) {
    return `<label class="field-block">${label}<select name="${name}">${options.map(([id,t])=>`<option value="${escapeHTML(id)}" ${id===value?'selected':''}>${escapeHTML(t)}</option>`).join('')}</select></label>`;
  }
  function openModal(id, entry=null) {
    const a=E.BY_ID[id]; if(!a)return;
    if(a.rates[['A1','A2','A3','A4'].indexOf(state.field)]===null){toast('Bu faaliyet seçilen alanda puanlanmıyor.',true);return;}
    editingId=entry?.id||null; modalActivity=a;
    $('dialog-title').textContent=entry?'Faaliyeti düzenle':'Faaliyet bilgileri';
    $('selected-id').textContent=id;$('selected-label').textContent=a.label;
    $('selected-hint').textContent=a.details||'Seçtiğiniz faaliyetin ayrıntılarını aşağıya giriniz.';
    const e=entry||{};
    let fields='';
    if(['project','long-project'].includes(a.mode)) {
      fields+=selectField('Projedeki göreviniz','role',[['leader','Yürütücü (r = 1)'],['researcher','Araştırmacı / bursiyer (r = 0,5)']],e.role||'leader');
    }
    if(a.mode==='long-project')fields+=inputField('Projenin destek süresi (ay)','projectMonths','number',e.projectMonths||9,9,240);
    if(a.mode==='research')fields+=inputField('Araştırma süresi (ay)','months','number',e.months||4,4,240);
    if(['authors','quartile','chapter','shared'].includes(a.mode)){
      fields+=inputField(a.mode==='shared'?'Faaliyette toplam kişi sayısı':'Toplam yazar / buluşçu sayısı','people','number',e.people||1,1,10000);
    }
    if(a.mode==='quartile')fields+=selectField('Dergi çeyreklik sınıfı','quartile',[['Q1','Q1 · %100'],['Q2','Q2 · %80'],['Q3','Q3 · %50'],['Q4','Q4 / Q değeri yok · %25'],['AHCI','AHCI · %50']],e.quartile||'Q1');
    if(a.mode==='chapter')fields+=`<label class="field-block full-width">Kitap adı veya ISBN <span>*</span><input name="bookTitle" type="text" maxlength="250" required value="${escapeHTML(e.bookTitle||'')}" placeholder="Aynı kitapta en çok 2 bölüm puanlanır"></label>`;
    fields+=inputField('Faaliyet / atıf adedi','quantity','number',e.quantity||1,1,10000);
    $('modal-fields').innerHTML=fields;
    $('add-form').elements.namedItem('note').value=e.note||'';
    $('submit-entry').innerHTML=ico(entry?'check':'plus')+(entry?' Değişiklikleri kaydet':' Faaliyeti ekle');
    $('form-error').hidden=true;
    updatePreview();$('add-dialog').showModal();
    $('modal-fields').querySelector('input,select')?.focus();
  }
  function updatePreview() {
    try{const e=getEntryFromModal();const b=E.entryBreakdown(e,state.field);
      $('preview-score').textContent=tr(b.score);$('preview-formula').textContent=b.formula+' = '+tr(b.score)+' puan';$('form-error').hidden=true;
    }catch(err){$('preview-score').textContent='—';$('preview-formula').textContent='Eksik ya da geçersiz bilgiler';}
  }
  function closeModal() {$('add-dialog').close();editingId=null;modalActivity=null;}
  function setupModal() {
    $('sections').addEventListener('click',e=>{const btn=e.target.closest('[data-add]');if(btn)openModal(btn.dataset.add);});
    $('close-dialog').addEventListener('click',closeModal);
    $('cancel-dialog').addEventListener('click',closeModal);
    $('add-dialog').addEventListener('close',()=>{editingId=null;modalActivity=null;});
    $('add-form').addEventListener('input',updatePreview);
    $('add-form').addEventListener('change',updatePreview);
    $('add-form').addEventListener('submit',ev=>{
      ev.preventDefault();
      try {
        const entry=getEntryFromModal();E.validateEntry(entry,state.field);
        if(editingId){const idx=state.entries.findIndex(x=>x.id===editingId);if(idx<0)throw new Error('Düzenlenecek kayıt bulunamadı.');state.entries[idx]=entry;}
        else state.entries.push(entry);
        const wasEditing=Boolean(editingId);closeModal();changed(false);
        toast(wasEditing?'Faaliyet güncellendi.':'Faaliyet hesaplamaya eklendi.');
      }catch(err){$('form-error').hidden=false;$('form-error').textContent=err.message;}
    });
    $('add-dialog').addEventListener('click',e=>{if(e.target===$('add-dialog'))closeModal();});
  }
  function changed(redoSections=false) {
    save();if(redoSections)renderSections();renderResults();
  }
  function renderResults() {
    let result;
    try{result=E.calculate(state);}catch(err){toast(err.message,true);return;}
    const score=result.total;
    $('score-total').textContent=tr(score);
    const angle=Math.max(0,Math.min(360,score/100*360));
    $('score-gauge').style.background=`conic-gradient(#5973e8 0deg, #5973e8 ${angle}deg, #eaf0f8 ${angle}deg, #eaf0f8 360deg)`;
    $('eligibility').classList.toggle('success',result.eligible);
    $('eligibility').innerHTML=ico(result.eligible?'check':'info')+`<span>${result.eligible?`<strong>Ödeme eşiğini aştınız!</strong> ${tr(score)} akademik teşvik puanı.`:`Ödeme için <strong>${tr(Math.max(0,30-score))} puan</strong> daha gerekiyor.`}</span>`;
    $('gross-total').textContent=money(result.gross);
    $('gross-subtitle').textContent=(E.PERIODS[state.period]?.label||'Özel katsayı')+' · Brüt tahmini ödeme';
    $('category-bars').innerHTML=result.groups.map(g=>{
      const pct=Math.min(100,g.score/g.cap*100);
      return `<div class="cat-bar"><div class="bar-head"><span>${g.number}. ${g.name}</span><b>${tr(g.score,1)} / ${g.cap}</b></div><div class="bar-track"><div class="bar-fill${pct>=100?' complete':''}" style="width:${pct}%"></div></div></div>`;
    }).join('');
    for(const g of result.groups){const el=$(`nav-count-${g.id}`);if(el)el.textContent=g.count;}
    $('activity-counter').textContent=`${state.entries.length} kayıt eklendi`;
    renderHistory(result);
    return result;
  }
  function renderHistory(result) {
    $('clear-all').hidden=state.entries.length===0;
    if(!state.entries.length){$('history-content').innerHTML=`<div class="history-empty">${ico('book-open')}<strong>Henüz faaliyet eklemediniz</strong><p>Yukarıdan bir faaliyet seçip + işaretine basarak başlayabilirsiniz.</p></div>`;return;}
    $('history-content').innerHTML=`<div class="history-table-wrap"><table class="history-table"><thead><tr><th>FAALİYET</th><th>HESAPLAMA</th><th>PUAN</th><th>İŞLEMLER</th></tr></thead><tbody>${result.entries.map(e=>{
      return `<tr><td><span class="item-id">${e.activity.id}</span><div class="item-title">${escapeHTML(e.activity.label)}</div>${e.entry.note?`<small class="item-note">${escapeHTML(e.entry.note)}</small>`:''}${e.entry.bookTitle?`<small class="item-note">Kitap: ${escapeHTML(e.entry.bookTitle)}</small>`:''}${e.warnings?.length?`<small class="item-warning">${e.warnings.map(escapeHTML).join('; ')}</small>`:''}</td><td><span class="item-formula">${escapeHTML(e.formula)}</span></td><td class="item-score">${tr(e.score)}</td><td class="actions"><button type="button" class="mini-icon-btn" data-edit="${escapeHTML(e.entry.id)}" aria-label="Düzenle" title="Düzenle">${ico('edit')}</button><button type="button" class="mini-icon-btn remove" data-remove="${escapeHTML(e.entry.id)}" aria-label="Sil" title="Sil">${ico('trash')}</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function setupHistory() {
    $('history-content').addEventListener('click',ev=>{
      const edit=ev.target.closest('[data-edit]');const remove=ev.target.closest('[data-remove]');
      if(edit){const entry=state.entries.find(e=>e.id===edit.dataset.edit);if(entry)openModal(entry.activityId,entry);}
      if(remove){state.entries=state.entries.filter(e=>e.id!==remove.dataset.remove);changed(false);toast('Kayıt silindi.');}
    });
    $('clear-all').addEventListener('click',()=>{
      if(!window.confirm('Eklediğiniz tüm akademik faaliyetleri silmek istiyor musunuz?'))return;
      state.entries=[];changed(false);toast('Faaliyet kayıtları temizlendi.');
    });
  }
  function setupSearch() {
    $('activity-search').addEventListener('input',ev=>{
      searchTerm=ev.target.value.toLocaleLowerCase('tr-TR').trim();$('clear-search').hidden=!searchTerm;renderSections();
    });
    $('clear-search').addEventListener('click',()=>{$('activity-search').value='';searchTerm='';$('clear-search').hidden=true;renderSections();$('activity-search').focus();});
  }
  function download(blob,filename) {
    const a=document.createElement('a'); const url=URL.createObjectURL(blob);
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2500);
  }
  function exportJSON() {
    const obj={format:'akademik-tesvik-2026',version:1,exportedAt:new Date().toISOString(),...state};
    download(new Blob([JSON.stringify(obj,null,2)],{type:'application/json;charset=utf-8'}),'akademik-tesvik-yedek.json');
    toast('JSON yedeği oluşturuldu.');
  }
  function exportCSV() {
    const r=E.calculate(state);
    const safe=s=>{let value=String(s??'');if(/^[=+\-@\t\r]/.test(value))value="'"+value;return '"'+value.replaceAll('"','""')+'"';};
    const rows=[['Kod','Faaliyet','Açıklama','Kategori','Adet','Kişi','Q','Görev','Süre (ay)','Formül','Puan']];
    for(const e of r.entries){rows.push([e.activity.id,e.activity.label,e.entry.note,e.category,e.effectiveQty,e.entry.people||1,e.entry.quartile||'',e.entry.role||'',e.entry.months||'',e.formula,tr(e.score)]);}
    rows.push([],['TOPLAM PUAN',tr(r.total)],['ÖDEME EŞİĞİ',r.eligible?'Evet':'Hayır'],['AYLIK BRÜT TAHMİN',money(r.gross)]);
    download(new Blob(['\ufeff'+rows.map(r=>r.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'akademik-tesvik-sonuc.csv');
    toast('CSV tablosu indirildi.');
  }
  function setupTransfer() {
    $('export-json').addEventListener('click',exportJSON);
    $('export-csv').addEventListener('click',exportCSV);
    $('import-json').addEventListener('click',()=>$('file-input').click());
    $('file-input').addEventListener('change',async ev=>{
      const file=ev.target.files?.[0];if(!file)return;
      try {
        if(file.size>2e6)throw new Error('Yedek dosyası 2 MB üzerinde olamaz.');
        const imported=E.cleanImport(JSON.parse(await file.text()));
        if(state.entries.length && !window.confirm('Mevcut kayıtlarınızın yerini yedekteki kayıtlar alsın mı?'))return;
        state=imported;setupProfileValues();changed(true);toast(`${state.entries.length} kayıt yedekten geri yüklendi.`);
      }catch(err){toast('Yedek yüklenemedi: '+err.message,true);}
      finally{ev.target.value='';}
    });
    $('export-png').addEventListener('click',exportPNG);
    $('print-report').addEventListener('click',()=>window.print());
  }
  function setupProfileValues() {
    $('title-input').value=state.title;$('field-input').value=state.field;
    $('period-input').value=state.period;$('coefficient-input').value=state.customCoefficient;
    updateFieldDescription();
  }
  function exportPNG() {
    const r=E.calculate(state);
    const visible=r.entries.slice(0,100), width=1150, height=525+visible.length*43+80;
    const cv=document.createElement('canvas'); cv.width=width*1.5;cv.height=height*1.5;
    const c=cv.getContext('2d');c.scale(1.5,1.5);
    c.fillStyle='#f6f8fc';c.fillRect(0,0,width,height);
    c.fillStyle='#162744';c.fillRect(0,0,width,120);
    c.fillStyle='#ffffff';c.font='bold 30px Arial';c.fillText('AKADEMİK TEŞVİK · 2026',45,55);
    c.fillStyle='#b5c4e5';c.font='15px Arial';c.fillText(`${E.TITLES[state.title].label}  •  ${state.field}  •  ${E.PERIODS[state.period]?.label||'Özel dönem'}`,46,89);
    c.fillStyle='#fff';c.fillRect(35,146,width-70,205);
    c.fillStyle='#7787a0';c.font='bold 16px Arial';c.fillText('TOPLAM TEŞVİK PUANI',60,183);
    c.fillStyle='#2d4293';c.font='bold 74px Arial';c.fillText(tr(r.total),55,265);
    c.fillStyle='#8793a9';c.font='bold 16px Arial';c.fillText('TAHMİNİ AYLIK BRÜT ÖDEME',595,183);
    c.fillStyle='#1c9b7f';c.font='bold 43px Arial';c.fillText(money(r.gross),588,250);
    c.font='14px Arial';c.fillStyle='#7787a0';c.fillText(r.eligible?'30 puan eşiği geçildi':'30 puan eşiği henüz geçilmedi',590,283);
    c.fillStyle='#182948';c.font='bold 19px Arial';c.fillText('FAALİYET DAĞILIMI',45,390);
    r.groups.forEach((g,i)=>{
      const x=45+(i%3)*365,y=420+Math.floor(i/3)*26;
      c.fillStyle='#61718d';c.font='12px Arial';c.fillText(`${g.name}  ${tr(g.score,1)} / ${g.cap}`,x,y);
      c.fillStyle='#e3e8f1';c.fillRect(x+130,y-9,194,8);
      c.fillStyle='#6277df';c.fillRect(x+130,y-9,194*g.score/g.cap,8);
    });
    c.fillStyle='#182948';c.font='bold 19px Arial';c.fillText('EKLENEN FAALİYETLER',45,525);
    visible.forEach((e,i)=>{
      const y=555+i*43;
      c.fillStyle=i%2===0?'#fff':'#f1f4fb';c.fillRect(35,y-19,width-70,42);
      c.fillStyle='#5367c5';c.font='bold 12px Arial';c.fillText(e.activity.id,46,y+2);
      c.fillStyle='#3b4862';c.font='12px Arial';
      let label=e.activity.label;
      while(c.measureText(label).width>820 && label.length>8) label=label.slice(0,-5)+'…';
      c.fillText(label,105,y+2);
      c.fillStyle='#263b75';c.font='bold 14px Arial';c.fillText(tr(e.score),1010,y+2);
    });
    if(r.entries.length>100){c.fillStyle='#a46436';c.font='12px Arial';c.fillText(`İlk 100 kayıt gösterildi. Toplam ${r.entries.length} kayıt için CSV veya yazdır seçeneğini kullanın.`,45,height-45);}
    c.fillStyle='#a0acc0';c.font='12px Arial';c.fillText(`Oluşturulma: ${new Date().toLocaleString('tr-TR')} · Resmi komisyon kararı yerine geçmez.`,45,height-20);
    cv.toBlob(blob=>{if(blob)download(blob,'akademik-tesvik-rapor.png');else toast('PNG dosyası oluşturulamadı.',true);},'image/png');
  }
  function init() {
    readLocal();setupProfile();setupNav();setupSearch();renderSections();setupModal();setupHistory();setupTransfer();renderResults();
  }
  init();
})();
