/* Person/year partitioning, mixed-legacy migration and stale network responses. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');const root=path.resolve(__dirname,'..');
const source=id=>`https://akademik.yok.gov.tr/academician-details?authorGuidId=${id}`;
const key=(id,year=2025)=>`akademik-tesvik-year-${year}-v2-person-${id}`;
const tick=()=>new Promise(r=>setTimeout(r,0));
const response=(data,ok=true)=>({ok,headers:{get:()=> 'application/json'},json:async()=>data});
function data(id,year=2025){return {name:'Aynı Ad Soyad',year,identity:{name:'Aynı Ad Soyad',source:source(id)},warnings:[],records:[{
 key:'shared-key',section:'article',sectionLabel:'Makaleler',kind:'Makale',title:`${id} yayını`,year,source:source(id),metadata:`${id} kaynak metni`,suggestedDraft:{activityId:'3.5',people:'1'}}],
 sections:[{id:'article',label:'Makaleler',status:'loaded',count:1,pages:1,source:source(id),rawText:`${id} bölüm metni`}]};}
function create(saved={}){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:8000',runScripts:'outside-only'}),w=dom.window,d=w.document;
 w.localStorage.setItem('tesvik-selected-year','2025');for(const [k,v] of Object.entries(saved))w.localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));
 w.confirm=()=>true;w.TextDecoder=TextDecoder;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};w.HTMLElement.prototype.scrollIntoView=function(){};
 const control={defer:false,pending:[]};
 w.fetch=async(url,options)=>{
  const body=JSON.parse(options.body),id=new URL(body.researcherId||source('P_A')).searchParams.get('authorGuidId');
  if(url.includes('/publication-summary'))return response({name:'Aynı Ad Soyad',counts:{SSCI:0,SCI:0,AHCI:0,SCOPUS:0},totalPublications:0,typeCounts:{article:0,conference:0,book:0},otherOrUnspecified:0,warnings:[]});
  if(url.endsWith('/search'))return response({candidates:['P_A','P_B'].map(id=>({name:'Aynı Ad Soyad',affiliation:id,url:source(id)})),warnings:[]});
  if(control.defer)return new Promise(resolve=>control.pending.push({id,year:body.year,url,signal:options.signal,resolve}));
  return response(data(id,body.year));
 };
 w.eval(fs.readFileSync(path.join(root,'engine.js'),'utf8'));w.eval(fs.readFileSync(path.join(root,'app.js'),'utf8'));
 return {dom,w,d,control};
}
function choose(env,id){const {w,d}=env;d.getElementById('yok-id').value=source(id);d.getElementById('yok-id').dispatchEvent(new w.Event('change'));}
const state=(env,id,year=2025)=>JSON.parse(env.w.localStorage.getItem(key(id,year)));
const titles=env=>[...env.d.querySelectorAll('#yok-preview article h3')].map(e=>e.textContent);
(async()=>{
 // Legacy data includes two people with the same name and one unowned record.
 let env=create(),E=env.w.IncentiveEngine;env.dom.window.close();
 const legacy={...E.DEFAULTS,entries:[{id:'yok-a',activityId:'3.5',people:1,quantity:1,note:source('P_A')},{id:'yok-b',activityId:'3.5',people:1,quantity:1,note:source('P_B')},{id:'unassigned',activityId:'3.5',people:1,quantity:1}],
 review:[{...data('P_A').records[0],key:'a'},{...data('P_B').records[0],key:'b'},{key:'orphan',section:'article',title:'Unowned',source:'',researcher:'Aynı Ad Soyad'}],
 sourceSections:[...data('P_A').sections,...data('P_B').sections],importIdentity:{name:'Aynı Ad Soyad',source:source('P_B')}};
 env=create({'akademik-tesvik-year-2025-v2':legacy});
 assert.deepEqual(titles(env),['P_B yayını']);assert.deepEqual(state(env,'P_B').entries.map(e=>e.id),['yok-b']);
 assert.ok(!env.d.getElementById('profile-section-reports').textContent.includes('P_A'));
 choose(env,'P_A');await tick();assert.deepEqual(titles(env),['P_A yayını']);assert.deepEqual(state(env,'P_A').entries.map(e=>e.id),['yok-a']);
 assert.equal(JSON.parse(env.w.localStorage.getItem('akademik-tesvik-year-2025-v2')).entries.length,3,'Eski veriler arşivde korunmalı');env.dom.window.close();
 // Fresh person selection isolates even identical record keys and same display names.
 env=create();let {d,w,control}=env;
 d.getElementById('yok-name').value='Aynı Ad Soyad';d.getElementById('yok-search').click();await tick();d.querySelectorAll('#yok-candidates button')[0].click();
 d.getElementById('yok-fetch').click();await tick();assert.deepEqual(titles(env),['P_A yayını']);
 d.getElementById('preapprove-all-review').click();d.getElementById('approve-all-review').click();assert.equal(state(env,'P_A').entries.length,1);
 d.getElementById('yok-search').click();assert.equal(titles(env).length,0,'Yeni arama eski incelemeyi hemen gizlemeli');await tick();
 d.querySelectorAll('#yok-candidates button')[1].click();assert.equal(titles(env).length,0);assert.equal(state(env,'P_B').entries.length,0);assert.equal(d.getElementById('score-total').textContent,'0,00');
 d.getElementById('yok-fetch').click();await tick();assert.deepEqual(titles(env),['P_B yayını']);
 assert.ok(!d.querySelector('#yok-preview [data-status="included"]'),'Aynı eser anahtarı başka kişinin onayını taşımamalı');
 d.getElementById('preapprove-all-review').click();d.getElementById('approve-all-review').click();assert.equal(state(env,'P_B').entries.length,1);assert.equal(state(env,'P_A').entries.length,1);
 choose(env,'P_A');await tick();assert.deepEqual(titles(env),['P_A yayını']);assert.equal(state(env,'P_A').entries.length,1);
 const year=d.getElementById('activity-year');year.value='2024';year.dispatchEvent(new w.Event('change'));assert.equal(titles(env).length,0);d.getElementById('yok-fetch').click();await tick();assert.deepEqual(titles(env),['P_A yayını']);assert.equal(state(env,'P_A',2024).entries.length,0);
 choose(env,'P_B');await tick();assert.equal(titles(env).length,0);year.value='2025';year.dispatchEvent(new w.Event('change'));assert.deepEqual(titles(env),['P_B yayını']);
 // Old A response arrives during B request; cancellation is deliberately ignored by the mock.
 choose(env,'P_A');control.defer=true;d.getElementById('yok-fetch').click();const a=control.pending.at(-1);choose(env,'P_B');assert.ok(a.signal.aborted);
 d.getElementById('yok-fetch').click();const b=control.pending.at(-1);a.resolve(response(data('P_A')));await tick();assert.ok(d.getElementById('yok-fetch').disabled,'Eski finally yeni isteğin düğmesini açmamalı');assert.deepEqual(titles(env),['P_B yayını']);
 b.resolve(response(data('P_B')));await tick();assert.deepEqual(titles(env),['P_B yayını']);assert.equal(state(env,'P_B').entries.length,1);
 // A wrong-identity server payload is rejected, never merged.
 d.getElementById('yok-fetch').click();control.pending.at(-1).resolve(response(data('P_A')));await tick();assert.match(d.getElementById('yok-status').textContent,/başka bir kişiye/);assert.deepEqual(titles(env),['P_B yayını']);
 // Saved HTML response is bound to the original person too.
 choose(env,'P_A');const content='<table><tr><td><b>A kitabı</b> (2025)</td></tr></table>';
 const file={name:'a.html',size:content.length,arrayBuffer:async()=>new TextEncoder().encode(content).buffer};Object.defineProperty(d.getElementById('yok-html-files'),'files',{configurable:true,value:[file]});d.getElementById('yok-html-files').dispatchEvent(new w.Event('change'));d.querySelector('#yok-html-mapping select').value='article';
 d.getElementById('yok-html-import').click();await tick();const html=control.pending.at(-1);assert.match(html.url,/import-html$/);assert.equal(html.id,'P_A');choose(env,'P_B');html.resolve(response(data('P_A')));await tick();assert.deepEqual(titles(env),['P_B yayını']);
 // Editing the profile field hides old rows even before a new URL is committed.
 d.getElementById('yok-id').value='https://akademik.yok.gov.tr/';d.getElementById('yok-id').dispatchEvent(new w.Event('input'));assert.equal(titles(env).length,0);assert.ok(d.getElementById('open-review').disabled);
 choose(env,'P_B');await tick();
 const saved=Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));env.dom.window.close();env=create(saved);({w,d,control}=env);assert.deepEqual(titles(env),['P_B yayını']);
 // Restoring an A backup from B selects and restores A, leaving B untouched.
 const backup=state(env,'P_A');const jsonFile={size:100,text:async()=>JSON.stringify(backup)};Object.defineProperty(d.getElementById('file-input'),'files',{configurable:true,value:[jsonFile]});d.getElementById('file-input').dispatchEvent(new w.Event('change'));await tick();
 assert.equal(w.localStorage.getItem('tesvik-selected-person'),'P_A');assert.deepEqual(titles(env),['P_A yayını']);assert.equal(state(env,'P_B').entries.length,1);
 const mixed={...state(env,'P_A'),review:[...state(env,'P_A').review,{...data('P_B').records[0],ownerId:'P_B'}],
 entries:[...state(env,'P_A').entries,{...state(env,'P_B').entries[0],ownerId:'P_B'}],sourceSections:[...data('P_A').sections,...data('P_B').sections]};
 Object.defineProperty(d.getElementById('file-input'),'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify(mixed)}]});d.getElementById('file-input').dispatchEvent(new w.Event('change'));await tick();
 assert.equal(state(env,'P_A').review.length,1);assert.equal(state(env,'P_A').entries.length,1);assert.equal(state(env,'P_A').entries[0].ownerId,'P_A');assert.equal(state(env,'P_A').sourceSections.length,1);
 env.dom.window.close();console.log('Person isolation passed: same names/keys, mixed legacy data, independent scores and years, immediate search clearing, stale API/HTML responses, wrong identity, reload and backup restoration.');
})().catch(error=>{console.error(error);process.exitCode=1;});
