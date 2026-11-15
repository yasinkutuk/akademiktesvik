/* Akademik Teşvik 2026, vanilla JavaScript istemcisi. Harici bağımlılık yok. */
(function() {
  'use strict';
  const E = window.IncentiveEngine;
  let activityYear = Number(localStorage.getItem('tesvik-selected-year')) || new Date().getFullYear()-1;
  let activePersonId=personId(localStorage.getItem('tesvik-selected-person'));
  const personStorageKey=(year,id)=>`akademik-tesvik-year-${year}-v2${id?'-person-'+encodeURIComponent(id):''}`;
  let KEY=personStorageKey(activityYear,activePersonId);
  let importRevision=0,activeImportController=null,reviewContextVisible=true;
  let resetSavedYok=()=>{},savedYokCount=0;
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

  let numberControlId=0;
  function syncNumberControl(input) {
    const control=input.closest('.number-stepper');if(!control)return;
    const value=input.valueAsNumber,locked=input.matches(':disabled')||input.readOnly;
    control.querySelector('[data-number-step="-1"]').disabled=locked||(input.value!==''&&input.min!==''&&value<=Number(input.min));
    control.querySelector('[data-number-step="1"]').disabled=locked||(input.value!==''&&input.max!==''&&value>=Number(input.max));
  }
  function enhanceNumberInputs(root=document) {
    for(const input of root.querySelectorAll('input[type="number"]')) {
      if(input.closest('.number-stepper')){syncNumberControl(input);continue;}
      const label=input.parentElement.matches('label.field-block')?input.parentElement:null;
      const name=label?.textContent.replace(/\s+/g,' ').trim()||'Değer';
      if(!input.id)input.id=`number-control-${++numberControlId}`;
      const control=document.createElement('div');control.className='number-stepper';
      const minus=document.createElement('button'),plus=document.createElement('button');
      for(const [button,step,symbol,action] of [[minus,-1,'−','azalt'],[plus,1,'+','artır']]) {
        button.type='button';button.dataset.numberStep=step;button.textContent=symbol;
        button.setAttribute('aria-label',`${name} ${action}`);button.setAttribute('aria-controls',input.id);
      }
      if(label){
        // Keep one label per input; the two action buttons sit outside the label.
        const field=document.createElement('div');field.className=label.className;
        if(label.dataset.forModes){field.dataset.forModes=label.dataset.forModes;delete label.dataset.forModes;}
        field.hidden=label.hidden;label.hidden=false;label.className='number-stepper-label';label.htmlFor=input.id;
        label.replaceWith(field);input.remove();field.append(label,control);
      }else input.replaceWith(control);
      control.append(minus,input,plus);syncNumberControl(input);
    }
  }
  function setupNumberControls() {
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-number-step]');if(!button||button.disabled)return;
      const input=button.closest('.number-stepper')?.querySelector('input');
      if(!input||input.matches(':disabled')||input.readOnly)return;
      if(input.value==='')input.value=input.min||'0';
      else if(Number(button.dataset.numberStep)<0)input.stepDown();else input.stepUp();
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));syncNumberControl(input);
    });
    for(const name of ['input','change'])document.addEventListener(name,event=>{if(event.target.matches('input[type="number"]'))syncNumberControl(event.target);});
    enhanceNumberInputs();
  }

  const IMPORT_SECTIONS=new Set(['article','conference','book','project','award']);
  const allowedImportRow=row=>row.section?IMPORT_SECTIONS.has(row.section):/makale|bildiri|kitap|proje|ödül|yayın|tebliğ/.test(String(row.kind||'Yayın').toLocaleLowerCase('tr-TR'));
  function personId(value) {
    const text=String(value||'').trim().replace(/&amp;/gi,'&').replace(/\\&/g,'&').replace(/\\_/g,'_');
    if(!text)return '';
    let id=text;
    if(/^https?:/i.test(text)) {
      try {const url=new URL(text);if(url.hostname!=='akademik.yok.gov.tr'||url.username||url.password)return '';id=url.searchParams.get('authorGuidId')||url.searchParams.get('authorId')||'';}catch{return '';}
    }
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))return '';
    return /^[a-f0-9]{16}$/i.test(id)?id.toUpperCase():id;
  }
  const personSource=id=>`https://akademik.yok.gov.tr/academician-details?authorGuidId=${encodeURIComponent(id)}`;
  const rowPerson=row=>personId(row.ownerId)||personId(row.source);
  function inferredPerson(data) {
    const explicit=personId(data.personId)||personId(data.importIdentity?.source);
    if(explicit)return explicit;
    const owners=new Set((data.review||[]).map(rowPerson).filter(Boolean));
    return owners.size===1?[...owners][0]:'';
  }
  function entryPerson(entry) {
    const explicit=personId(entry.ownerId);if(explicit)return explicit;
    const source=String(entry.note||'').match(/https?:\/\/akademik\.yok\.gov\.tr\/[^\s]+/);
    return source?personId(source[0]):'';
  }
  function scopePersonState(data,id) {
    const clean=E.cleanImport(data),trusted=personId(data.personId)===id;
    const review=clean.review.filter(r=>rowPerson(r)===id&&(!personId(r.source)||personId(r.source)===id));
    const linked=new Set(review.map(r=>`yok-${r.key}`));
    const foreign=new Set(clean.review.filter(r=>rowPerson(r)&&rowPerson(r)!==id).map(r=>`yok-${r.key}`));
    const ownsEntry=e=>{const owner=entryPerson(e);return owner?owner===id:(linked.has(e.id)&&!foreign.has(e.id));};
    return {...clean,personId:id,review:review.map(r=>({...r,ownerId:id})),
      entries:trusted?clean.entries.filter(e=>entryPerson(e)?entryPerson(e)===id:!foreign.has(e.id)):clean.entries.filter(ownsEntry),
      sourceSections:clean.sourceSections.filter(section=>personId(section.source)===id),
      importIdentity:personId(clean.importIdentity?.source)===id?clean.importIdentity:{name:'',source:personSource(id)}};
  }
  function reviewRows() {
    return reviewContextVisible&&activePersonId?(state.review||[]).filter(r=>allowedImportRow(r)&&rowPerson(r)===activePersonId):[];
  }
  function reviewSections() {
    return reviewContextVisible&&activePersonId?(state.sourceSections||[]).filter(r=>personId(r.source)===activePersonId):[];
  }
  function cancelImport() {importRevision++;activeImportController?.abort();activeImportController=null;}
  function refreshImportControls() {
    $('yok-fetch').disabled=false;$('activity-year').disabled=false;
    $('yok-html-import').disabled=!savedYokCount;
  }
  function suspendReview() {
    if(reviewContextVisible)save();
    cancelImport();resetSavedYok();reviewContextVisible=false;
    if($('review-dialog').open)$('review-dialog').close();
    renderReview();refreshImportControls();$('yok-status').textContent='Arama sonucundan bir kişi seçin; inceleme yalnızca seçilen kişiyi gösterir.';
  }
  function loadPersonYear() {
    state={...E.DEFAULTS,entries:[],review:[],sourceSections:[],personId:activePersonId};
    const raw=localStorage.getItem(KEY);
    if(raw){state=scopePersonState(JSON.parse(raw),activePersonId);return;}
    const legacy=localStorage.getItem(personStorageKey(activityYear,''));
    if(legacy) {
      const data=scopePersonState(JSON.parse(legacy),activePersonId);
      if(data.review.length||data.entries.length||data.sourceSections.length)state=data;
    }
    state.importIdentity||={name:'',source:personSource(activePersonId)};
  }
  function selectPerson(value,render=true) {
    const id=personId(value);if(!id)return false;
    if(id!==activePersonId||state.personId!==id) {
      if(!activePersonId||state.personId===activePersonId)save();cancelImport();resetSavedYok();clearPublicationSummary();activePersonId=id;localStorage.setItem('tesvik-selected-person',id);
      KEY=personStorageKey(activityYear,id);loadPersonYear();
    }
    reviewContextVisible=true;
    $('yok-id').value=state.importIdentity?.source||personSource(id);
    if(render){if($('review-dialog').open)$('review-dialog').close();setupProfileValues();changed(true);refreshImportControls();$('yok-status').textContent='Seçilen kişinin kayıtları gösteriliyor.';}else save();
    return true;
  }
  function beginImport() {
    if(!selectPerson($('yok-id').value))throw Error('Önce bir akademisyen seçin veya geçerli profil bağlantısını girin.');
    cancelImport();const controller=new AbortController();activeImportController=controller;
    return {revision:importRevision,person:activePersonId,year:activityYear,key:KEY,researcherId:$('yok-id').value,controller};
  }
  function isCurrentImport(context) {
    return context.revision===importRevision&&context.person===activePersonId&&context.year===activityYear&&context.key===KEY&&reviewContextVisible;
  }

  function migrateImportScope() {
    // Remove cached raw profile text and extra import categories in every saved year.
    try {
      for(const key of Object.keys(localStorage).filter(k=>/^akademik-tesvik-year-\d{4}-v2(?:-person-[A-Za-z0-9_%.-]+)?$/.test(k))) {
        try {
          const raw=JSON.parse(localStorage.getItem(key));
          if(raw&&Array.isArray(raw.entries))localStorage.setItem(key,JSON.stringify(E.cleanImport(raw)));
        } catch(err){console.warn('Bir yılın aktarım verileri temizlenemedi:',err.message);}
      }
    } catch(err){console.warn('Eski aktarım verileri temizlenemedi:',err.message);}
  }

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
      ownerId:activePersonId,activityId:modalActivity.id,
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
    $('modal-fields').innerHTML=fields;enhanceNumberInputs($('modal-fields'));
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
    save();if(redoSections)renderSections();renderResults();if($('review-summary'))renderReview();
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
    const obj={format:'akademik-tesvik-2026',version:1,activityYear,exportedAt:new Date().toISOString(),...state};
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
        if(file.size>50e6)throw new Error('Yedek dosyası 50 MB üzerinde olamaz.');
        const revision=importRevision;const imported=E.cleanImport(JSON.parse(await file.text()));
        if(revision!==importRevision)throw Error('Kişi değiştiği için yedek yükleme iptal edildi; tekrar deneyin.');
        if(state.entries.length && !window.confirm('Mevcut kayıtlarınızın yerini yedekteki kayıtlar alsın mı?'))return;
        const owner=inferredPerson(imported);
        cancelImport();
        if(owner){selectPerson(owner,false);state=scopePersonState(imported,owner);}
        else {state={...imported,personId:activePersonId,review:[],sourceSections:[],importIdentity:activePersonId?{name:'',source:personSource(activePersonId)}:null};}
        reviewContextVisible=true;setupProfileValues();changed(true);toast(`${state.entries.length} kayıt yedekten geri yüklendi.`);
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
    c.fillStyle='#ffffff';c.font='bold 30px Arial';c.fillText(`AKADEMİK TEŞVİK · ${activityYear} FAALİYETLERİ`,45,55);
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

  const PROFILE_CATEGORIES={book:['publication'],article:['publication'],conference:['conference'],project:['project'],award:['award'],patent:['patent'],art:['design','exhibition','publication'],editor:['publication'],referee:[],education:[],employment:[],course:[],thesis:[],membership:[],administration:[]};
  function reviewCategories(row) {
    if(Object.hasOwn(PROFILE_CATEGORIES,row.section))return PROFILE_CATEGORIES[row.section];
    const kind=String(row.kind||'').toLocaleLowerCase('tr-TR');
    return /bildiri|konferans|tebliğ/.test(kind)?['conference']:['publication'];
  }
  function scoringCandidate(row) {return !row.scoreExclusion&&reviewCategories(row).length>0&&(row.year===null||row.year===undefined||row.year===activityYear);}
  function infoReason(row) {if(row.scoreExclusion)return row.scoreExclusion;return reviewCategories(row).length===0?'Mevcut hesaplama motorunda bu bilgi için faaliyet kodu yok.':`${row.year} yılına ait; ${activityYear} yılı hesabına eklenmez. İlgili faaliyet yılını seçerek aktarın.`;}
  function reviewEntry(row) {
    if(!scoringCandidate(row))throw Error(infoReason(row));
    const d=row.draft||{};
    if(!d.confirmed)throw Error('Künye, doğru profil ve teşvik uygunluğu doğrulamasını işaretleyin.');
    if(row.year!==activityYear&&!d.yearConfirmed)throw Error('Faaliyet yılını kaynaktan doğrulayıp yıl onayını işaretleyin.');
    const activity=E.BY_ID[d.activityId];
    if(!activity||!reviewCategories(row).includes(activity.category))throw Error('Bu kayıt türüne uygun faaliyet türünü seçin.');
    let people=1;
    if(['authors','quartile','chapter','shared'].includes(activity.mode)){
      people=Number(d.people);if(!Number.isInteger(people)||people<1||people>10000)throw Error('Toplam yazar / kişi sayısını doğrulayın.');
    }
    if(activity.mode==='quartile'&&!Object.hasOwn(E.QUARTILE,d.quartile))throw Error('Yayın yılındaki Q dilimini seçin.');
    if(['project','long-project'].includes(activity.mode)&&!['leader','researcher'].includes(d.role))throw Error('Projedeki görevinizi seçin.');
    if(activity.mode==='long-project'&&(!Number.isInteger(Number(d.projectMonths))||Number(d.projectMonths)<9||Number(d.projectMonths)>240))throw Error('Projenin destek süresini 9–240 ay arasında doğrulayın.');
    const entry={id:`yok-${row.key}`,ownerId:activePersonId,activityId:activity.id,people,quantity:1,quartile:d.quartile||'Q1',
      role:d.role||'leader',projectMonths:Number(d.projectMonths)||0,months:Number(d.months)||0,
      bookTitle:d.bookTitle||'',note:`${activityYear} · ${row.title} · ${row.researcher} · ${row.source}`.slice(0,500)};
    if(activity.mode==='chapter'&&!entry.bookTitle.trim())throw Error('Kitap bölümü için kitap adını veya ISBN girin.');
    E.validateEntry(entry,state.field);return entry;
  }

  function renderSourceSections() {
    const target=$('profile-section-reports');target.replaceChildren();
    const labels={loaded:'Kayıtlar alındı',empty:'Kaynakta boş olduğu bildirildi',partial:'Kısmen alındı',failed:'Erişilemedi',unparsed:'Sayfa alındı; ayrıştırma kontrolü gerekli',not_attempted:'Sınır nedeniyle denenemedi',pending:'Bekliyor'};
    for(const section of reviewSections()){
      const block=document.createElement('details');block.className='source-section-report';
      const heading=document.createElement('summary');heading.textContent=`${section.label} · ${labels[section.status]||section.status} · ${section.count} kayıt`;
      block.append(heading);
      if(section.error){const error=document.createElement('p');error.className='review-warning';error.textContent=section.error;block.append(error);}
      if(section.source){const link=document.createElement('a');link.textContent='Bölümü YÖK üzerinde aç ↗';link.href=section.source;link.target='_blank';link.rel='noopener noreferrer';block.append(link);}
      if(section.rawText){const text=document.createElement('p');text.className='source-raw-text';text.textContent=section.rawText;block.append(text);}
      target.append(block);
    }
  }

  function readyReviewBatch() {
    const ids=new Set(state.entries.map(e=>e.id)),ready=[],invalid=[];
    let waiting=0;
    for(const row of reviewRows()) {
      if(!scoringCandidate(row)||row.status==='rejected'||ids.has(`yok-${row.key}`))continue;
      if(row.status!=='preapproved'){waiting++;continue;}
      try {
        const entry=reviewEntry(row);
        if(ids.has(entry.id))throw Error('Bu kayıt zaten ekli.');
        ids.add(entry.id);ready.push({row,entry});
      } catch(err){invalid.push({row,message:err.message});}
    }
    return {ready,invalid,waiting};
  }

  function renderReview() {
    const container=$('yok-preview');container.replaceChildren();renderSourceSections();
    const rows=reviewRows();
    const included=r=>state.entries.some(e=>e.id===`yok-${r.key}`);
    const counts={pending:0,preapproved:0,rejected:0,included:0};
    rows.forEach(r=>counts[included(r)?'included':r.status||'pending']++);
    const infoCount=rows.filter(r=>!scoringCandidate(r)).length;
    const summary=rows.length?`${counts.pending} inceleme bekliyor · ${counts.preapproved} ön onaylı · ${counts.included} hesaplamaya eklendi · ${counts.rejected} hariç tutuldu · ${infoCount} bilgi kaydı / başka yıl`:'İnceleme listesi boş. Bölümlerin erişim durumunu ve kaynak metnini aşağıdan kontrol edebilirsiniz.';
    $('review-summary').textContent=summary;$('review-dialog-summary').textContent=summary;
    $('review-dialog-title').textContent=`${state.importIdentity?.name?state.importIdentity.name+' · ':''}${activityYear} faaliyet kayıtları`;
    $('open-review').disabled=rows.length===0&&!reviewSections().length;
    $('open-review').textContent=`İnceleme penceresini aç (${rows.length} kayıt)`;
    const remaining=rows.filter(r=>scoringCandidate(r)&&!included(r)&&r.status!=='rejected');
    const batch=readyReviewBatch(),ready=batch.ready.length,waiting=batch.waiting+batch.invalid.length;
    $('approve-all-review').disabled=ready===0;
    $('approve-all-review').textContent=`Ön onaylıları hesaplamaya dahil et (${ready})`;
    $('preapprove-all-review').disabled=!rows.some(r=>!included(r)&&r.status!=='rejected');
    $('review-bulk-hint').textContent=ready?`${ready} ön onaylı ve eksiksiz kayıt hesaplamaya alınabilir.${waiting?` ${waiting} eksik bilgili veya ön onay bekleyen kayıt dahil edilmeyecek; incelemede kalacak.`:''}`:remaining.length?`${waiting} kaydın bilgilerini tamamlayıp ön onay verin. Eksiksiz ve ön onaylı en az bir kayıt olduğunda hesaplayabilirsiniz.`:'Hesaplamaya eklenecek yeni puanlanabilir kayıt yok.';
    $('review-bulk-error').hidden=true;$('review-bulk-result').hidden=true;
    const groups=new Map();
    for(const row of rows){const label=row.sectionLabel||row.kind||'Diğer';if(!groups.has(label))groups.set(label,[]);groups.get(label).push(row);}
    for(const [label,group] of groups){
      const heading=document.createElement('h3');heading.className='review-group-heading';heading.textContent=`${label} (${group.length})`;container.append(heading);
      for(const row of group) {
        const card=document.createElement('article');card.className='yok-record';card.dataset.reviewKey=row.key;
        const added=included(row),status=added?'included':row.status||'pending',d=row.draft||{},canScore=scoringCandidate(row);
        const labels={pending:'İnceleme bekliyor · puana dahil değil',preapproved:canScore?'Ön onaylı · puana dahil değil':'Bilgi olarak onaylandı · puanlanmaz',rejected:'Hariç tutuldu · puana dahil değil',included:'Hesaplamaya eklendi'};
        const options=E.ACTIVITIES.filter(a=>reviewCategories(row).includes(a.category));
        card.innerHTML=`<span class="review-badge" data-status="${status}">${labels[status]}</span><h3>${escapeHTML(row.title)}</h3>
          <p>${escapeHTML(row.researcher)} · ${escapeHTML(row.kind)} · ${row.year||'Yıl belirsiz'}</p>
          <details><summary>Kaynak künyesini incele</summary><p>${escapeHTML(row.metadata)}</p>${row.source?`<a href="${escapeHTML(row.source)}" target="_blank" rel="noopener noreferrer">YÖK kaydını aç ↗</a>`:''}</details>
          ${!canScore?`<p class="review-info">${escapeHTML(infoReason(row))}</p>`:''}
          ${(row.importNotes||[]).length?`<p class="review-info">${row.importNotes.map(escapeHTML).join(' ')}</p>`:''}
          ${row.dateWarning&&canScore?`<p class="review-warning">${escapeHTML(row.dateWarning)}</p>`:''}
          <fieldset ${status!=='pending'?'disabled':''}><legend>İnceleme ve doğrulama</legend>
          ${canScore?`<div class="profile-grid">
          <label class="field-block">Faaliyet türü (öneriyi doğrulayın)<select data-field="activityId"><option value="">Faaliyet seçin</option>${options.map(a=>`<option value="${a.id}" ${a.id===d.activityId?'selected':''}>${escapeHTML(a.id+' '+a.label)}</option>`).join('')}</select></label>
          <label class="field-block" data-for-modes="authors quartile chapter shared">Toplam yazar / kişi sayısı<input data-field="people" type="number" min="1" max="10000" value="${escapeHTML(d.people)}" placeholder="Doğrulayın"></label>
          <label class="field-block" data-for-modes="quartile">Yayın yılındaki Q dilimi<select data-field="quartile"><option value="">Seçin</option>${Object.keys(E.QUARTILE).map(q=>`<option ${q===d.quartile?'selected':''}>${q}</option>`).join('')}</select></label>
          <label class="field-block" data-for-modes="chapter">Kitap adı / ISBN<input data-field="bookTitle" maxlength="250" value="${escapeHTML(d.bookTitle)}"></label>
          <label class="field-block" data-for-modes="project long-project">Projedeki göreviniz<select data-field="role"><option value="">Görevinizi doğrulayın</option><option value="leader" ${d.role==='leader'?'selected':''}>Yürütücü</option><option value="researcher" ${d.role==='researcher'?'selected':''}>Araştırmacı / bursiyer</option></select></label>
          <label class="field-block" data-for-modes="long-project">Destek süresi (ay)<input data-field="projectMonths" type="number" min="9" max="240" value="${escapeHTML(d.projectMonths)}"></label>
          </div>${row.year!==activityYear?`<label class="review-check"><input type="checkbox" data-field="yearConfirmed" ${d.yearConfirmed?'checked':''}> Kaynaktan doğruladım: faaliyet/tamamlanma/tescil yılı ${activityYear}.</label>`:''}`:''}
          <label class="review-check"><input type="checkbox" data-field="confirmed" ${d.confirmed?'checked':''}> ${canScore?'Doğru kişiye ait kaydı ve teşvik uygunluğunu doğruladım. Projelerde sonuçlanma ve destek koşullarını, patentlerde tescili, bildirilerde sözlü sunum ve tam metin koşullarını kontrol ettim.':'Bu profil bilgisini inceledim; hesaplamaya puan olarak eklenmeyeceğini biliyorum.'}</label></fieldset>
          ${canScore?'<p class="review-draft-score" data-score-preview></p>':''}
          <div class="review-actions">${status==='pending'?'<button type="button" class="secondary-button" data-action="preapprove">İnceledim, ön onay ver</button><button type="button" class="secondary-button" data-action="reject">Hariç tut</button>':''}
          ${['preapproved','rejected'].includes(status)?'<button type="button" class="secondary-button" data-action="reopen">Yeniden incele</button>':''}</div><p data-message role="status"></p>`;
        function refreshFields(){
          const mode=E.BY_ID[row.draft?.activityId]?.mode;
          card.querySelectorAll('[data-for-modes]').forEach(el=>el.hidden=mode?!el.dataset.forModes.split(' ').includes(mode):false);
          const preview=card.querySelector('[data-score-preview]');
          if(preview){try{const entry=reviewEntry({...row,draft:{...row.draft,confirmed:true}});const result=E.entryBreakdown(entry,state.field);preview.textContent=`Taslak puan: ${tr(result.score)} · ${added?'Hesaplama listesinde.':'Henüz hesaplamaya dahil değil.'} Toplamda kategori sınırları uygulanır.`;}catch{preview.textContent='Taslak puanı görmek için gerekli faaliyet bilgilerini tamamlayın.';}}
        }
        card.addEventListener('input',ev=>{
          const f=ev.target.dataset.field;if(!f)return;
          row.draft={...row.draft,[f]:ev.target.type==='checkbox'?ev.target.checked:ev.target.value};
          row.status='pending';row.reviewedAt='';save();refreshFields();
        });
        card.addEventListener('click',ev=>{
          const action=ev.target.closest('[data-action]')?.dataset.action;if(!action)return;
          try{
            if(action==='preapprove') {if(canScore)reviewEntry(row);else if(!row.draft?.confirmed)throw Error('İnceleme doğrulamasını işaretleyin.');row.status='preapproved';row.reviewedAt=new Date().toISOString();}
            if(action==='reject'){row.status='rejected';row.reviewedAt='';}
            if(action==='reopen'){row.status='pending';row.reviewedAt='';row.draft={...row.draft,confirmed:false,yearConfirmed:false};}
            changed(false);
          }catch(err){card.querySelector('[data-message]').textContent=err.message;}
        });refreshFields();container.append(card);
      }
    }
    enhanceNumberInputs();
  }

  function openReview() {renderReview();if(!$('review-dialog').open)$('review-dialog').showModal();}

  function preapproveAllReview() {
    const messages=new Map();let approved=0;
    for(const row of reviewRows()) {
      if(row.status==='rejected'||state.entries.some(e=>e.id===`yok-${row.key}`))continue;
      // One bulk action replaces repeated consent clicks; unknown years still need explicit verification.
      const draft={...row.draft,confirmed:true};
      try {
        if(scoringCandidate(row))reviewEntry({...row,draft});
        row.draft=draft;row.status='preapproved';row.reviewedAt=new Date().toISOString();approved++;
      }catch(err){row.status='pending';messages.set(row.key,err.message);}
    }
    save();renderReview();
    for(const card of $('yok-preview').querySelectorAll('[data-review-key]'))if(messages.has(card.dataset.reviewKey))card.querySelector('[data-message]').textContent=messages.get(card.dataset.reviewKey);
    const notice=$('review-bulk-error');notice.hidden=false;
    notice.textContent=`${approved} kayda ön onay verildi; puan değişmedi.${messages.size?` ${messages.size} kayıtta eksik bilgi var; işaretlenen alanları tamamlayın ve tekrar onaylayın.`:' Puanlanabilir kayıtları dahil etmek için aşağıdaki hesaplama düğmesine basın.'}`;
  }

  function approveAllReview() {
    const error=$('review-bulk-error');error.hidden=true;
    try {
      const batch=readyReviewBatch();
      if(!batch.ready.length)throw Error('Ön onaylı ve eksiksiz kayıt bulunamadı. Eksik alanları tamamlayıp ön onay verin.');
      const entries=batch.ready.map(item=>item.entry);
      // Only the validated, explicitly preapproved subset can enter the calculator.
      const calculation=E.calculate({...state,entries:[...state.entries,...entries]});
      state.entries.push(...entries);
      for(const item of batch.ready)item.row.status='pending';
      for(const item of batch.invalid){item.row.status='pending';item.row.reviewedAt='';item.row.draft={...item.row.draft,confirmed:false};}
      changed(false);
      for(const item of batch.invalid){
        const card=[...$('yok-preview').querySelectorAll('[data-review-key]')].find(c=>c.dataset.reviewKey===item.row.key);
        if(card)card.querySelector('[data-message]').textContent=item.message;
      }
      const remaining=batch.waiting+batch.invalid.length;
      const message=`${entries.length} ön onaylı kayıt hesaplamaya eklendi. Toplam puan: ${tr(calculation.total)}.${remaining?` ${remaining} eksik bilgili veya ön onaysız kayıt eklenmedi; incelemede bırakıldı.`:''}`;
      const result=$('review-bulk-result');result.textContent=message;result.hidden=false;
      toast(message);
      if(!remaining){$('review-dialog').close();$('score-total').scrollIntoView({behavior:'smooth',block:'center'});}
    }catch(err){error.textContent=err.message;error.hidden=false;}
  }

  async function yokRequest(path,body,signal=null) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),300000);
    const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    try{
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      if(response.status===413)throw Error('İstek 4 MB sınırını aşıyor. HTML dosyalarını daha küçük gruplar halinde yükleyin.');
      if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Aktarım sunucusu bulunamadı. Uygulamayı python server.py ile başlatın.');
      const data=await response.json();if(!response.ok)throw Error(data.error||'İstek başarısız.');return data;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }

  function acceptProfileData(data,year) {
        const responseOwner=personId(data.identity?.source);
        if(responseOwner&&responseOwner!==activePersonId)throw Error('Dönen yanıt başka bir kişiye ait; aktarılmadı.');
        if(data.records.some(r=>(personId(r.source)&&personId(r.source)!==activePersonId)||(personId(r.ownerId)&&personId(r.ownerId)!==activePersonId)))throw Error('Yanıt başka bir kişinin kayıtlarını içeriyor; aktarılmadı.');
        state.review=reviewRows();state.personId=activePersonId;let added=0;
        for(const row of data.records.filter(allowedImportRow)){
          const aliases=[row.key,row.legacyKey,...(row.legacyKeys||[])].filter(Boolean);
          const existing=state.review.find(r=>aliases.includes(r.key));
          if(existing){
            const {key,status,draft,reviewedAt}=existing;
            Object.assign(existing,row,{key,status,draft,reviewedAt,ownerId:activePersonId,researcher:data.name});continue;
          }
          const linked=state.entries.find(e=>aliases.some(key=>e.id===`yok-${key}`));
          if(state.review.length>=5000)throw Error('İnceleme listesi 5000 kayıt sınırına ulaştı.');
          state.review.push({...row,ownerId:activePersonId,key:linked?linked.id.slice(4):row.key,researcher:data.name,status:'pending',draft:{...row.suggestedDraft}});added++;
        }
        const sameProfile=state.importIdentity?.source===data.identity?.source&&state.importIdentity?.name===data.name;
        const previous=state.sourceSections||[];
        state.sourceSections=(data.sections||[]).filter(section=>IMPORT_SECTIONS.has(section.id)).map(section=>{
          if(data.origin!=='saved-html'||!sameProfile)return section;
          const old=previous.find(s=>s.id===section.id);
          if(old?.pages&&section.error==='Bu bölüm için HTML sayfası yüklenmedi.')return old;
          if(old?.pages&&section.pages)return {...section,count:state.review.filter(r=>r.section===section.id&&r.researcher===data.name).length,rawText:(old.rawText+'\n'+section.rawText).slice(0,60000)};
          return section;
        });state.importIdentity={name:data.name,source:data.identity?.source||personSource(activePersonId)};delete state.sourceProfile;
        save();renderReview();if(state.review.length||state.sourceSections.length)openReview();
        $('yok-status').textContent=`${data.name} · ${year} · ${data.records.filter(allowedImportRow).length} kayıt bulundu, ${added} yeni kayıt incelemeye alındı.${data.partial?' Aktarım kısmen tamamlandı.':''} ${data.warnings.join(' ')}`;
  }

  function setupSavedYok() {
    const types=[['article','MAKALE'],['conference','BİLDİRİ'],['book','KİTAP'],['project','PROJELER'],['award','ÖDÜLLER']];
    let files=[];
    resetSavedYok=()=>{files=[];savedYokCount=0;$('yok-html-files').value='';$('yok-html-mapping').replaceChildren();$('yok-html-import').disabled=true;$('yok-html-status').textContent='';};
    $('yok-html-files').addEventListener('change',()=>{
      files=[...$('yok-html-files').files];savedYokCount=files.length;$('yok-html-mapping').replaceChildren();
      $('yok-html-import').disabled=!files.length;
      files.forEach((file,index)=>{
        const label=document.createElement('label');label.className='field-block';
        const name=document.createElement('span');name.textContent=file.name;
        const select=document.createElement('select');select.dataset.fileIndex=index;
        select.innerHTML='<option value="">Bu dosyanın bölümünü seçin</option>'+types.map(([id,text])=>`<option value="${id}">${text}</option>`).join('');
        label.append(name,select);$('yok-html-mapping').append(label);
      });
    });
    $('yok-html-import').addEventListener('click',async()=>{
      const status=$('yok-html-status'),button=$('yok-html-import');
      let context;try{context=beginImport();}catch(err){status.textContent=err.message;return;}
      const year=context.year,name=$('yok-name').value.trim(),selectedFiles=[...files];
      button.disabled=true;$('activity-year').disabled=true;$('yok-fetch').disabled=true;
      status.textContent='Kaydedilmiş sayfalar okunuyor…';
      try{
        if(!selectedFiles.length||selectedFiles.length>40)throw Error('1–40 HTML dosyası seçin.');
        if(selectedFiles.reduce((sum,file)=>sum+file.size,0)>3*1024*1024)throw Error('HTML dosyalarının toplamı 3 MB sınırını aşıyor. Daha küçük gruplar halinde yükleyin.');
        const pages=[];
        for(let index=0;index<selectedFiles.length;index++){
          const section=$('yok-html-mapping').querySelector(`[data-file-index="${index}"]`).value;
          if(!section)throw Error(`${selectedFiles[index].name}: dosyanın bölümünü seçin.`);
          const bytes=await selectedFiles[index].arrayBuffer(),head=new TextDecoder().decode(bytes.slice(0,8192));
          const encoding=head.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||'utf-8';
          let content;try{content=new TextDecoder(encoding).decode(bytes);}catch{content=new TextDecoder().decode(bytes);}
          pages.push({section,content});
        }
        const data=await yokRequest('/api/yok/import-html',{year,researcherId:context.researcherId,name,pages},context.controller.signal);
        if(!isCurrentImport(context))return;
        acceptProfileData(data,year);status.textContent='HTML kayıtları inceleme penceresine alındı. Canlı YÖK kontrolü yapılmadı.';
      }catch(err){if(isCurrentImport(context))status.textContent=err.message;}
      finally{if(isCurrentImport(context)){activeImportController=null;refreshImportControls();}}
    });
  }

  let summaryController=null,summarySequence=0;
  function clearPublicationSummary() {
    summarySequence++;summaryController?.abort();summaryController=null;
    $('publication-summary').hidden=true;$('publication-summary').setAttribute('aria-busy','false');
  }
  async function loadPublicationSummary(researcherId,refresh=false) {
    const id=String(researcherId||'').trim();if(!id){clearPublicationSummary();return;}
    const sequence=++summarySequence;summaryController?.abort();
    const controller=new AbortController();summaryController=controller;
    const panel=$('publication-summary');panel.hidden=false;panel.setAttribute('aria-busy','true');
    $('publication-summary-title').textContent='İndeksli yayınlar';
    $('publication-summary-status').textContent='Yayın özeti yükleniyor…';
    $('publication-summary-note').textContent='Tüm yıllar · Makale, bildiri ve kitap · Hesaplama puanını değiştirmez.';
    for(const index of ['SSCI','SCI','AHCI','SCOPUS'])$(`index-count-${index}`).textContent='—';
    $('refresh-publication-summary').disabled=true;
    const timer=setTimeout(()=>controller.abort(),65000);
    try {
      const response=await fetch('/api/yok/publication-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({researcherId:id,refresh}),signal:controller.signal});
      if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Yayın özeti sunucusuna erişilemedi.');
      const data=await response.json();if(!response.ok)throw Error(data.error||'Yayın özeti alınamadı.');
      if(sequence!==summarySequence)return;
      for(const index of ['SSCI','SCI','AHCI','SCOPUS']){
        const count=data.counts?.[index];if(!Number.isInteger(count)||count<0)throw Error('Yayın özeti sayıları doğrulanamadı.');
      }
      $('publication-summary-title').textContent=`${data.name} · İndeksli yayınlar`;
      for(const index of ['SSCI','SCI','AHCI','SCOPUS'])$(`index-count-${index}`).textContent=tr(data.counts[index],0);
      $('publication-summary-status').textContent=`${data.totalPublications} yayın incelendi · ${data.typeCounts?.article??'—'} makale · ${data.typeCounts?.conference??'—'} bildiri · ${data.typeCounts?.book??'—'} kitap/bölüm.${data.partial?' Özet kısmen tamamlandı; sayılar eksik olabilir.':''}`;
      $('publication-summary-note').textContent=[data.note,`${data.otherOrUnspecified} yayında bu dört indeksten biri açıkça belirtilmiyor.`,...(data.warnings||[])].filter(Boolean).join(' ');
    } catch(err) {
      if(sequence!==summarySequence)return;
      $('publication-summary-status').textContent=err.name==='AbortError'?'Yayın özeti zaman aşımına uğradı. Yenile ile tekrar deneyin.':err.message;
      for(const index of ['SSCI','SCI','AHCI','SCOPUS'])$(`index-count-${index}`).textContent='—';
    } finally {
      clearTimeout(timer);
      if(sequence===summarySequence){panel.setAttribute('aria-busy','false');$('refresh-publication-summary').disabled=false;}
    }
  }

  function setupYok() {
    setupSavedYok();
    $('refresh-publication-summary').addEventListener('click',()=>loadPublicationSummary($('yok-id').value,true));
    $('yok-id').addEventListener('input',()=>{suspendReview();clearPublicationSummary();});
    $('yok-id').addEventListener('change',()=>{if(selectPerson($('yok-id').value))loadPublicationSummary($('yok-id').value);});
    const yearSelect=$('activity-year');
    $('open-review').addEventListener('click',openReview);
    $('close-review').addEventListener('click',()=>$('review-dialog').close());
    $('review-later').addEventListener('click',()=>$('review-dialog').close());
    $('preapprove-all-review').addEventListener('click',preapproveAllReview);
    $('approve-all-review').addEventListener('click',approveAllReview);
    for(let y=new Date().getFullYear();y>=2000;y--) yearSelect.add(new Option(y,y));
    yearSelect.value=activityYear;renderReview();
    yearSelect.addEventListener('change',()=>{
      if($('add-dialog').open)$('add-dialog').close();
      if($('review-dialog').open)$('review-dialog').close();
      cancelImport();save();activityYear=Number(yearSelect.value);localStorage.setItem('tesvik-selected-year',activityYear);
      KEY=personStorageKey(activityYear,activePersonId);
      if(activePersonId)loadPersonYear();else {state={...E.DEFAULTS,entries:[],review:[]};readLocal();}
      setupProfileValues();changed(true);renderReview();
      $('yok-status').textContent=`${activityYear} faaliyetleri gösteriliyor.`;
    });
    $('yok-search').addEventListener('click',async()=>{
      const button=$('yok-search');button.disabled=true;$('yok-candidates').replaceChildren();suspendReview();$('yok-id').value='';clearPublicationSummary();
      $('yok-search-status').textContent='Ad ve soyad YÖK Akademik üzerinde aranıyor…';
      try{
        const revision=importRevision;
        const data=await yokRequest('/api/yok/search',{name:$('yok-name').value.trim(),source:'modern'});
        if(revision!==importRevision)return;
        $('yok-search-status').textContent=`${data.candidates.length} aday bulundu. ${data.warnings.join(' ')}`;
        for(const person of data.candidates){
          const card=document.createElement('article');card.className='yok-record';
          const name=document.createElement('h3');name.textContent=person.name;
          const info=document.createElement('p');info.textContent=person.affiliation;
          const select=document.createElement('button');select.type='button';select.className='secondary-button';select.textContent='Bu profili seç';
          select.addEventListener('click',()=>{selectPerson(person.url);$('yok-id').value=person.url;$('yok-search-status').textContent=`Seçilen profil: ${person.name}. Faaliyet yılını seçip beş faaliyet türünü getirebilirsiniz.`;loadPublicationSummary(person.url);});
          card.append(name,info,select);$('yok-candidates').append(card);
        }
      }catch(err){$('yok-search-status').textContent=err.name==='AbortError'?'Arama zaman aşımına uğradı.':err.message;}
      finally{button.disabled=false;}
    });
    $('yok-fetch').addEventListener('click',async()=>{
      const button=$('yok-fetch');let context;
      try{context=beginImport();}catch(err){$('yok-status').textContent=err.message;return;}
      button.disabled=true;yearSelect.disabled=true;$('yok-html-import').disabled=true;
      $('yok-status').textContent='Seçilen kişinin makale, bildiri, kitap, proje ve ödül kayıtları okunuyor…';
      try{
        const data=await yokRequest('/api/yok/import',{researcherId:context.researcherId,year:context.year,scope:'profile',source:'modern'},context.controller.signal);
        if(!isCurrentImport(context))return;
        acceptProfileData(data,context.year);
      }catch(err){if(isCurrentImport(context))$('yok-status').textContent=err.name==='AbortError'?'YÖK isteği iptal edildi veya zaman aşımına uğradı.':err.message;}
      finally{if(isCurrentImport(context)){activeImportController=null;refreshImportControls();}}
    });
  }

  function init() {
    migrateImportScope();readLocal();const restored=activePersonId||inferredPerson(state);if(restored)selectPerson(restored,false);setupProfile();setupNav();setupSearch();renderSections();setupModal();setupHistory();setupTransfer();renderResults();setupYok();setupNumberControls();
  }
  init();
})();
