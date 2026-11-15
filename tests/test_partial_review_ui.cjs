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
 const state=()=>JSON.parse(w.localStorage.getItem(storageKey));
 const card=key=>d.querySelector(`[data-review-key="${key}"]`);
 const apply=()=>d.getElementById('approve-all-review');
 function set(key,field,value){const el=card(key).querySelector(`[data-field="${field}"]`);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));}
 d.getElementById('yok-fetch').click();await tick();
 set('article','activityId','3.5');set('article','people','1');set('article','confirmed',true);card('article').querySelector('[data-action="preapprove"]').click();
 // A complete draft is still excluded until it has explicit preapproval.
 set('book','activityId','3.10');set('book','people','1');
 set('conference','activityId','8.1');
 assert.ok(!apply().disabled);assert.match(d.getElementById('review-bulk-hint').textContent,/3 eksik bilgili veya ön onay/);
 apply().click();assert.equal(state().entries.length,1);assert.equal(state().entries[0].id,'yok-article');
 assert.equal(state().review.find(r=>r.key==='book').status,'pending');assert.equal(state().review.find(r=>r.key==='book').draft.people,'1');
 assert.equal(state().review.find(r=>r.key==='conference').draft.people,undefined);
 assert.ok(d.getElementById('review-dialog').open);assert.match(d.getElementById('review-bulk-result').textContent,/Toplam puan/);
 assert.ok(apply().disabled,'Eksiksiz ama ön onaysız taslak kendiliğinden eklenmemeli');
 let saved=w.localStorage.getItem(storageKey);dom.window.close();dom=create(saved);w=dom.window;d=w.document;
 d.getElementById('open-review').click();assert.equal(state().entries.length,1);assert.equal(state().review.length,4);
 set('book','confirmed',true);card('book').querySelector('[data-action="preapprove"]').click();apply().click();
 assert.equal(state().entries.length,2);assert.ok(d.getElementById('review-dialog').open);
 d.getElementById('preapprove-all-review').click();assert.equal(state().entries.length,2);assert.ok(apply().disabled);
 assert.match(card('conference').querySelector('[data-message]').textContent,/kişi sayısını/);
 set('conference','people','2');set('conference','confirmed',true);card('conference').querySelector('[data-action="preapprove"]').click();apply().click();
 assert.equal(state().entries.length,3);assert.equal(new Set(state().entries.map(e=>e.id)).size,3);
 assert.equal(state().review.find(r=>r.key==='unknown').status,'pending');assert.ok(d.getElementById('review-dialog').open);
 assert.match(d.getElementById('review-bulk-result').textContent,/1 eksik bilgili veya ön onaysız/);
 d.getElementById('review-later').click();assert.equal(state().entries.length,3);
 dom.window.close();console.log('Partial review passed: ready subset calculates, complete unapproved drafts and missing data stay pending, reload preserves both, later additions do not duplicate.');
})().catch(e=>{console.error(e);process.exitCode=1;});
