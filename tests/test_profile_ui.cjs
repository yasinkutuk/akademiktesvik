/* Five-category import and privacy migration regression test. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const root=path.resolve(__dirname,'..');
const source='https://akademik.yok.gov.tr/academician-details?authorGuidId=ABC';
const labels={article:'MAKALE',conference:'BİLDİRİ',book:'KİTAP',project:'PROJELER',award:'ÖDÜLLER',course:'Dersler',editor:'Editörlükler'};
const drafts={article:{activityId:'3.5',people:'1'},conference:{activityId:'8.1',people:'1'},book:{activityId:'3.13',people:'1'},project:{activityId:'1.1',role:'leader'},award:{activityId:'9.2'}};
const rows=Object.keys(labels).map(section=>({key:section,section,sectionLabel:labels[section],kind:labels[section],year:2025,title:`Örnek ${labels[section]}`,source,metadata:section==='course'?'EXTRA_PERSONAL_DATA':'Kaynak künyesi',suggestedDraft:drafts[section]||{}}));
const sections=Object.keys(labels).map(id=>({id,label:labels[id],status:'loaded',count:1,pages:1,source,rawText:id==='course'?'EXTRA_PERSONAL_DATA':'Kaynak künyesi'}));
const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:8000',runScripts:'outside-only'}),w=dom.window,d=w.document;
w.localStorage.setItem('tesvik-selected-year','2025');
w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};w.HTMLElement.prototype.scrollIntoView=function(){};
w.fetch=async(url,options)=>{
 const payload=JSON.parse(options.body);assert.equal(payload.source,'modern');
 // Simulate an old broad response to ensure the UI also enforces the five-type scope.
 return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({name:'Örnek Kişi',year:2025,records:rows,sections,identity:{name:'Örnek Kişi',source},profile:{name:'Örnek Kişi',source,text:'RAW_PROFILE_SECRET'},warnings:[]})};
};
w.eval(fs.readFileSync(path.join(root,'engine.js'),'utf8'));
const E=w.IncentiveEngine;
for(const year of [2024,2025])w.localStorage.setItem(`akademik-tesvik-year-${year}-v2`,JSON.stringify({...E.DEFAULTS,
 entries:year===2024?[{id:'manual-patent',activityId:'6.1',people:1,quantity:1}]:[],
 review:[...rows].map(r=>({...r,status:'pending',draft:r.suggestedDraft})),sourceSections:sections,sourceProfile:{name:'Örnek Kişi',source,text:'RAW_PROFILE_SECRET'}}));
w.eval(fs.readFileSync(path.join(root,'app.js'),'utf8'));
const state=year=>JSON.parse(w.localStorage.getItem(`akademik-tesvik-year-${year}-v2-person-ABC`)||w.localStorage.getItem(`akademik-tesvik-year-${year}-v2`));
const tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 for(const year of [2024,2025]){
  const data=state(year);assert.equal(data.sourceProfile,undefined);assert.equal(data.importIdentity.text,undefined);
  assert.equal(data.review.length,5);assert.equal(data.sourceSections.length,5);
  assert.ok(!JSON.stringify(data).includes('RAW_PROFILE_SECRET'));assert.ok(!JSON.stringify(data).includes('EXTRA_PERSONAL_DATA'));
 }
 assert.equal(state(2024).entries[0].id,'manual-patent','Mevcut hesaplama kayıtları korunmalı');
 assert.equal(d.querySelectorAll('#yok-preview article').length,5);assert.equal(d.querySelectorAll('.source-section-report').length,5);
 assert.ok(!d.body.textContent.includes('RAW_PROFILE_SECRET'));assert.ok(!d.body.textContent.includes('EXTRA_PERSONAL_DATA'));
 assert.equal(d.querySelector('[data-review-key="course"]'),null);assert.equal(d.querySelector('[data-review-key="editor"]'),null);
 d.getElementById('yok-id').value=source;d.getElementById('yok-fetch').click();await tick();
 assert.equal(state(2025).review.length,5);assert.equal(state(2025).sourceProfile,undefined);
 assert.equal(state(2025).sourceSections.length,5);assert.equal(state(2025).entries.length,0);
 assert.ok(d.getElementById('review-dialog').open);assert.equal(d.getElementById('score-total').textContent,'0,00');
 d.getElementById('preapprove-all-review').click();assert.equal(state(2025).entries.length,0);
 assert.ok(!d.getElementById('approve-all-review').disabled);d.getElementById('approve-all-review').click();
 assert.equal(state(2025).entries.length,5);assert.notEqual(d.getElementById('score-total').textContent,'0,00');
 d.getElementById('yok-fetch').click();await tick();assert.equal(state(2025).entries.length,5);assert.equal(state(2025).review.length,5);
 console.log('Five-category UI passed: old profile removal in all years, extra category cleanup, saved calculation preservation, strict response filtering, two-stage approval and duplicate protection.');
 dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
