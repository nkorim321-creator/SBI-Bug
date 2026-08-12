// ==UserScript==
// @name         SBI 38.1
// @namespace    https://worker.mturk.com/
// @version      38.1
// @description  v38.1 — fixes the crash the v38.0 diagnostic caught (MAX_CLICK_STICKY_TRIES TDZ ReferenceError that crashed every submit). Also: the live diagnostic showed SBI options are NOT crowd-radio-buttons — they're custom elements — so tier-4 now picks the shortest exact "Yes/No" cell and clicks it AND its ancestor chain (handler often on a parent row) + sets aria/data/class state. Enhanced window.__hbsnDiag() dumps option candidates + custom elements.
// @author       Custom Script
// @match        https://worker.mturk.com/*
// @match        https://*.mturk.com/*
// @match        https://*.amazonaws.com/*
// @match        https://*.mturkcontent.com/*
// @match        https://*.cloudfront.net/*
// @match        *://*/*
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_addValueChangeListener
// @grant        window.close
// @connect      docs.google.com
// @connect      worker.mturk.com
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const TOOL_NAME = 'HasanBhaierSalamNin';
  const VERSION   = '37.1';

  /* ═══════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════ */
  const KEYWORD          = 'shop by interest';
  const WAIT_LOAD        = 3000;
  const WAIT_SUBMIT      = 1200;
  const CLOSE_DELAY      = 1500;
  const MAX_SUBMIT_TRIES = 60;
  const SUBMIT_RETRY_MS  = 300;
  const RETRY_MS         = 200;
  const YES_PERCENT      = 60;
  const STALE_LOCK_MS    = 25000;
  const ANSWER_RETRIES   = 10;                    // was 20 — with the SBI-panel short-circuit in doAnswerEverywhere we should never need this many; failing faster means a truly-unanswerable HIT gets returned in ~4s instead of ~8s
  // Cap "clicked submit but page never navigated" retries. Must live in CONFIG (top of
  // module) — declaring it next to submitLoop put it in the temporal dead zone, and
  // submitLoop can be called during init (iframe HBSN_SUBMIT), throwing a ReferenceError
  // that crashed every submit. This is the bug the diagnostic caught in v38.0.
  const MAX_CLICK_STICKY_TRIES = 4;

  /* ═══════════════════════════════════════
     STRICT 26 RETURN TEXTS
  ═══════════════════════════════════════ */
  const RETURN_PHRASES_26 = [
    "mytasuy french fry cutter professional potato cutter slicer commercial grade french fry cutter with stainless steel blade manual potatoes cutting machine with suction feet. 3/8. red and yellow",
    "tianyu gems 14k yellow gold created nanosital 0.5 ct royal blue sapphire round gemstone diamond promise ring solid gold womens engagement rings",
    "jieifafh silicone 3-button remote key fob case cover for ford focus for mondeo for kuga for fiesta for fusion (color : sea blue)",
    "2022 graduation table decorations graduation party decoration graduation party supplies graduation party centerpiece sticks",
    "lantern press providence, rhode island, skyline and sunburst screenprint style (100% cotton canvas reusable tote bag)",
    "viz-pro double-sided magnetic mobile whiteboard on wheels with marker tray 48 x 36 inches, aluminium frame and stand",
    "fmogg 4 piece womens pajama set, silk satin lace cami sleepwear robe pants nightdress trousers lingerie pyjama sets",
    "pet dog dress button shirt dress suitable for small and medium dogs yorkshire short sleeve summer clothing a8 s",
    "czvevoy penguin pattern pillowcase diy latch hook carpet kits couple throw cushion cover gift home decor",
    "3drose image of floral happy 65th anniversary quote - porcelain plate, 8-inch 8 inch, white",
    "6-cavity silicone donut baking pan non-stick mold dishwasher decoration tools dy9",
    "4 yard auto headliner fabric aura pearl gray sl2378 flat knit 3/16 foam backing",
    "half off ponds - 6 inch green glass jellyfish paperweight, glow in the dark",
    "champion xl200-17/32 rotobrute 17/32-inch annular cutter, 2-inch depth",
    "weldon 10244 773 low voc abs solvent cement, 1/4 pt capacity, clear",
    "future tailgater clemson tigers personalized heart baby onesie",
    "3 pieces / 4 pieces nail setter & center punch set (3 piece)",
    "rch hardware lt-ir830-75 iron house letter, 3 inch, black",
    "pro solutions 45418 mohair roller cover, 4 x 1/8 nap",
    "jet -5000. 1-1/2 square drive impact wrench, dhandle",
    "west ham united f.c. wristbands official merchandise",
    "sper scientific 810013r transparent red stopwatch",
    "texas tech university red raiders baby overalls",
    "jtx strider-x7 magnetic cross trainer",
    "murray, 40a dp breaker",
    "engine complete assembly fits chrysler crossfire 6-3.2l vin l 8th digit (certified used automotive part) |(grade a)"
  ];

  /* ═══════════════════════════════════════
     AUTH
  ═══════════════════════════════════════ */
  const AUTH_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1zUvoERdAkdBUKtiwwgS2k_PaU7-Rj5zM-il1cTeL3tQ/export?format=csv&gid=0';
  const LIC_KEY = 'hbsn_lic_v1';

  function monthKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  }

  const LIC = {
    isLocalValid() { try { const s=JSON.parse(GM_getValue(LIC_KEY,'{}'));return !!(s&&s.mk&&s.mk===monthKey()&&s.workerId); } catch(e){return false;} },
    savedWorkerId() { try{return JSON.parse(GM_getValue(LIC_KEY,'{}')).workerId||'';}catch(e){return '';} },
    save(wid) { GM_setValue(LIC_KEY,JSON.stringify({workerId:wid.toUpperCase().trim(),mk:monthKey(),at:Date.now()})); },
    clear() { GM_setValue(LIC_KEY,'{}'); }
  };

  /* ═══════════════════════════════════════
     DEFAULT DB
  ═══════════════════════════════════════ */
  const DEFAULT_DB = {
    "mytasuy french fry cutter professional potato cutter slicer commercial grade french fry cutter with stainless steel blade manual potatoes cutting machine with suction feet. 3/8. red and yellow": "no"
  };

  function seedDefaultDB() { saveDB({ ...DEFAULT_DB, ...getDB() }); }

  /* ═══════════════════════════════════════
     VERSION / LOCK / PAUSE / DB
  ═══════════════════════════════════════ */
  function getVer()  { return GM_getValue('hbsn_version','v2'); } // Default is v2
  function setVer(v) { GM_setValue('hbsn_version',v); }
  function isV2()    { return getVer()==='v2'; }

  function isLocked()    { return GM_getValue('hbsn_lock',0)===1; }
  function acquireLock() { GM_setValue('hbsn_lock',1); GM_setValue('hbsn_lock_ts',Date.now()); }
  function releaseLock() { GM_setValue('hbsn_lock',0); }
  function checkStaleLock() {
    if (isLocked() && (Date.now()-GM_getValue('hbsn_lock_ts',0))>STALE_LOCK_MS) {
      console.warn('[HBSN] Stale lock — releasing'); releaseLock();
    }
  }

  function isPaused() { return GM_getValue('hbsn_paused',false); }
  function setPaused(val) {
    GM_setValue('hbsn_paused',val); updatePauseBtn();
    if (!val) { queueMsg('▶️ Resumed','#68d391'); }
    else { queueMsg('⏸️ PAUSED','#f6ad55'); }
  }
  function updatePauseBtn() {
    const btn=document.getElementById('hbsn-pause-btn'); if(!btn)return;
    const p=isPaused(); btn.textContent=p?'▶️ Resume':'⏸️ Pause';
    btn.style.background=p?'#22c55e':'#f59e0b'; btn.style.color=p?'#fff':'#0f172a';
  }

  function getDB()    { try{return JSON.parse(GM_getValue('hbsn_word_db','{}'));}catch(e){return{};} }
  function saveDB(db) { GM_setValue('hbsn_word_db',JSON.stringify(db)); }
  function getDBSorted() {
    return Object.entries(getDB()).filter(([p])=>p.trim().length>0).sort((a,b)=>b[0].length-a[0].length);
  }

  /* ═══════════════════════════════════════
     ACTIVE TASK TRACKING (Multi-tab Support)
  ═══════════════════════════════════════ */
  function getActiveTasks() { 
      try { return JSON.parse(GM_getValue('hbsn_active_tasks', '{}')); } 
      catch(e) { return {}; }
  }
  function setActiveTask(assignId) {
      if(!assignId) return;
      let tasks = getActiveTasks();
      tasks[assignId] = Date.now();
      GM_setValue('hbsn_active_tasks', JSON.stringify(tasks));
  }
  function removeActiveTask(assignId) {
      if(!assignId) return;
      let tasks = getActiveTasks();
      delete tasks[assignId];
      GM_setValue('hbsn_active_tasks', JSON.stringify(tasks));
  }
  function cleanupActiveTasks() {
      let tasks = getActiveTasks();
      let now = Date.now();
      let changed = false;
      for (let id in tasks) {
          if (now - tasks[id] > 3 * 60 * 1000) { // Clear if older than 3 mins
              delete tasks[id];
              changed = true;
          }
      }
      if (changed) GM_setValue('hbsn_active_tasks', JSON.stringify(tasks));
  }
  function getAssignIdFromUrl(u) {
      if(!u) return null;
      let m = u.match(/assignments\/([A-Z0-9]+)/i);
      if (m) return m[1];
      try {
          let qs = u.split('?')[1];
          if(!qs) return null;
          let p = new URLSearchParams(qs);
          return p.get('assignmentId') || p.get('assignment_id') || null;
      } catch(e) { return null; }
  }

  /* ═══════════════════════════════════════
     MATCHING
  ═══════════════════════════════════════ */
  function matchKeywords(text,entries) { for(const [phrase,answer] of entries) if(text.includes(phrase)) return {phrase,answer}; return null; }
  function matchKeywordsV2(text,entries) { for(const [phrase] of entries) if(text.includes(phrase)) return phrase; return null; }
  function weightedChoice() { const r=Math.floor(Math.random()*100),c=r<YES_PERCENT?'yes':'no'; console.log(`[HBSN] 🎲`,r,'→',c.toUpperCase()); return c; }

  /* ═══════════════════════════════════════
     BODY TEXT
  ═══════════════════════════════════════ */
  const MAIN_SEL=['main','article','[role="main"]','crowd-form','.crowd-form','#content','.content','.task-content','form','.hit-wrapper','#hit-wrapper','.mturk-hit','#mturk-hit-frame'];
  const SKIP_SEL=['header','footer','nav','aside','[role="banner"]','[role="navigation"]','[role="contentinfo"]','.navbar','.nav','.footer','.header','#header','#footer','#nav','#navbar','script','style','noscript'].join(',');

  function getBodyText(doc) {
    doc=doc||document;
    for(const sel of MAIN_SEL){ const el=doc.querySelector(sel); if(el){const clone=el.cloneNode(true);clone.querySelectorAll(SKIP_SEL).forEach(n=>n.remove());const t=(clone.innerText||clone.textContent||'').toLowerCase().trim();if(t.length>20)return t;} }
    const clone=(doc.body||document.createElement('div')).cloneNode(true);
    clone.querySelectorAll(SKIP_SEL).forEach(n=>n.remove());
    return(clone.innerText||clone.textContent||'').toLowerCase().trim();
  }
  function getPageText() {
    let text=getBodyText(document);
    document.querySelectorAll('iframe').forEach(f=>{try{text+=' '+getBodyText(f.contentDocument);}catch(e){}});
    return text;
  }

  /* ═══════════════════════════════════════
     WORKER ID / AUTH
  ═══════════════════════════════════════ */
  const WID_RE=/\b(A[A-Z0-9]{9,19})\b/;
  function detectWorkerIdFull(cb) {
    function scanTextNodes(){if(!document.body)return null;const w=document.createTreeWalker(document.body,4,null,false);let n;while((n=w.nextNode())){const t=(n.nodeValue||'').trim();if(t.length>5&&t.length<100){const m=t.match(WID_RE);if(m)return m[1];}}return null;}
    const fromDOM=scanTextNodes(); if(fromDOM){cb(fromDOM);return;}
    try{for(const g of['__reactInitialState__','turkerId','workerId','worker_id','WORKER_ID']){const val=window[g];if(!val)continue;const wm=(typeof val==='string'?val:JSON.stringify(val)).match(WID_RE);if(wm){cb(wm[1]);return;}}}catch(e){}
    for(const sc of document.querySelectorAll('script')){const txt=sc.textContent||'';if(txt.length>50){const sm=txt.match(/worker[_-]?id['":\s]+([A-Z0-9]{10,20})/i)||txt.match(/\b(A[A-Z0-9]{13,19})\b/);if(sm&&sm[1]&&/^A[A-Z0-9]{9,19}$/.test(sm[1])){cb(sm[1]);return;}}}
    const ck=(document.cookie||'').match(/worker_id=([A-Z0-9]{10,20})/i);if(ck&&ck[1]){cb(ck[1].toUpperCase());return;}
    const apis=['https://worker.mturk.com/api/worker','https://worker.mturk.com/api/profile','https://worker.mturk.com/worker_requirements'];
    let tried=0;
    function tryApi(){if(tried>=apis.length){tryDashboard();return;}GM_xmlhttpRequest({method:'GET',url:apis[tried++]+'?_='+Date.now(),headers:{'Accept':'application/json, text/html'},timeout:8000,onload(r){const f=extractWid(r.responseText||'');if(f){cb(f);return;}tryApi();},onerror(){tryApi();},ontimeout(){tryApi();}});}
    function tryDashboard(){GM_xmlhttpRequest({method:'GET',url:'https://worker.mturk.com/dashboard?_='+Date.now(),headers:{'Accept':'text/html'},timeout:12000,onload(r){cb(extractWid(r.responseText||'')||null);},onerror(){cb(null);},ontimeout(){cb(null);}});}
    tryApi();
    function extractWid(text){for(const p of[/worker[_-]?id['":\s]+([A-Z0-9]{10,20})/i,/"id"\s*:\s*"(A[A-Z0-9]{12,19})"/i,/\b(A[A-Z0-9]{13,19})\b/]){const m=text.match(p);if(m&&m[1]&&/^A[A-Z0-9]{9,19}$/.test(m[1]))return m[1].toUpperCase();}return null;}
  }
  function getWorkerID(){const p=new URLSearchParams(window.location.search),u=p.get('workerId')||p.get('worker_id');if(u&&u.length>3)return u.trim();const m=(document.body?.innerText||'').match(/\b(A[A-Z0-9]{10,20})\b/);return m?m[1]:null;}

  function parseCSV(txt){
    txt=(txt||'').replace(/^\uFEFF/,'');const rows=[];
    txt.split('\n').forEach(line=>{line=line.trim();if(!line)return;const cols=[];let inQ=false,cur='';for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){inQ=!inQ;}else if(c===','&&!inQ){cols.push(cur.trim());cur='';}else cur+=c;}cols.push(cur.trim());rows.push(cols);});
    return rows;
  }

  function checkSheet(wid,cb){
    wid=(wid||'').toUpperCase().trim().replace(/\s+/g,'').replace(/\r/g,'');
    GM_xmlhttpRequest({method:'GET',url:AUTH_SHEET_URL+'&nocache='+Date.now(),
      headers:{'Cache-Control':'no-cache, no-store, must-revalidate','Pragma':'no-cache','Accept':'text/csv,text/plain,*/*'},timeout:20000,
      onload(r){
        const body=r.responseText||'';
        if(r.status!==200||body.indexOf('<html')>-1||body.indexOf('<!DOCTYPE')>-1){cb(false,'network_error');return;}
        const rows=parseCSV(body);if(!rows||rows.length<1){cb(false,'network_error');return;}
        const rx=/^A[A-Z0-9]{5,19}$/;
        for(let row=1;row<rows.length;row++){for(let col=0;col<rows[row].length;col++){const cell=(rows[row][col]||'').toUpperCase().trim().replace(/\r/g,'');if(cell===wid&&rx.test(cell)){const hdr=(rows[0]&&rows[0][col])?rows[0][col].trim():('Team '+(col+1));cb(true,hdr.charAt(0).toUpperCase()+' Team ('+hdr+')');return;}}}
        cb(false,'not_found');
      },
      onerror(){cb(false,'network_error');},ontimeout(){cb(false,'network_error');}
    });
  }

  function injectAuthCSS(){
    if(document.getElementById('hbsn-auth-css'))return;
    const s=document.createElement('style');s.id='hbsn-auth-css';
    s.textContent=`
      #hbsn-auth-badge{position:fixed;bottom:16px;right:16px;z-index:2147483647;background:rgba(10,10,10,.95);border:1px solid #2a2a2a;border-radius:10px;padding:10px 14px;font-family:'Segoe UI',system-ui,sans-serif;backdrop-filter:blur(6px);box-shadow:0 4px 20px rgba(0,0,0,.8);min-width:170px;text-align:center}
      .hb-logo{font:900 11px system-ui;color:#f59e0b;letter-spacing:1px}
      .hb-ver{font:600 8px system-ui;color:#444;letter-spacing:2px;margin-bottom:6px}
      .hb-wid{font:800 11px Consolas,monospace;color:#f59e0b;margin-bottom:4px;min-height:14px}
      .hb-st{font:600 9px system-ui;min-height:12px}
      #hbsn-block-screen,#hbsn-revoked{position:fixed;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,#080808,#0f172a);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,sans-serif}
      .hb-box{background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:36px 44px;text-align:center;width:420px;box-shadow:0 30px 80px rgba(0,0,0,.9)}
      .hb-logo-lg{font:900 18px system-ui;color:#ef4444;letter-spacing:2px;margin-bottom:4px}
      .hb-sub{font:700 9px system-ui;color:#333;letter-spacing:3px;margin-bottom:14px;text-transform:uppercase}
      .hb-clock{font:900 42px/1 Consolas,monospace;color:#22c55e;letter-spacing:4px;margin-bottom:5px}
      .hb-date{font:600 11px system-ui;color:#444;margin-bottom:20px}
      .hb-sep{height:1px;background:linear-gradient(90deg,transparent,#222,transparent);margin-bottom:20px}
      .hb-wid-lg{font:900 15px Consolas,monospace;color:#ef4444;letter-spacing:3px;margin-bottom:14px}
      .hb-msg{font:600 11px system-ui;color:#94a3b8;line-height:1.7;margin-bottom:8px}
      .hb-footer{font:600 8px system-ui;color:#2a2a2a;margin-top:18px}`;
    (document.head||document.documentElement).appendChild(s);
  }

  let _clockTimer=null;
  function _startClock(prefix){
    if(_clockTimer){clearInterval(_clockTimer);_clockTimer=null;}
    function tick(){const d=new Date(),p2=n=>String(n).padStart(2,'0'),days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],mons=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],clk=document.getElementById(prefix+'-clk'),dt=document.getElementById(prefix+'-dt');if(clk)clk.textContent=p2(d.getHours())+':'+p2(d.getMinutes())+':'+p2(d.getSeconds());if(dt)dt.textContent=days[d.getDay()]+', '+mons[d.getMonth()]+' '+d.getDate()+' '+d.getFullYear();}
    tick();_clockTimer=setInterval(tick,1000);
  }

  function showBadge(wid){removeBadge();if(!document.body)return;const b=document.createElement('div');b.id='hbsn-auth-badge';const masked=wid?wid.substring(0,4)+'***'+wid.substring(wid.length-3):'Detecting…';b.innerHTML=`<div class="hb-logo">${TOOL_NAME}</div><div class="hb-ver">v${VERSION}</div><div class="hb-wid" id="hbsn-badge-wid">${masked}</div><div class="hb-st" id="hbsn-badge-st" style="color:#f39c12">Checking…</div>`;document.body.appendChild(b);}
  function removeBadge(){document.getElementById('hbsn-auth-badge')?.remove();}
  function setBadgeSt(msg,color){const el=document.getElementById('hbsn-badge-st');if(!el)return;el.textContent=msg;el.style.color=color||'#f39c12';}
  function setBadgeWid(wid){const el=document.getElementById('hbsn-badge-wid');if(!el)return;el.textContent=wid.substring(0,4)+'***'+wid.substring(wid.length-3);}

  function showBlockScreen(wid,msg){
    removeBadge();document.getElementById('hbsn-block-screen')?.remove();
    const masked=wid?wid.substring(0,4)+'***'+wid.substring(wid.length-3):'Not detected';
    const bl=document.createElement('div');bl.id='hbsn-block-screen';
    bl.innerHTML=`<div class="hb-box"><div class="hb-logo-lg">🔒 ${TOOL_NAME}</div><div class="hb-sub">NOT AUTHORIZED · v${VERSION}</div><div class="hb-clock" id="bl-clk">--:--:--</div><div class="hb-date" id="bl-dt"></div><div class="hb-sep"></div><div class="hb-wid-lg">${masked}</div><div class="hb-msg">${msg||'Worker ID not authorized.'}</div><div class="hb-footer">Contact your administrator</div></div>`;
    document.body.appendChild(bl);_startClock('bl');
  }

  function showRevokedScreen(){
    document.getElementById('hbsn-block-screen')?.remove();document.getElementById('hbsn-revoked')?.remove();
    const r=document.createElement('div');r.id='hbsn-revoked';
    r.innerHTML=`<div class="hb-box"><div class="hb-logo-lg">🚫 ${TOOL_NAME}</div><div class="hb-sub">ACCESS REVOKED · v${VERSION}</div><div class="hb-clock" id="rv-clk">--:--:--</div><div class="hb-date" id="rv-dt"></div><div class="hb-sep"></div><div class="hb-msg">Your Worker ID has been removed<br>from the authorized list.</div><div class="hb-footer">Contact your administrator</div></div>`;
    document.body.appendChild(r);_startClock('rv');
  }

  function showCheckingBadge(savedId){
    if(!document.body){setTimeout(()=>showCheckingBadge(savedId),50);return;}
    removeBadge();const masked=savedId.substring(0,4)+'***'+savedId.substring(savedId.length-3);
    const b=document.createElement('div');b.id='hbsn-auth-badge';
    b.innerHTML=`<div class="hb-logo">${TOOL_NAME}</div><div class="hb-ver">v${VERSION}</div><div class="hb-wid">${masked}</div><div class="hb-st" id="hbsn-badge-st" style="color:#f39c12">Verifying…</div>`;
    document.body.appendChild(b);
  }

  /* ═══════════════════════════════════════
     GATE
  ═══════════════════════════════════════ */
  function gate(onPass,onFail){
    injectAuthCSS();
    const savedId=LIC.savedWorkerId();
    if(savedId&&LIC.isLocalValid()){
      showCheckingBadge(savedId);
      checkSheet(savedId,(ok,reason)=>{
        removeBadge();
        if(ok){onPass();startBgReVerify(savedId);}
        else if(reason==='network_error'){onPass();startBgReVerify(savedId);}
        else{LIC.clear();showBlockScreen(savedId,'Your Worker ID has been removed.');onFail();}
      });
    } else {
      LIC.clear();showBadge(getWorkerID());_detectAttempts=0;doFullDetect(onPass,onFail);
    }
  }

  let _detectAttempts=0;
  function doFullDetect(onPass,onFail){
    _detectAttempts++;setBadgeSt('Detecting… '+_detectAttempts+'/10','#f39c12');
    detectWorkerIdFull(wid=>{
      if(wid){
        wid=wid.toUpperCase().trim();setBadgeWid(wid);setBadgeSt('Checking sheet…','#f39c12');
        checkSheet(wid,(ok,reason)=>{
          removeBadge();
          if(ok){LIC.save(wid);startBgReVerify(wid);onPass();}
          else if(reason==='network_error'){showBlockScreen(wid,'Cannot reach sheet.');onFail();}
          else{showBlockScreen(wid,'Worker ID not authorized.');onFail();}
        });
      } else if(_detectAttempts<10){
        setTimeout(()=>doFullDetect(onPass,onFail),3000);
      } else {
        removeBadge();showBlockScreen(null,'Could not detect Worker ID.');onFail();
      }
    });
  }

  let _bgFails=0;
  function startBgReVerify(wid){
    setInterval(()=>{
      checkSheet(wid,(ok,reason)=>{
        if(ok){_bgFails=0;return;}
        if(reason==='network_error'){_bgFails++;if(_bgFails>=2){_bgFails=0;}return;}
        _bgFails=0;LIC.clear();releaseLock();showRevokedScreen();
      });
    },5*60*1000);
  }

  /* ═══════════════════════════════════════
     PAGE ROUTING & SINGLE TAB MANAGER
  ═══════════════════════════════════════ */
  seedDefaultDB();

  const url     = location.href;
  const inFrame = window.self !== window.top;

  /* ═══════════════════════════════════════
     WRONG PAGE INSTANT REDIRECT (Amazon Home / MTurk Home)
  ═══════════════════════════════════════ */
  if (!inFrame) {
      const cleanUrl = window.location.href.split('?')[0].replace(/\/$/, "");
      if (cleanUrl === 'https://www.amazon.com' || cleanUrl === 'https://worker.mturk.com') {
          console.log('[HBSN] Wrong page detected. Redirecting instantly to /tasks...');
          window.location.replace('https://worker.mturk.com/tasks');
          return;
      }
  }

  /* ═══════════════════════════════════════
     SERVER BUSY / CONTINUE SHOPPING HANDLER FIX
  ═══════════════════════════════════════ */
  let _serverBusyHandled = false;
  function handleServerBusy() {
      if (_serverBusyHandled) return true; // Stop running anything else if already handling

      if (!document.body) return false;
      const title = (document.title || '').toLowerCase();
      const bodyText = (document.body.innerText || '').toLowerCase(); 
      
      if (title.includes('server busy') || bodyText.includes('continue shopping')) {
          console.log('[HBSN] Server Busy detected. Clicking button to clear lock naturally...');
          _serverBusyHandled = true; // Lock execution

          // If it is a background HIT tab, close it immediately
          if (window.location.href.includes('/projects/') || sessionStorage.getItem('hbsn_is_task_tab') === 'true') {
              try { window.close(); } catch(e){}
              return true;
          }

          // Main tab: Click the Continue button and wait for the natural page load. 
          // (It will naturally redirect to MTurk home, which our WRONG PAGE logic will catch and send to /tasks).
          const els = document.querySelectorAll('a, button, input');
          let found = false;
          for (let i = 0; i < els.length; i++) {
              const t = (els[i].textContent || els[i].value || '').toLowerCase();
              if (t.includes('continue')) {
                  try { 
                      els[i].click(); 
                      found = true;
                      console.log('[HBSN] Clicked "Continue shopping". Waiting for natural redirect...');
                  } catch (e) {}
                  break;
              }
          }

          // Fallback redirect if button was missing
          if (!found) {
              setTimeout(() => { window.location.replace('https://worker.mturk.com/tasks'); }, 2000);
          }

          return true; // We handled it, do nothing else.
      }
      return false;
  }

  // Check for Server Busy / Continue Shopping page FIRST!
  if (!inFrame && handleServerBusy()) {
      return; 
  }

  // ★ SMART CLOSE LOGIC: Detects redirect AFTER submit to close background task tab
  if (!inFrame) {
      if (isTaskPage()) {
          sessionStorage.setItem('hbsn_is_task_tab', 'true');
      } else if (sessionStorage.getItem('hbsn_is_task_tab') === 'true') {
          console.log('[HBSN] Task submitted and redirected! Closing background tab safely...');
          showClosingBanner();
          setTimeout(() => forceCloseTab(), 300);
          return;
      }
  }

  function isQueuePage(){
    if(url.includes('/projects/')||url.includes('/assignments/')) return false;
    return url.includes('worker.mturk.com/queue') || url.includes('worker.mturk.com/tasks') || url==='https://worker.mturk.com/' || url==='https://worker.mturk.com';
  }
  function isTaskPage(){
    return url.includes('/assignments/')||(url.includes('/projects/')&&(url.includes('/tasks/')||url.includes('/tasks?')));
  }

  // ★ SINGLETON LOGIC: Ensures only ONE Queue tab runs the processor
  function manageQueueSingleton() {
    let tabId = sessionStorage.getItem('hbsn_queue_tab_id');
    if (!tabId) {
        tabId = Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('hbsn_queue_tab_id', tabId);
    }

    const activeTabId = GM_getValue('hbsn_active_queue_id', '');
    const lastHeartbeat = GM_getValue('hbsn_queue_heartbeat', 0);
    const now = Date.now();

    if (activeTabId !== tabId && (now - lastHeartbeat < 3000)) {
        document.body.innerHTML = '<h1 style="color:#ef4444;text-align:center;margin-top:20%;font-family:sans-serif;">Duplicate Queue Tab Detected.<br>Closing to prevent conflicts...</h1>';
        setTimeout(() => { try{window.close();}catch(e){} }, 800);
        return false;
    }

    GM_setValue('hbsn_active_queue_id', tabId);
    GM_setValue('hbsn_queue_heartbeat', now);

    setInterval(() => {
        GM_setValue('hbsn_queue_heartbeat', Date.now());
        GM_setValue('hbsn_active_queue_id', tabId);
    }, 1000);

    return true;
  }

  // Cleanup abandoned standard MTurk submit pages
  if(!inFrame && url.includes('worker.mturk.com/projects') && !url.includes('/tasks/') && !url.includes('/assignments/')){
    if((Date.now()-GM_getValue('hbsn_submitted',0))<60000){
      releaseLock(); showClosingBanner(); setTimeout(()=>{GM_setValue('hbsn_tab_open',0);forceCloseTab();},400);
    }
    return;
  }

  // Route to Queue Page
  if(!inFrame && isQueuePage()){
    if (!manageQueueSingleton()) return;
    if(document.body) runQueue(); else document.addEventListener('DOMContentLoaded', runQueue);
    return;
  }

  // Route to Task Page
  if(!inFrame && isTaskPage()){
    runParent();
    return;
  }
  
  // ★ IFRAME: the SBI answer panel (crowd-form / "Select an option") lives in a
  // cross-origin mturkcontent iframe. The parent can't reach it, so the iframe MUST
  // run its own answer engine. Previous versions gated this behind hbsn_time/lock
  // signals that the parallel rewrite stopped setting — so the iframe never ran and
  // the HIT hung on "Answer element not found". Now the iframe SELF-DETECTS HIT
  // content and runs on its own, no parent signal required.
  function iframeHasHITContent(){
    try{
      if(!document.body) return false;
      if(document.querySelector('crowd-form,crowd-radio-group,crowd-radio-button,crowd-checkbox,input[type="radio"]')) return true;
      const t=(document.body.innerText||'').toLowerCase();
      return t.includes('select an option') || t.includes('shop by interest') ||
             t.includes('is the below item') || /\byes\b[\s\S]{0,6}\bno\b/.test(t);
    }catch(e){ return false; }
  }
  if(inFrame){
    let _ir=0;
    (function pollParent(){
      // Run if the iframe itself shows HIT content, OR the parent signalled recently,
      // OR the lock is held. Poll for ~12s to catch late-rendering crowd-forms.
      if(iframeHasHITContent()){ runIframe(); return; }
      if((Date.now()-GM_getValue('hbsn_time',0))<60000){ runIframe(); return; }
      if(isLocked()){ runIframe(); return; }
      if(++_ir<48) setTimeout(pollParent,250);
    })();
    // Also run immediately if the parent explicitly tells us to.
    window.addEventListener('message', e => {
      if(e.data && e.data.type==='HBSN_RUN' && !window.__hbsnIframeRan){ runIframe(); }
    });
    return;
  }

  /* ═══════════════════════════════════════
     QUEUE RUNNER (Background & Deduplication support)
  ═══════════════════════════════════════ */
  function runQueue(){
    const pageText = (document.body.innerText || '').toLowerCase();
    if (pageText.includes('already processing')) {
      document.body.innerHTML = '<h1 style="color:#f59e0b;text-align:center;margin-top:20%;font-family:sans-serif;">MTurk "Already processing" lock detected.<br>Waiting 2.5s...</h1>';
      setTimeout(() => location.reload(), 2500);
      return;
    }

    addQueueUI(); addDBManagerUI();

    if(isPaused()){
      queueMsg('⏸️ PAUSED','#f6ad55'); updatePauseBtn();
    }

    // Continuously scan for new HITs and open them in background
    setInterval(() => {
        if (!isPaused()) processAvailableHITs();
    }, 1500);

    processAvailableHITs();
  }

  function processAvailableHITs(){
    if(isPaused()) return;
    cleanupActiveTasks(); // clean up dead/old tracking

    const links = Array.from(document.querySelectorAll('a[href^="/projects/"][href*="/tasks"]'));
    let openedCount = 0;
    const activeTasks = getActiveTasks();
    const processedPaths = new Set(); // 1 Hit 1 Tab Fix

    for (const link of links) {
        const href = link.getAttribute('href');
        if (!href) continue;

        const basePath = href.split('?')[0]; 
        let assignId = getAssignIdFromUrl(href) || basePath;

        // Verify it wasn't already marked in this exact loop (Deduplication)
        if (processedPaths.has(basePath)) {
            link.dataset.hbsnClicked = 'true';
            continue;
        }

        if (!activeTasks[assignId] && link.dataset.hbsnClicked !== 'true') {
            link.dataset.hbsnClicked = 'true';
            processedPaths.add(basePath); // Mark to prevent 2nd click
            setActiveTask(assignId);
            
            const fullUrl = href.startsWith('/') ? window.location.origin + href : href;
            
            GM_openInTab(fullUrl, { active: false, insert: true });
            openedCount++;
        }
    }

    if (openedCount > 0) {
        queueMsg(`🟢 Opened ${openedCount} new HIT(s) in background…`, '#68d391');
    } else {
        const t=GM_getValue('hbsn_total',0),y=GM_getValue('hbsn_yes',0),n=GM_getValue('hbsn_no',0),r=GM_getValue('hbsn_returned',0);
        queueMsg(`📭 Queue Scanning... | Done:${t} ✅${y} ❌${n} 🔁${r}`,'#a78bfa');
    }
  }

  /* ═══════════════════════════════════════
     ★ DEEP CLICK
  ═══════════════════════════════════════ */
  function deepClick(el){
    try{el.focus();}catch(e){}
    const o={bubbles:true,cancelable:true,composed:true};
    try{el.dispatchEvent(new PointerEvent('pointerdown',o));}catch(e){}
    el.dispatchEvent(new MouseEvent('mousedown',o));
    try{el.dispatchEvent(new PointerEvent('pointerup',o));}catch(e){}
    el.dispatchEvent(new MouseEvent('mouseup',o));
    el.dispatchEvent(new MouseEvent('click',o));
    try{el.click();}catch(e){}
  }

  /* ═══════════════════════════════════════
     ★ ANSWER ENGINE
  ═══════════════════════════════════════ */
  function doAnswer(choice){return doAnswerInDoc(document,choice);}

  // Shadow-DOM-aware querySelectorAll — recurses into every open shadow root under `root`.
  // SBI-style HITs render Yes/No options inside <crowd-form>'s shadow root, so a plain
  // doc.querySelectorAll misses them entirely and the answer engine kept coming up empty.
  function deepQueryAll(root, selector) {
    const out = [];
    if (!root || !root.querySelectorAll) return out;
    try { root.querySelectorAll(selector).forEach(el => out.push(el)); } catch (e) {}
    try {
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) out.push(...deepQueryAll(el.shadowRoot, selector));
      });
    } catch (e) {}
    return out;
  }

  function _isYesLabel(t) {
    const s = (t || '').toLowerCase().trim();
    return s === 'yes' || s === 'y' || s === '1' || s === 'yes 1' || s === '1 yes' ||
           s === 'true' || s === 'relevant' || s.startsWith('yes ') || s.startsWith('yes\n');
  }
  function _isNoLabel(t) {
    const s = (t || '').toLowerCase().trim();
    return s === 'no' || s === 'n' || s === '2' || s === 'no 2' || s === '2 no' ||
           s === '0' || s === 'false' || s === 'irrelevant' || s.startsWith('no ') || s.startsWith('no\n');
  }

  function doAnswerInDoc(doc, choice) {
      if (!doc) return false;
      const wantYes = choice === 'yes';
      const wantedVal = wantYes ? '1' : '2';
      let clicked = false;

      // 0. HIGHEST-PRIORITY: crowd-radio-button with the exact value MTurk expects.
      // SBI's "Yes 1 / No 2" panel is a crowd-radio-group where each button carries
      // value="1" or value="2". Clicking the button by exact value updates crowd-form's
      // internal state — which is what the Submit button validates before navigating.
      // Both PROPERTY and attribute paths are set so all reflected/observed variants
      // of the component pick up the change.
      for (const cr of deepQueryAll(doc, 'crowd-radio-button')) {
          if (cr.getAttribute('value') === wantedVal) {
              try { cr.checked = true; } catch (e) {}                      // property (component observes this)
              try { cr.setAttribute('checked', ''); } catch (e) {}         // attribute (fallback for reflect)
              try { cr.click(); } catch (e) {}
              try { deepClick(cr); } catch (e) {}
              const grp = cr.closest && cr.closest('crowd-radio-group');
              setTimeout(() => {
                  try { cr.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (e) {}
                  if (grp) {
                      try { grp.value = wantedVal; } catch (e) {}          // property
                      try { grp.setAttribute('value', wantedVal); } catch (e) {}
                      try { grp.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (e) {}
                  }
              }, 30);
              return true;
          }
      }

      // 1. Native radio / checkbox (light DOM AND shadow DOM)
      for (const r of deepQueryAll(doc, 'input[type="radio"], input[type="checkbox"]')) {
          const val = (r.value || '').toLowerCase();
          let labelTxt = '';
          if (r.id && r.getRootNode) {
              const rootN = r.getRootNode();
              const lbl = rootN.querySelector && rootN.querySelector(`label[for="${r.id}"]`);
              if (lbl) labelTxt = (lbl.innerText || lbl.textContent || '').toLowerCase();
          }
          const parentTxt = (r.parentElement ? (r.parentElement.innerText || r.parentElement.textContent || '') : '').toLowerCase();
          const combined = [val, labelTxt, parentTxt].join(' ').trim();

          let isYes = _isYesLabel(val) || labelTxt.includes('yes') || combined.includes('relevant') && !combined.includes('irrelevant');
          let isNo  = _isNoLabel(val)  || labelTxt.includes('no')  || combined.includes('irrelevant');
          if (isYes && isNo) { isYes = _isYesLabel(val); isNo = _isNoLabel(val); }

          if ((wantYes && isYes) || (!wantYes && isNo)) {
              try { r.checked = true; } catch (e) {}
              try { r.click(); } catch (e) {}
              try { r.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
              try { r.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}
              clicked = true;
          }
      }
      if (clicked) return true;

      // 2. Amazon Crowd elements (deep — they live in shadow roots for crowd-form)
      for (const cr of deepQueryAll(doc, 'crowd-radio-button, crowd-checkbox, crowd-tile')) {
          const rawText = (cr.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
          const attrVal = (cr.getAttribute('value') || cr.getAttribute('name') || '').toLowerCase().trim();
          const first   = rawText.split(' ')[0] || '';
          const v = attrVal || first;
          const isYes = _isYesLabel(v) || _isYesLabel(rawText);
          const isNo  = _isNoLabel(v)  || _isNoLabel(rawText);
          if ((wantYes && isYes) || (!wantYes && isNo)) {
              try { cr.click(); } catch (e) {}
              try { deepClick(cr); } catch (e) {}
              setTimeout(() => {
                  try { cr.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (e) {}
                  const grp = cr.closest && cr.closest('crowd-radio-group');
                  if (grp) { try { grp.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (e) {} }
              }, 50);
              return true;
          }
      }

      // 3. ARIA-role radios/options — some HITs use divs with role="radio"/"option"
      for (const el of deepQueryAll(doc, '[role="radio"], [role="option"], [role="menuitemradio"]')) {
          const t = (el.innerText || el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if ((wantYes && _isYesLabel(t)) || (!wantYes && _isNoLabel(t))) {
              try { el.click(); deepClick(el); } catch (e) {}
              clicked = true;
              break;
          }
      }
      if (clicked) return true;

      // 4. Visual text match on any small clickable — SBI-style panels with "Yes 1" / "No 2".
      // The diagnostic on the live HIT showed NO crowd-radio-button — the options are
      // custom elements. The onclick handler often sits on a PARENT row, not the text
      // node we match, so click the matched element AND walk up clicking each ancestor
      // (bounded), plus set common data-* / aria state. First exact-label match wins.
      const candidates = deepQueryAll(doc, 'tr, td, li, div, button, span, label, a, p');
      // Prefer exact "yes"/"no"/"yes 1"/"no 2" (the option cell) over longer text.
      let best = null, bestLen = 999;
      for (const el of candidates) {
          let t;
          try { t = (el.innerText || el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); } catch (e) { continue; }
          if (!t || t.length > 18) continue;
          const hit = (wantYes && _isYesLabel(t)) || (!wantYes && _isNoLabel(t));
          if (hit && t.length < bestLen) { best = el; bestLen = t.length; }
      }
      if (best) {
          const chain = [];
          let cur = best;
          for (let i = 0; i < 4 && cur && cur.tagName; i++) { chain.push(cur); cur = cur.parentElement; }
          // Click the option and its ancestors (one of them carries the handler).
          for (const el of chain) {
              try { deepClick(el); } catch (e) {}
              try {
                  el.setAttribute && el.setAttribute('aria-checked', 'true');
                  if (el.classList) el.classList.add('selected', 'active', 'checked');
              } catch (e) {}
          }
          // Register any hidden input inside the option.
          const r = best.querySelector && best.querySelector('input[type="radio"], input[type="checkbox"]');
          if (r) { try { r.checked = true; r.click(); r.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
          clicked = true;
      }
      return clicked;
  }

  // Detect an SBI "Select an option / Yes 1 / No 2" shortcut panel. When this UI is
  // present, MTurk's ONLY answer path is the keyboard shortcut — there is no clickable
  // Yes/No element the user could target. So relying on doAnswerInDoc to find something
  // clickable will loop forever.
  function isSBIShortcutPanel() {
    try {
      const body = document.body ? (document.body.innerText || '') : '';
      if (!/select\s+an\s+option/i.test(body)) return false;
      // Look for the "Yes 1" / "No 2" shortcut labels — these are the SBI hint format.
      return /\byes\b[\s\S]{0,4}\b1\b/i.test(body) || /\bno\b[\s\S]{0,4}\b2\b/i.test(body) ||
             /shortcuts/i.test(body);
    } catch (e) { return false; }
  }

  // Describe an element compactly for the diagnostic log.
  function _descEl(el) {
    if (!el || !el.tagName) return '(none)';
    const attrs = [];
    if (el.id) attrs.push('id=' + el.id);
    if (el.className && typeof el.className === 'string') attrs.push('cls=' + el.className.trim().slice(0, 40));
    ['value','name','role','tabindex','data-value','data-key','data-answer','aria-checked','aria-label'].forEach(a => {
      const v = el.getAttribute && el.getAttribute(a);
      if (v != null) attrs.push(a + '=' + v);
    });
    return '<' + el.tagName.toLowerCase() + ' ' + attrs.join(' ') +
           '> "' + ((el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 25)) + '"';
  }

  // Dump the answer-panel DOM to the console. Call window.__hbsnDiag() in any frame.
  function hbsnDiag() {
    const where = window.self === window.top ? 'TOP' : 'IFRAME(' + location.href.slice(0, 55) + ')';
    console.log('%c[HBSN DIAG] ' + where, 'color:#f59e0b;font-weight:bold');

    // 1) Standard selectors (deep).
    const groups = [];
    ['crowd-form','crowd-classifier','crowd-radio-group','crowd-radio-button','crowd-checkbox',
     'crowd-button','input[type="radio"]','input[type="checkbox"]','[role="radio"]','[role="button"]',
     'button','[data-value]','[data-key]','[onclick]'].forEach(sel => {
      const els = deepQueryAll(document, sel);
      if (els.length) {
        groups.push(sel + ': ' + els.length);
        els.slice(0, 4).forEach(el => groups.push('   ' + _descEl(el)));
      }
    });
    console.log('[HBSN DIAG] element counts:\n' + groups.join('\n'));

    // 2) Any element whose short text is exactly/starts-with yes/no/1/2 — the actual options.
    const opts = [];
    deepQueryAll(document, '*').forEach(el => {
      if (opts.length >= 14) return;
      let t;
      try { t = (el.innerText || el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); } catch(e){ return; }
      if (!t || t.length > 12) return;                       // short only — option cells, not containers
      if (/^(yes|no)\b/.test(t) || t === '1' || t === '2' || t === 'yes 1' || t === 'no 2') {
        // Only leaf-ish nodes (few children) to avoid dumping wrappers.
        if (el.childElementCount <= 3) opts.push(_descEl(el));
      }
    });
    console.log('[HBSN DIAG] Yes/No option candidates (' + opts.length + '):\n' + opts.join('\n'));

    // 3) All custom elements (tag has a dash) — SBI may use a bespoke web component.
    const customs = [];
    deepQueryAll(document, '*').forEach(el => {
      if (customs.length >= 12) return;
      if (el.tagName && el.tagName.includes('-')) customs.push(el.tagName.toLowerCase());
    });
    console.log('[HBSN DIAG] custom elements: ' + [...new Set(customs)].join(', '));

    const ifr = document.querySelectorAll('iframe');
    console.log('[HBSN DIAG] nested iframes: ' + ifr.length);
    console.log('[HBSN DIAG] body text (first 250): ' + ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 250));
    return { groups, opts, customs };
  }
  try { window.__hbsnDiag = hbsnDiag; } catch(e){}

  function doAnswerEverywhere(choice){
    // 1) Direct DOM click first (crowd-radio-button by value, radios, etc.)
    if(doAnswerInDoc(document,choice)) return true;
    for(const ifr of document.querySelectorAll('iframe')){
      try{if(doAnswerInDoc(ifr.contentDocument,choice)) return true;}catch(e){}
    }

    // 2) SBI shortcut panel? Fire the keyboard shortcut and TREAT IT AS ANSWERED.
    // The panel is designed for keyboard input only, so there is often no click target.
    // If the shortcut doesn't actually register on MTurk's side, submitLoop's
    // sticky-click limit (MAX_CLICK_STICKY_TRIES) will detect the failure and return
    // the HIT — we won't hang forever waiting for a DOM element that will never exist.
    if (isSBIShortcutPanel()) {
      const k = choice === 'yes' ? '1' : '2';
      try { fireKey(k); } catch(e) {}
      // Fire again after brief delays — some listeners register late or debounce.
      setTimeout(() => { try { fireKey(k); } catch(e) {} }, 120);
      setTimeout(() => { try { fireKey(k); } catch(e) {} }, 350);
      return true;
    }

    // 3) Non-SBI: keyboard fallback + one more DOM sweep.
    try { fireKey(choice === 'yes' ? '1' : '2'); } catch(e) {}
    if(doAnswerInDoc(document,choice)) return true;
    for(const ifr of document.querySelectorAll('iframe')){
      try{if(doAnswerInDoc(ifr.contentDocument,choice)) return true;}catch(e){}
    }
    return false;
  }

  // Helper — RETURN the current HIT (used when we can't answer). Returning is
  // MTurk-neutral: no rejection stat, no bad submission. Better than force-submit
  // with no answer selected (which MTurk rejects).
  function returnCurrentHIT() {
    try {
      const scr = document.createElement('script');
      scr.textContent = 'window.confirm = function() { return true; };';
      document.documentElement.appendChild(scr); scr.remove();
    } catch (e) {}
    GM_setValue('hbsn_returned', (GM_getValue('hbsn_returned', 0)) + 1);
    const btn = findReturnButton();
    if (btn) { try { btn.click(); } catch (e) {} return true; }
    const m = url.match(/assignments\/([A-Z0-9]+)/i);
    if (m) { try { location.href = 'https://worker.mturk.com/assignments/' + m[1] + '/return'; } catch (e) {} return true; }
    return false;
  }

  /* ═══════════════════════════════════════
     ★ SUBMIT ENGINE
  ═══════════════════════════════════════ */
  function submitLoop(n, clickedCount){
    clickedCount = clickedCount || 0;

    if(n > MAX_SUBMIT_TRIES){
      taskStatus('⚠️ All submit methods exhausted — trying external submit…');
      if(externalSubmit()){
        taskStatus('🚀 External submit fired! Waiting for redirect...');
      } else {
        taskStatus('❌ Could not submit — returning HIT');
        setTimeout(returnCurrentHIT, 300);
      }
      return;
    }

    // Submit was clicked several times AND the page hasn't navigated. Either
    // the answer never registered (crowd-form validation blocks) or MTurk is
    // silently rejecting. Return the HIT so we don't hang or garbage-submit.
    if (clickedCount >= MAX_CLICK_STICKY_TRIES) {
      taskStatus('⚠️ Submit clicks not navigating — returning HIT');
      setTimeout(returnCurrentHIT, 300);
      return;
    }

    let clicked = false;
    if(attemptSubmit(document)){
      clicked = true;
    } else {
      for(const ifr of document.querySelectorAll('iframe')){
        try{
          if(attemptSubmit(ifr.contentDocument)){ clicked = true; break; }
        }catch(e){}
      }
    }

    if (clicked) {
      console.log('[HBSN] 🚀 Submit button clicked natively. (attempt ' + (clickedCount + 1) + ')');
      taskStatus('🚀 Submit clicked! Waiting for page to redirect...');
      showFlash('🚀','#22c55e');
      setTimeout(() => submitLoop(n+1, clickedCount + 1), 6000);
    } else {
      setTimeout(()=>submitLoop(n+1, clickedCount), SUBMIT_RETRY_MS);
    }
  }

  function attemptSubmit(doc){
    if(!doc) return false;

    let btn = findSubmitBtn(doc) || doc.querySelector('crowd-button[form-action="submit"]');
    if(btn){
      btn.removeAttribute('disabled');
      btn.disabled = false;
      btn.click();
      return true;
    }

    const cf = doc.querySelector('crowd-form');
    if(cf && cf.shadowRoot){
      const shadowBtn = cf.shadowRoot.querySelector('button[type="submit"], input[type="submit"], button');
      if(shadowBtn){
        shadowBtn.removeAttribute('disabled');
        shadowBtn.disabled = false;
        shadowBtn.click();
        return true;
      }
    }

    for(const form of doc.querySelectorAll('form')){
      const action = (form.action||'').toLowerCase();
      if(action.includes('mturk') || action.includes('submit') || action.includes('external') || action.length > 10){
        try{form.requestSubmit();return true;}catch(e){
          try{form.submit();return true;}catch(e2){}
        }
      }
    }
    return false;
  }

  function findSubmitBtn(doc){
    if(!doc) return null;
    let el;
    for(const id of['submitButton','submit-button','hit-submit','submit_button','submitHit','submit']){
      el=doc.getElementById(id);if(el&&isVisOrHasSize(el))return el;
    }
    el=doc.querySelector('input[type="submit"]');if(el&&isVisOrHasSize(el))return el;
    el=doc.querySelector('button[type="submit"]');if(el&&isVisOrHasSize(el))return el;
    for(const b of doc.querySelectorAll('button,a,input,span,div,[role="button"]')){
      const t=(b.textContent||b.value||'').trim();
      if(/^submit(\s*(hit|task|answer|assignment))?$/i.test(t)&&isVisOrHasSize(b))return b;
    }
    for(const b of doc.querySelectorAll('button,input,a,[role="button"]')){
      const t=(b.textContent||b.value||'').trim().toLowerCase();
      if(t.includes('submit')&&t.length<40&&isVisOrHasSize(b))return b;
    }
    el=doc.querySelector('[class*="submit" i],[name*="submit" i]');
    if(el&&isVisOrHasSize(el))return el;
    return null;
  }

  function externalSubmit(){
    const params = new URLSearchParams(window.location.search);
    const assignmentId = params.get('assignmentId') ||
      document.querySelector('input[name="assignmentId"]')?.value ||
      url.match(/assignments\/([A-Z0-9]+)/i)?.[1];
    const turkSubmitTo = params.get('turkSubmitTo') || 'https://www.mturk.com';

    if(!assignmentId){ return false; }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = turkSubmitTo.replace(/\/$/,'') + '/mturk/externalSubmit';

    function addHidden(name,val){
      const inp=document.createElement('input');
      inp.type='hidden';inp.name=name;inp.value=val;
      form.appendChild(inp);
    }
    addHidden('assignmentId', assignmentId);

    document.querySelectorAll('input[name],select[name],textarea[name]').forEach(inp=>{
      if(inp.name!=='assignmentId'){
        addHidden(inp.name, inp.value||'');
      }
    });

    document.body.appendChild(form);
    form.submit();
    return true;
  }

  function findReturnButton(){
    for(const b of document.querySelectorAll('button,a,input,[role="button"]')){
      const t=(b.textContent||b.value||'').trim().toLowerCase();
      if(t.includes('return')&&isVis(b))return b;
    }
    return null;
  }

  function forceCloseTab(){
    let assignId = getAssignIdFromUrl(window.location.href);
    if(assignId) removeActiveTask(assignId);
    
    try{window.close();}catch(e){}
    setTimeout(()=>{try{window.open('','_self');window.close();}catch(e){}},150);
  }

  /* ═══════════════════════════════════════
     ★ TASK PARENT
  ═══════════════════════════════════════ */
  function runParent(){
    let done=false;
    const ver=getVer();

    // ★ Wake the iframe answer engine. The SBI crowd-form lives in a cross-origin
    // iframe; it self-detects HIT content now, but we ALSO set hbsn_time (its legacy
    // gate) and postMessage HBSN_RUN so it fires the instant it's ready — belt and
    // suspenders. Refresh hbsn_time so the 60s freshness window never lapses.
    GM_setValue('hbsn_time', Date.now());
    const _timeRefresh = setInterval(() => GM_setValue('hbsn_time', Date.now()), 3000);
    function signalIframes(){
      document.querySelectorAll('iframe').forEach(f => {
        try { f.contentWindow.postMessage({ type: 'HBSN_RUN' }, '*'); } catch(e){}
      });
    }
    signalIframes();
    setTimeout(signalIframes, 1500);
    setTimeout(signalIframes, 3500);

    window.addEventListener('beforeunload', () => {
        let assignId = getAssignIdFromUrl(window.location.href) || window.location.href;
        removeActiveTask(assignId);
        try { clearInterval(_timeRefresh); } catch(e){}
    });

    // ★ HARD NO-HANG GUARANTEE. Whatever happens with answering/submitting, this HIT
    // tab will not sit open forever. If it hasn't finished (submitted or returned)
    // within HIT_HARD_LIMIT_MS, force-return it and close so the queue keeps flowing.
    // Skipped while a captcha is actively being solved.
    const HIT_HARD_LIMIT_MS = 45000;
    const _hardLimit = setTimeout(() => {
      if (done) return;
      done = true;
      try { clearInterval(_timeRefresh); } catch(e){}
      console.warn('[HBSN] Hard 45s limit — returning stuck HIT');
      taskStatus('⏰ Stuck 45s — returning HIT');
      returnCurrentHIT();
      setTimeout(() => { try { forceCloseTab(); } catch(e){} }, 2500);
    }, HIT_HARD_LIMIT_MS);
    window.addEventListener('beforeunload', () => { try { clearTimeout(_hardLimit); } catch(e){} });

    addTaskUI('…','🔍 Scanning…');
    taskStatus('⏳ Waiting for page to load…');

    /* Cross-Origin Iframe Detection */
    window.addEventListener('message',e=>{
        if(e.data?.type==='HBSN_FORCE_RETURN' && !done){
            done=true;
            GM_setValue('hbsn_total',(GM_getValue('hbsn_total',0))+1);
            GM_setValue('hbsn_returned',(GM_getValue('hbsn_returned',0))+1);
            taskStatus(`🔁 MATCH → RETURNING (Detected in Iframe)`);
            showFlash('🔁','#f6ad55');
            updateTaskUIChoice('return','📝 "26 Item Match"');

            setTimeout(()=>{
                try {
                    const scr = document.createElement('script');
                    scr.textContent = 'window.confirm = function() { return true; };';
                    document.documentElement.appendChild(scr); scr.remove();
                } catch(e){}

                const btn=findReturnButton();
                if(btn){
                    btn.click(); 
                    return;
                }
                const m=url.match(/assignments\/([A-Z0-9]+)/i);
                if(m){
                    location.href=`https://worker.mturk.com/assignments/${m[1]}/return`;
                    return;
                }
            },600);
        }

        if(e.data?.type==='HBSN_DONE'&&!done){
            done=true;
            const ch=GM_getValue('hbsn_choice','yes');
            taskStatus('✅ Answered via iframe! Submitting…');
            showFlash(ch==='yes'?'✅ YES':'❌ NO',ch==='yes'?'#68d391':'#fc8181');

            document.querySelectorAll('iframe').forEach(f=>{
                try{f.contentWindow.postMessage({type:'HBSN_SUBMIT'},'*');}catch(err){}
            });
            setTimeout(()=>submitLoop(0),WAIT_SUBMIT);
        }
    });

    waitForReady(()=>{
      if(done) return;
      const sortedEntries=getDBSorted();
      const pageText=getPageText();

      /* ═══ STRICT 26 TEXT CHECK ═══ */
      const cleanPageText = pageText.toLowerCase().replace(/[^a-z0-9]/g, '');
      let matched26 = null;
      for (let i = 0; i < RETURN_PHRASES_26.length; i++) {
         const cleanPhrase = RETURN_PHRASES_26[i].toLowerCase().replace(/[^a-z0-9]/g, '');
         if (cleanPageText.includes(cleanPhrase)) {
             matched26 = RETURN_PHRASES_26[i];
             break;
         }
      }

      if (matched26) {
         done=true;
         GM_setValue('hbsn_total',(GM_getValue('hbsn_total',0))+1);
         GM_setValue('hbsn_returned',(GM_getValue('hbsn_returned',0))+1);
         const label=matched26.length>28?matched26.slice(0,26)+'…':matched26;
         taskStatus(`🔁 26-LIST MATCH → RETURNING`);
         showFlash('🔁','#f6ad55');
         updateTaskUIChoice('return','📝 "'+label+'"');

         setTimeout(()=>{
           try {
               const scr = document.createElement('script');
               scr.textContent = 'window.confirm = function() { return true; };';
               document.documentElement.appendChild(scr); scr.remove();
           } catch(e){}

           const btn=findReturnButton();
           if(btn){ btn.click(); return; }
           const m=url.match(/assignments\/([A-Z0-9]+)/i);
           if(m){ location.href=`https://worker.mturk.com/assignments/${m[1]}/return`; return; }
         },600);
         return;
      }

      /* ═══ V2: match → RETURN ═══ */
      if(ver==='v2'){
        const matched=matchKeywordsV2(pageText,sortedEntries);
        if(matched){
          done=true;
          GM_setValue('hbsn_total',(GM_getValue('hbsn_total',0))+1);
          GM_setValue('hbsn_returned',(GM_getValue('hbsn_returned',0))+1);
          const label=matched.length>28?matched.slice(0,26)+'…':matched;
          taskStatus(`🔁 MATCH → RETURNING`);
          showFlash('🔁','#f6ad55');
          updateTaskUIChoice('return','📝 "'+label+'"');

          setTimeout(()=>{
            try {
               const scr = document.createElement('script');
               scr.textContent = 'window.confirm = function() { return true; };';
               document.documentElement.appendChild(scr); scr.remove();
            } catch(e){}

            const btn=findReturnButton();
            if(btn){ btn.click(); return; }
            const m=url.match(/assignments\/([A-Z0-9]+)/i);
            if(m){ location.href=`https://worker.mturk.com/assignments/${m[1]}/return`; return; }
          },600);
          return;
        }
        taskStatus('🎲 No match (V2) — randomising…');
      }

      /* ═══ V1 + V2-no-match: answer + submit ═══ */
      const match=matchKeywords(pageText,sortedEntries);
      const choice=match?match.answer:weightedChoice();
      const source=match?`📝 "${match.phrase.length>22?match.phrase.slice(0,20)+'…':match.phrase}"`:'🎲 Random';

      GM_setValue('hbsn_choice',choice);
      GM_setValue('hbsn_total',(GM_getValue('hbsn_total',0))+1);
      if(choice==='yes') GM_setValue('hbsn_yes',(GM_getValue('hbsn_yes',0))+1);
      else               GM_setValue('hbsn_no', (GM_getValue('hbsn_no', 0))+1);

      updateTaskUIChoice(choice,source);
      taskStatus(`${source} → ${choice.toUpperCase()} — answering…`);
      showFlash(choice==='yes'?'✅ YES':'❌ NO',choice==='yes'?'#68d391':'#fc8181');

      if(doAnswerEverywhere(choice)){
        done=true;
        taskStatus('✅ Answered! Waiting '+WAIT_SUBMIT+'ms before submit…');
        setTimeout(()=>{
          taskStatus('🚀 Now submitting…');
          document.querySelectorAll('iframe').forEach(f=>{
            try{f.contentWindow.postMessage({type:'HBSN_SUBMIT'},'*');}catch(e){}
          });
          submitLoop(0);
        }, WAIT_SUBMIT);
        return;
      }

      // Is there a cross-origin iframe we can't read? If so, the answer panel lives
      // there and the IFRAME's own engine (runIframe) will click it and postMessage
      // HBSN_DONE back. In that case the parent must be PATIENT — keep nudging the
      // iframe with HBSN_PICK and wait for its reply, rather than returning the HIT
      // out from under it. The hard 45s limit is the ultimate backstop.
      function hasCrossOriginIframe(){
        for (const f of document.querySelectorAll('iframe')) {
          try { if (!f.contentDocument) return true; } catch(e) { return true; }
        }
        return false;
      }
      const waitingOnIframe = hasCrossOriginIframe();
      if (waitingOnIframe) taskStatus('⏳ Answer is in a sub-frame — waiting for it…');
      else                 taskStatus('⏳ Answer element not found — retrying…');

      let ansRetry=0;
      const answerCap = waitingOnIframe ? 90 : ANSWER_RETRIES;   // patient (36s) vs fail-fast (4s)
      const ansTimer = setInterval(()=>{
        if(done){clearInterval(ansTimer);return;}
        ansRetry++;
        if(ansRetry > answerCap){
          clearInterval(ansTimer);
          if(!done){
            done=true;
            // Give up cleanly — RETURN the HIT (MTurk-neutral, no rejection stat).
            taskStatus('⚠️ Could not answer — returning HIT');
            showFlash('🔁','#f6ad55');
            if (choice === 'yes') GM_setValue('hbsn_yes', Math.max(0, GM_getValue('hbsn_yes', 0) - 1));
            else                  GM_setValue('hbsn_no',  Math.max(0, GM_getValue('hbsn_no',  0) - 1));
            setTimeout(returnCurrentHIT, 400);
          }
          return;
        }
        // Keep nudging every frame with the chosen answer (iframe listens for HBSN_PICK).
        document.querySelectorAll('iframe').forEach(f=>{
          try{f.contentWindow.postMessage({type:'HBSN_PICK',choice},'*');}catch(e){}
        });
        if(doAnswerEverywhere(choice)){
          done=true;
          clearInterval(ansTimer);
          taskStatus('✅ Answered on retry #'+ansRetry+'! Submitting…');
          setTimeout(()=>{
            document.querySelectorAll('iframe').forEach(f=>{
              try{f.contentWindow.postMessage({type:'HBSN_SUBMIT'},'*');}catch(e){}
            });
            submitLoop(0);
          }, WAIT_SUBMIT);
        }
      }, 400);

    });

    document.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&e.shiftKey){e.preventDefault();submitLoop(0);return;}
      if(done)return;
      if(e.key==='1'||e.key==='2'){
        e.preventDefault();done=true;
        const c=e.key==='1'?'yes':'no';
        fireKey(e.key);
        document.querySelectorAll('iframe').forEach(f=>{
          try{f.contentWindow.postMessage({type:'HBSN_PICK',choice:c},'*');}catch(ex){}
        });
        setTimeout(()=>{
          document.querySelectorAll('iframe').forEach(f=>{
            try{f.contentWindow.postMessage({type:'HBSN_SUBMIT'},'*');}catch(ex){}
          });
          submitLoop(0);
        },WAIT_SUBMIT);
      }
    });
  }

  function waitForReady(cb){
    const start = Date.now();
    function check(){
      if(Date.now()-start < WAIT_LOAD){ setTimeout(check,300); return; }
      const cf = document.querySelector('crowd-form');
      if(cf && !cf.shadowRoot && (Date.now()-start < WAIT_LOAD+3000)){
        setTimeout(check,300); return;
      }
      const iframes = document.querySelectorAll('iframe');
      for(const f of iframes){
        try{
          const icf = f.contentDocument?.querySelector('crowd-form');
          if(icf && !icf.shadowRoot && (Date.now()-start < WAIT_LOAD+3000)){
            setTimeout(check,300); return;
          }
        }catch(e){}
      }
      cb();
    }
    check();
  }

  function updateTaskUIChoice(choice,source){
    const isReturn=choice==='return';
    const pc=isReturn?'#f6ad55':choice==='yes'?'#68d391':'#fc8181';
    const label=isReturn?'🔁 RETURN':choice.toUpperCase();
    const o=document.getElementById('hbsn-t');if(!o)return;
    o.innerHTML=`🎯 <b>${TOOL_NAME} ${getVer().toUpperCase()}</b> | ${source} → <b style="color:${pc}">${label}</b> | 📊${GM_getValue('hbsn_total',0)} ✅${GM_getValue('hbsn_yes',0)} ❌${GM_getValue('hbsn_no',0)} 🔁${GM_getValue('hbsn_returned',0)}<div id="hbsn-ts">Running…</div>`;
  }

  /* ═══════════════════════════════════════
     IFRAME HANDLER
  ═══════════════════════════════════════ */
  function runIframe(){
    if(window.__hbsnIframeRan) return;      // don't start the answer engine twice
    window.__hbsnIframeRan = true;
    const choice=GM_getValue('hbsn_choice','yes');
    setTimeout(() => { try { hbsnDiag(); } catch(e){} }, WAIT_LOAD + 500);  // one-time structure dump for debugging

    const rawText = document.body.innerText || "";
    const cleanText = rawText.toLowerCase().replace(/[^a-z0-9]/g, '');
    let iframeMatched = false;
    for (let i = 0; i < RETURN_PHRASES_26.length; i++) {
       const cleanPhrase = RETURN_PHRASES_26[i].toLowerCase().replace(/[^a-z0-9]/g, '');
       if (cleanText.includes(cleanPhrase)) {
           iframeMatched = true;
           break;
       }
    }
    if (iframeMatched) {
        try { window.top.postMessage({type:'HBSN_FORCE_RETURN'},'*'); } catch(e){}
    }

    window.addEventListener('message',e=>{
      if(e.data?.type==='HBSN_PICK'){
        if(doAnswerInDoc(document,e.data.choice)) setTimeout(tellParent,200);
      }
      if(e.data?.type==='HBSN_SUBMIT'){
        setTimeout(()=>submitLoop(0), 200);
      }
    });
    setTimeout(()=>answerLoop(choice,0),WAIT_LOAD);
  }

  function answerLoop(c,n){
    if(n>=ANSWER_RETRIES){fireKey(c==='yes'?'1':'2');setTimeout(tellParent,500);return;}
    // doAnswerEverywhere (not just doAnswerInDoc) so a keyboard-only SBI panel gets its
    // shortcut fired HERE, inside the iframe where MTurk's key listener actually lives.
    if(doAnswerEverywhere(c)) setTimeout(tellParent,200);
    else setTimeout(()=>answerLoop(c,n+1),RETRY_MS);
  }
  function tellParent(){try{window.top.postMessage({type:'HBSN_DONE'},'*');}catch(e){}}

  /* ═══════════════════════════════════════
     UTILITY (Enhanced Key Events)
  ═══════════════════════════════════════ */
  function fireKey(key){
    const kc=key.charCodeAt(0);
    const events = ['keydown', 'keypress', 'keyup'];
    // MTurk's SBI keyboard listener could be registered on any of these — dispatch to
    // ALL of them so at least one hits. Missed targets in v37.2 that caused the
    // "Submit clicked but nothing happened" bug: document itself, <crowd-form> and
    // its shadow root, and iframe contents.
    const targets = [document, document.activeElement, document.body, document.documentElement, window];
    document.querySelectorAll('crowd-form').forEach(cf => {
      targets.push(cf);
      if (cf.shadowRoot) targets.push(cf.shadowRoot);
    });
    document.querySelectorAll('iframe').forEach(ifr => {
      try {
        if (ifr.contentDocument) { targets.push(ifr.contentDocument, ifr.contentDocument.body, ifr.contentDocument.documentElement); }
        if (ifr.contentWindow)   { targets.push(ifr.contentWindow); }
      } catch (e) {}
    });
    targets.filter(Boolean).forEach(t => {
        events.forEach(ev => {
            try {
                t.dispatchEvent(new KeyboardEvent(ev, {
                    key: key, code: 'Digit' + key, keyCode: kc, which: kc, charCode: ev === 'keypress' ? kc : 0,
                    bubbles: true, cancelable: true, composed: true
                }));
            } catch (e) {}
        });
    });
  }

  function isVis(el){
    if(!el)return false;
    try{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&el.offsetHeight>0;}
    catch(e){return false;}
  }
  function isVisOrHasSize(el){
    if(!el)return false;
    if(isVis(el))return true;
    try{const r=el.getBoundingClientRect();return r.width>0||r.height>0;}catch(e){return false;}
  }

  /* ═══════════════════════════════════════
     DB MANAGER PANEL
  ═══════════════════════════════════════ */
  function addDBManagerUI(){
    const fab=document.createElement('button');fab.id='hbsn-db-toggle';fab.textContent='📝';fab.title='Rule Manager';document.body.appendChild(fab);
    const panel=document.createElement('div');panel.id='hbsn-db';
    panel.innerHTML=`
      <div id="hbsn-ver-switch-wrap">
        <span style="font-size:11px;color:#94a3b8;margin-right:8px">Mode:</span>
        <button id="hbsn-ver-v1" class="hbsn-ver-btn"><span style="color:#22c55e;font-size:15px;font-weight:900;margin-right:4px">➕</span>V1 — Answer &amp; Submit</button>
        <button id="hbsn-ver-v2" class="hbsn-ver-btn"><span style="color:#f6ad55;font-size:15px;font-weight:900;margin-right:4px">🔁</span>V2 — Return on Match</button>
      </div>
      <div id="hbsn-ver-desc" style="font-size:10px;color:#64748b;margin:6px 0 10px;min-height:14px"></div>
      <h3>📝 Keyword Rule DB</h3>
      <p style="font-size:11px;color:#94a3b8;margin:0 0 10px">Body-only · Case-insensitive · Longest match first<br><span id="hbsn-mode-note"></span></p>
      <label>Phrase to match</label>
      <input type="text" id="hbsn-phrase-input" placeholder='e.g. "nike running shoes"'>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <select id="hbsn-phrase-ans"><option value="yes">✅ YES</option><option value="no">❌ NO</option></select>
        <button id="hbsn-phrase-add">➕ Add</button>
        <button id="hbsn-phrase-clear" class="del">🗑️ Clear All</button>
        <button id="hbsn-phrase-reset" class="sec">↺ Defaults</button>
      </div>
      <label>Active rules <span id="hbsn-rule-count" style="color:#475569;font-weight:normal"></span></label>
      <div id="hbsn-rule-list"><i style="color:#64748b;font-size:11px">Loading…</i></div>
      <div id="hbsn-test-header"><span style="font-size:12px;color:#fbbf24;font-weight:bold">🧪 Test — Paste Text</span><span id="hbsn-test-chevron">▼ Show</span></div>
      <div id="hbsn-test-body" style="display:none"><div id="hbsn-test-box">
        <textarea id="hbsn-test-text" placeholder="Paste HIT body text here…"></textarea>
        <div style="display:flex;gap:6px"><button id="hbsn-test-run">🔍 Test</button><button id="hbsn-test-clear-btn" class="sec">✕ Clear</button></div>
        <div id="hbsn-test-result"></div>
      </div></div>`;
    document.body.appendChild(panel);

    function refreshVerUI(){
      const v=getVer(),v1b=document.getElementById('hbsn-ver-v1'),v2b=document.getElementById('hbsn-ver-v2'),desc=document.getElementById('hbsn-ver-desc'),note=document.getElementById('hbsn-mode-note');
      if(v==='v1'){v1b.style.cssText+=';background:#052e16!important;border-color:#22c55e!important;color:#86efac!important';v2b.style.cssText+=';background:#1e293b!important;border-color:#334155!important;color:#94a3b8!important';desc.textContent='✅ V1 — Match → answer YES/NO per rule → submit.';note.innerHTML=`No match → random <b>${YES_PERCENT}% YES</b> / <b>${100-YES_PERCENT}% NO</b>.`;}
      else{v2b.style.cssText+=';background:#451a03!important;border-color:#f6ad55!important;color:#fde68a!important';v1b.style.cssText+=';background:#1e293b!important;border-color:#334155!important;color:#94a3b8!important';desc.textContent='🔁 V2 — ANY match → RETURN HIT. No match → random → submit.';note.innerHTML=`Match → <b style="color:#f6ad55">🔁 RETURN</b> always. No match → random <b>${YES_PERCENT}% YES</b>.`;}
      const badge=document.getElementById('hbsn-ver-badge');
      if(badge){badge.textContent=v==='v1'?'➕V1':'🔁V2';badge.style.color=v==='v1'?'#22c55e':'#f6ad55';}
    }

    document.getElementById('hbsn-ver-v1').addEventListener('click',()=>{setVer('v1');refreshVerUI();});
    document.getElementById('hbsn-ver-v2').addEventListener('click',()=>{setVer('v2');refreshVerUI();});
    fab.addEventListener('click',()=>{
      const open=panel.style.display!=='none';
      panel.style.display=open?'none':'block';
      if(!open){renderRuleList();refreshVerUI();}
    });
    document.getElementById('hbsn-test-header').addEventListener('click',()=>{const b=document.getElementById('hbsn-test-body'),ch=document.getElementById('hbsn-test-chevron'),op=b.style.display!=='none';b.style.display=op?'none':'block';ch.textContent=op?'▼ Show':'▲ Hide';});
    document.getElementById('hbsn-phrase-add').addEventListener('click',()=>{const phrase=document.getElementById('hbsn-phrase-input').value.trim(),ans=document.getElementById('hbsn-phrase-ans').value;if(!phrase){alert('Enter a phrase.');return;}const db=getDB();db[phrase.toLowerCase()]=ans;saveDB(db);document.getElementById('hbsn-phrase-input').value='';renderRuleList();});
    document.getElementById('hbsn-phrase-input').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('hbsn-phrase-add').click();});
    document.getElementById('hbsn-phrase-clear').addEventListener('click',()=>{if(!confirm('Delete ALL rules?'))return;saveDB({});renderRuleList();});
    document.getElementById('hbsn-phrase-reset').addEventListener('click',()=>{if(!confirm('Merge defaults back in?'))return;saveDB({...getDB(),...DEFAULT_DB});renderRuleList();});
    document.getElementById('hbsn-test-run').addEventListener('click',()=>{const t=document.getElementById('hbsn-test-text').value;if(!t.trim()){showResult(document.getElementById('hbsn-test-result'),'nomatch','⚠️ Paste some text first.');return;}runTextTest(t,'hbsn-test-result');});
    document.getElementById('hbsn-test-clear-btn').addEventListener('click',()=>{document.getElementById('hbsn-test-text').value='';document.getElementById('hbsn-test-result').style.display='none';});
    renderRuleList();refreshVerUI();
  }

  function renderRuleList(){
    const list=document.getElementById('hbsn-rule-list');if(!list)return;
    const count=document.getElementById('hbsn-rule-count'),entries=getDBSorted();
    if(count)count.textContent=` (${entries.length})`;
    if(!entries.length){list.innerHTML='<i style="color:#64748b;font-size:11px">No rules yet.</i>';return;}
    list.innerHTML=entries.map(([phrase,ans],i)=>{const ac=ans==='yes'?'#22c55e':'#ef4444',al=ans==='yes'?'✅ YES':'❌ NO';return`<div class="hbsn-rule-row"><span style="color:#64748b;font-size:10px;min-width:18px;flex-shrink:0">${i+1}</span><span class="hbsn-rule-phrase">${escHtml(phrase)}</span><button class="hbsn-toggle-ans" data-phrase="${escHtml(phrase)}" data-ans="${ans}" style="background:${ac};color:#fff;border:none;border-radius:5px;padding:2px 8px;font-size:10px;font-weight:bold;cursor:pointer;flex-shrink:0;min-width:52px">${al}</button><button class="del hbsn-del-rule" data-phrase="${escHtml(phrase)}" style="padding:2px 8px;font-size:10px;flex-shrink:0">✕</button></div>`;}).join('');
    list.querySelectorAll('.hbsn-toggle-ans').forEach(btn=>{btn.addEventListener('click',()=>{const db2=getDB();db2[btn.dataset.phrase]=btn.dataset.ans==='yes'?'no':'yes';saveDB(db2);renderRuleList();});});
    list.querySelectorAll('.hbsn-del-rule').forEach(btn=>{btn.addEventListener('click',()=>{const db2=getDB();delete db2[btn.dataset.phrase];saveDB(db2);renderRuleList();});});
  }
  function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function runTextTest(rawText,resultId){const text=rawText.toLowerCase(),entries=getDBSorted(),el=document.getElementById(resultId);if(!el)return;if(!entries.length){showResult(el,'nomatch','⚠️ No rules yet.');return;}const matched=[];let miss=0;for(const[phrase,ans]of entries){if(text.includes(phrase))matched.push({phrase,ans});else miss++;}if(matched.length){const first=matched[0],fc=first.ans==='yes'?'#22c55e':'#ef4444';const modeNote=isV2()?`<div style="font-size:11px;color:#f6ad55;margin-top:4px">🔁 V2 — will <b>RETURN</b></div>`:`<div style="font-size:11px;color:${fc};margin-top:4px">➕ V1 — will answer <b>${first.ans.toUpperCase()}</b> and submit</div>`;showResult(el,'match',`✅ <b style="color:${fc};font-size:13px">MATCH</b><br><code style="color:#fbbf24">"${escHtml(first.phrase)}"</code>${modeNote}`)}else{showResult(el,'nomatch',`🎲 <b style="color:#94a3b8">NO MATCH</b> — random (${YES_PERCENT}% YES)<br><span style="font-size:10px;color:#475569">Checked ${entries.length} rule(s).</span>`);}}
  function showResult(el,type,html){el.className=type;el.innerHTML=html;el.style.display='block';}

  /* ═══════════════════════════════════════
     STYLES
  ═══════════════════════════════════════ */
  function addQueueUI(){
    const y=GM_getValue('hbsn_yes',0),n=GM_getValue('hbsn_no',0),t=GM_getValue('hbsn_total',0),r=GM_getValue('hbsn_returned',0),ver=getVer();
    GM_addStyle(`
      #hbsn-q{position:fixed;top:0;left:0;right:0;z-index:999999;background:#0f172a;color:#f1f5f9;font:14px 'Segoe UI',sans-serif;padding:8px 18px;display:flex;align-items:center;gap:12px;border-bottom:3px solid #f59e0b;box-sizing:border-box}
      #hbsn-qd{width:12px;height:12px;border-radius:50%;flex-shrink:0}
      #hbsn-ver-badge{font-size:12px;font-weight:900;letter-spacing:.5px}
      #hbsn-stats{margin-left:auto;font-size:12px;color:#94a3b8}
      body{padding-top:46px!important}
      @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
      #hbsn-pause-btn{background:#f59e0b;color:#0f172a;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;font-weight:bold;font-size:12px}
      #hbsn-db{position:fixed;bottom:76px;right:16px;z-index:999998;background:#1e293b;color:#f1f5f9;font:13px 'Segoe UI',sans-serif;border:2px solid #f59e0b;border-radius:12px;padding:18px;width:490px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px #000a;display:none}
      #hbsn-db h3{margin:0 0 6px;font-size:14px;color:#fbbf24}
      #hbsn-db label{font-size:11px;color:#94a3b8;display:block;margin-bottom:3px}
      #hbsn-db input[type="text"]{background:#0f172a;color:#f1f5f9;border:1px solid #475569;border-radius:6px;padding:6px 9px;font-size:12px;width:100%;box-sizing:border-box;margin-bottom:6px}
      #hbsn-db select{background:#0f172a;color:#f1f5f9;border:1px solid #475569;border-radius:6px;padding:5px 7px;font-size:12px}
      #hbsn-db button{background:#f59e0b;color:#0f172a;border:none;border-radius:6px;padding:5px 12px;cursor:pointer;font-weight:bold;font-size:12px;margin:2px}
      #hbsn-db button:hover{opacity:.85}
      #hbsn-db button.del{background:#ef4444;color:#fff}
      #hbsn-db button.sec{background:#334155;color:#f1f5f9}
      #hbsn-ver-switch-wrap{display:flex;align-items:center;flex-wrap:wrap;gap:6px;background:#0f172a;border-radius:8px;padding:10px 12px;margin-bottom:4px;border:1px solid #334155}
      .hbsn-ver-btn{border:2px solid #334155!important;border-radius:8px!important;background:#1e293b!important;color:#94a3b8!important;padding:5px 12px!important;font-size:12px!important;font-weight:bold!important;cursor:pointer;display:flex;align-items:center;transition:all .15s}
      #hbsn-rule-list{max-height:240px;overflow-y:auto;margin-top:6px;margin-bottom:12px}
      .hbsn-rule-row{display:flex;align-items:center;gap:6px;padding:5px 3px;border-bottom:1px solid #1e293b}
      .hbsn-rule-row:last-child{border-bottom:none}
      .hbsn-rule-phrase{flex:1;font-size:10px;color:#f1f5f9;word-break:break-all;font-family:monospace;background:#0f172a;border-radius:4px;padding:2px 5px}
      #hbsn-test-header{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;padding:8px 0 4px;border-top:1px solid #334155;margin-top:4px}
      #hbsn-test-chevron{font-size:11px;color:#64748b}
      #hbsn-test-body{margin-top:6px}
      #hbsn-test-box{background:#0f172a;border-radius:8px;border:1px solid #334155;padding:12px}
      #hbsn-test-box textarea{background:#1e293b;color:#f1f5f9;border:1px solid #475569;border-radius:6px;padding:7px 9px;font-size:12px;width:100%;box-sizing:border-box;margin-bottom:6px;font-family:monospace;resize:vertical;min-height:72px}
      #hbsn-test-result{margin-top:8px;border-radius:7px;padding:10px 12px;font-size:12px;line-height:1.8;display:none}
      #hbsn-test-result.match{background:#052e16;border:1px solid #22c55e}
      #hbsn-test-result.nomatch{background:#1e293b;border:1px solid #475569}
      #hbsn-db-toggle{position:fixed;bottom:16px;right:16px;z-index:999999;background:#f59e0b;color:#0f172a;border:none;border-radius:50%;width:44px;height:44px;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px #0008;font-weight:900}
      #hbsn-db-toggle:hover{transform:scale(1.08)}`);
    const bar=document.createElement('div');bar.id='hbsn-q';
    const vc=ver==='v1'?'#22c55e':'#f6ad55',vl=ver==='v1'?'➕V1':'🔁V2';
    bar.innerHTML=`<div id="hbsn-qd"></div><span id="hbsn-ver-badge" style="color:${vc}">${vl}</span><span id="hbsn-qm">Starting…</span><button id="hbsn-pause-btn">${isPaused()?'▶️ Resume':'⏸️ Pause'}</button><span id="hbsn-stats">✅${y} ❌${n} 📊${t} 🔁${r}</span>`;
    document.body.prepend(bar);
    document.getElementById('hbsn-pause-btn').addEventListener('click',()=>setPaused(!isPaused()));
    updatePauseBtn();
  }

  function addTaskUI(choice,source){
    const y=GM_getValue('hbsn_yes',0),n=GM_getValue('hbsn_no',0),t=GM_getValue('hbsn_total',0),ver=getVer().toUpperCase();
    GM_addStyle(`
      #hbsn-t{position:fixed;bottom:60px;right:16px;z-index:999999;background:#0f172a;color:#f1f5f9;font:13px 'Segoe UI',monospace;padding:14px 18px;border-radius:12px;border:2px solid #f59e0b;line-height:1.9;min-width:260px;box-shadow:0 4px 20px #0009}
      #hbsn-ts{margin-top:6px;font-size:12px;color:#7dd3fc;font-weight:bold}
      #hbsn-fl{position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);z-index:999999;font-size:100px;font-weight:900;opacity:0;transition:opacity .2s;pointer-events:none;text-shadow:0 0 60px currentColor}
      #hbsn-submit-btn{position:fixed;bottom:16px;left:16px;z-index:999999;background:#f59e0b;color:#0f172a;border:none;border-radius:8px;padding:10px 22px;font-size:14px;font-weight:900;cursor:pointer;box-shadow:0 4px 14px #0009;letter-spacing:.5px;font-family:'Segoe UI',sans-serif}
      #hbsn-submit-btn:hover{opacity:.88;transform:scale(1.04)}`);
    const pc=choice==='yes'?'#68d391':'#fc8181';
    const o=document.createElement('div');o.id='hbsn-t';
    o.innerHTML=`🎯 <b>${TOOL_NAME} ${ver}</b> | ${source} <b style="color:${pc}">${choice.toUpperCase()}</b> | 📊${t} ✅${y} ❌${n}<div id="hbsn-ts">Scanning…</div>`;
    document.body.appendChild(o);
    const f=document.createElement('div');f.id='hbsn-fl';document.body.appendChild(f);

    const sb=document.createElement('button');sb.id='hbsn-submit-btn';
    sb.innerHTML='🚀 Submit';sb.title='Submit HIT (Shift+Enter)';
    document.body.appendChild(sb);
    sb.addEventListener('click',()=>{
      taskStatus('🚀 Manual submit triggered…');
      submitLoop(0);
    });
  }

  function showClosingBanner(){
    GM_addStyle(`#hbsn-closing{position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;background:#0f172a;color:#fbbf24;font:24px 'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center}`);
    const b=document.createElement('div');b.id='hbsn-closing';b.textContent='✅ Task Closed Successfully';
    try{document.body.innerHTML='';}catch(e){}
    document.body.appendChild(b);
  }
  function queueMsg(t,c){const m=document.getElementById('hbsn-qm'),d=document.getElementById('hbsn-qd');if(m)m.textContent=t;if(d){d.style.background=c;d.style.animation='blink 1s infinite';}}
  function taskStatus(t){const el=document.getElementById('hbsn-ts');if(el)el.textContent=t;console.log(`[${TOOL_NAME}]`,t);}
  function showFlash(txt,color){const el=document.getElementById('hbsn-fl');if(!el)return;el.textContent=txt;el.style.color=color;el.style.opacity='1';setTimeout(()=>el.style.opacity='0',500);}

})();
