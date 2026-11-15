/* Offline DOM integration test. Install jsdom in a temporary directory, then:
   JSDOM_PATH=/path/to/node_modules/jsdom node tests/test_ui.cjs
   Synthetic API responses do not verify live YÖK access. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const engine=fs.readFileSync(path.join(root,'engine.js'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const source='https://akademik.yok.gov.tr/AkademikArama/AkademisyenGorevOgrenimBilgileri?authorId=ABC';
const rows=[
 {key:'article',title:'Örnek makale',year:2025,kind:'Makale'},
 {key:'book',title:'Örnek kitap',year:2025,kind:'Kitap'},
 {key:'conference',title:'Örnek bildiri',year:2025,kind:'Bildiri'},
 {key:'unknown',title:'Yılı belirsiz kitap bölümü',year:null,kind:'Kitap',dateWarning:'Yılı doğrulayın.'}
].map(r=>({...r,source,requestedYear:2025,metadata:'Sentetik test künyesi'}));
const storageKey='akademik-tesvik-year-2025-v2-person-ABC';
let failed=false;
function create(saved){
 const dom=new JSDOM(html,{url:'http://localhost:8000',runScripts:'outside-only'});
 const w=dom.window;
 w.localStorage.setItem('tesvik-selected-year','2025');
 w.localStorage.setItem('tesvik-selected-person','ABC');
 if(saved)w.localStorage.setItem(storageKey,saved);
 w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.fetch=async(url,options)=>({ok:!failed,headers:{get:()=> 'application/json'},json:async()=>failed?{error:'HTTP 403'}:url.includes('/search')?{candidates:[{name:'Örnek Akademisyen',affiliation:'Örnek Üniversitesi',url:source}],warnings:[]}:{name:'Örnek Akademisyen',year:2025,records:rows,warnings:[]}});
 w.eval(engine);w.eval(app);return dom;
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
(async()=>{
 let dom=create(),w=dom.window,d=w.document;
 const getState=()=>JSON.parse(w.localStorage.getItem(storageKey));
 const score=()=>d.getElementById('score-total').textContent;
 const popup=()=>d.getElementById('review-dialog');
 const bulk=()=>d.getElementById('approve-all-review');
 const cards=()=>rows.map(row=>d.querySelector(`[data-review-key="${row.key}"]`)).filter(Boolean);
 function set(card,field,value){const el=card.querySelector(`[data-field="${field}"]`);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));}
 function click(card,action){card.querySelector(`[data-action="${action}"]`).click();}
 d.getElementById('yok-name').value='Örnek Akademisyen';d.getElementById('yok-search').click();await tick();
 assert.equal(d.querySelectorAll('#yok-candidates article').length,1);
 d.querySelector('#yok-candidates button').click();assert.equal(d.getElementById('yok-id').value,source);
 d.getElementById('yok-fetch').click();await tick();
 assert.ok(popup().open,'Getirme sonrası inceleme popupı açılmalı');
 assert.ok(popup().contains(d.getElementById('yok-preview')),'Kayıtlar popup içinde olmalı');
 assert.equal(cards().length,4);assert.equal(getState().entries.length,0);assert.equal(score(),'0,00');assert.ok(bulk().disabled);
 click(cards()[0],'preapprove');assert.match(cards()[0].querySelector('[data-message]').textContent,/doğrulamasını/);
 set(cards()[0],'activityId','3.1');set(cards()[0],'people','2');set(cards()[0],'quartile','Q2');set(cards()[0],'confirmed',true);
 click(cards()[0],'preapprove');assert.equal(getState().review[0].status,'preapproved');assert.equal(score(),'0,00');
 assert.equal(d.querySelectorAll('[data-action="apply"]').length,0,'Tekli hesaplamaya ekleme olmamalı');
 assert.ok(!bulk().disabled,'Ön onaylı kayıtlar diğerleri beklerken hesaplanabilmeli');
 // Close and reopen must never award points, and drafts must survive reload.
 d.getElementById('review-later').click();assert.ok(!popup().open);assert.equal(score(),'0,00');
 let saved=w.localStorage.getItem(storageKey);dom.window.close();dom=create(saved);w=dom.window;d=w.document;
 assert.ok(!popup().open);d.getElementById('open-review').click();assert.ok(popup().open);
 assert.match(cards()[0].querySelector('.review-badge').textContent,/Ön onaylı/);assert.equal(score(),'0,00');
 click(cards()[1],'reject');assert.equal(getState().review[1].status,'rejected');
 click(cards()[1],'reopen');set(cards()[1],'activityId','3.10');set(cards()[1],'people','1');set(cards()[1],'confirmed',true);click(cards()[1],'preapprove');
 assert.ok([...cards()[2].querySelector('[data-field="activityId"]').options].some(o=>o.value==='8.1'));
 set(cards()[2],'activityId','8.1');set(cards()[2],'people','3');set(cards()[2],'confirmed',true);click(cards()[2],'preapprove');
 click(cards()[3],'reject');assert.ok(!bulk().disabled);assert.equal(getState().entries.length,0);assert.equal(score(),'0,00');
 // Invalid restored preapprovals are skipped; valid preapprovals are calculated.
 saved=getState();saved.review[1].draft.people='0';dom.window.close();dom=create(JSON.stringify(saved));w=dom.window;d=w.document;
 d.getElementById('open-review').click();bulk().click();
 assert.equal(getState().entries.length,2,'Eksik kitap atlanmalı; ön onaylı makale ve bildiri eklenmeli');assert.notEqual(score(),'0,00');assert.ok(popup().open);
 assert.equal(getState().review[1].status,'pending');assert.ok(bulk().disabled);
 assert.match(d.getElementById('review-bulk-result').textContent,/incelemede bırakıldı/);
 assert.match(cards()[1].querySelector('[data-message]').textContent,/kişi sayısını/);
 set(cards()[1],'people','1');set(cards()[1],'confirmed',true);click(cards()[1],'preapprove');
 bulk().click();assert.equal(getState().entries.length,3);assert.notEqual(score(),'0,00');assert.ok(!popup().open,'Başarılı toplu onay sonrası popup kapanmalı');
 assert.equal(getState().review[3].status,'rejected');assert.ok(bulk().disabled);
 // Re-fetch must reopen popup without duplicates or changes to totals.
 const before=score();d.getElementById('yok-id').value=source;d.getElementById('yok-fetch').click();await tick();
 assert.ok(popup().open);assert.equal(cards().length,4);assert.equal(getState().entries.length,3);assert.equal(score(),before);
 click(cards()[3],'reopen');set(cards()[3],'activityId','3.12');set(cards()[3],'people','1');set(cards()[3],'confirmed',true);
 click(cards()[3],'preapprove');assert.match(cards()[3].querySelector('[data-message]').textContent,/yılını/);
 set(cards()[3],'yearConfirmed',true);click(cards()[3],'preapprove');assert.match(cards()[3].querySelector('[data-message]').textContent,/kitap adını/);
 set(cards()[3],'bookTitle','Örnek kitap / ISBN');click(cards()[3],'preapprove');assert.equal(getState().entries.length,3);
 bulk().click();assert.equal(getState().entries.length,4);assert.ok(!popup().open);
 failed=true;d.getElementById('yok-fetch').click();await tick();assert.match(d.getElementById('yok-status').textContent,/403/);assert.equal(cards().length,4);
 d.getElementById('open-review').click();d.getElementById('close-review').click();assert.ok(!popup().open);
 const year=d.getElementById('activity-year');d.getElementById('open-review').click();
 year.value='2024';year.dispatchEvent(new w.Event('change'));assert.ok(!popup().open);assert.equal(cards().length,0);assert.equal(score(),'0,00');
 year.value='2025';year.dispatchEvent(new w.Event('change'));assert.equal(cards().length,4);assert.equal(getState().entries.length,4);
 d.querySelector('[data-remove="yok-article"]').click();assert.equal(getState().entries.length,3);assert.ok(cards()[0].querySelector('[data-action="preapprove"]'));
 dom.window.close();console.log('Popup DOM tests passed: auto-open, close/reopen, persistence, review isolation, valid preapproval subset and skipped invalid records, excluded records, no duplicates, unknown year, chapter, conference, errors, year separation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
