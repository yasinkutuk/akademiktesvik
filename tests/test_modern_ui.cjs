/* JSDOM_PATH=/path/to/jsdom LIVE_IMPORT_PATH=/path/to/download.json node tests/test_modern_ui.cjs */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const root=path.resolve(__dirname,'..');
const source='https://akademik.yok.gov.tr/academician-details?authorGuidId=598E2C85E193D914';
const data=process.env.LIVE_IMPORT_PATH?JSON.parse(fs.readFileSync(process.env.LIVE_IMPORT_PATH,'utf8')):{
 name:'Örnek Akademisyen',year:2025,origin:'modern-api',warnings:[],profile:{name:'Örnek Akademisyen',source,text:'Profil bilgileri'},
 sections:[{id:'article',label:'Makaleler',status:'loaded',count:1,pages:1,source,rawText:'Örnek kaynak'}],
 records:[{key:'article',title:'Örnek makale',section:'article',sectionLabel:'Makaleler',kind:'Makaleler',year:2025,source,metadata:'SSCI',suggestedDraft:{activityId:'3.1',people:'1',quartile:'Q2'}},
 {key:'summary',title:'Özet bildiri',section:'conference',sectionLabel:'Bildiriler',kind:'Bildiriler',year:2025,source,metadata:'Özet bildiri',scoreExclusion:'Kaynak özet bildiri; puanlanmaz.'},
 {key:'course',title:'Ders',section:'course',sectionLabel:'Dersler',kind:'Dersler',year:2025,source,metadata:'Ders'}]
};
const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:8000',runScripts:'outside-only'});
const w=dom.window,d=w.document;
w.localStorage.setItem('tesvik-selected-year','2025');w.localStorage.setItem('tesvik-selected-person','598E2C85E193D914');
w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
w.HTMLElement.prototype.scrollIntoView=function(){};
w.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.source,'modern');return {ok:true,headers:{get:()=> 'application/json'},json:async()=>data};};
w.eval(fs.readFileSync(path.join(root,'engine.js'),'utf8'));w.eval(fs.readFileSync(path.join(root,'app.js'),'utf8'));
const tick=()=>new Promise(r=>setTimeout(r,0));
const state=()=>JSON.parse(w.localStorage.getItem('akademik-tesvik-year-2025-v2-person-598E2C85E193D914'));
(async()=>{
 d.getElementById('yok-id').value=source;d.getElementById('yok-fetch').click();await tick();
 assert.ok(d.getElementById('review-dialog').open);assert.equal(d.querySelectorAll('#yok-preview article').length,data.records.filter(r=>['article','conference','book','project','award'].includes(r.section)).length);
 assert.equal(d.getElementById('score-total').textContent,'0,00');assert.equal(state().entries.length,0);
 assert.equal(state().sourceProfile,undefined);assert.ok(state().review.every(r=>r.source===source));
 const first=data.records.find(r=>r.section==='article'&&r.year===2025&&r.suggestedDraft?.quartile==='Q2');
 assert.ok(first);const card=d.querySelector(`[data-review-key="${first.key}"]`);
 assert.equal(card.querySelector('[data-field="quartile"]').value,'Q2');assert.equal(card.querySelector('[data-field="people"]').value,first.suggestedDraft.people);
 for(const row of data.records.filter(r=>!['article','conference','book','project','award'].includes(r.section))){
   assert.equal(d.querySelector(`[data-review-key="${row.key}"]`),null);
 }
 for(const row of data.records.filter(r=>r.scoreExclusion&&['article','conference','book','project','award'].includes(r.section))){
   assert.equal(d.querySelector(`[data-review-key="${row.key}"] [data-field="activityId"]`),null,'Bilgi/uygun olmayan kayıtlar puanlanmamalı');
 }
 d.getElementById('preapprove-all-review').click();assert.equal(state().entries.length,0);assert.equal(d.getElementById('score-total').textContent,'0,00');
 // In this local test, exclude unresolved activity classifications, then explicitly apply the rest.
 const unresolved=[...d.querySelectorAll('[data-review-key]')].filter(c=>c.querySelector('[data-message]')?.textContent);
 for(const oldCard of unresolved){const key=oldCard.dataset.reviewKey;d.querySelector(`[data-review-key="${key}"] [data-action="reject"]`)?.click();}
 const apply=d.getElementById('approve-all-review');assert.ok(!apply.disabled);apply.click();
 assert.ok(state().entries.length>0);assert.notEqual(d.getElementById('score-total').textContent,'0,00');
 const excludedKeys=new Set(data.records.filter(r=>r.scoreExclusion||['course','education','employment','membership','administration','thesis','referee'].includes(r.section)||r.year!==2025).map(r=>'yok-'+r.key));
 assert.ok(state().entries.every(e=>!excludedKeys.has(e.id)));
 const before=state().entries.length;d.getElementById('yok-fetch').click();await tick();assert.equal(state().entries.length,before);assert.equal(state().review.length,data.records.filter(r=>['article','conference','book','project','award'].includes(r.section)).length);
 const restored=w.IncentiveEngine.cleanImport(state());assert.ok(restored.review.every(r=>r.source===source));
 assert.ok(restored.review.filter(r=>data.records.find(x=>x.key===r.key)?.scoreExclusion).every(r=>r.scoreExclusion));
 console.log(`Modern UI passed with ${data.records.length} records: new URL, draft enrichment, no auto-score, summary/info exclusion, explicit batch commit, reload and duplicate protection.`);
 dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
