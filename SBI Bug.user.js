// ==UserScript==
// @name         HasanBhaierSalamNin36.0
// @namespace    https://worker.mturk.com/
// @version      33.14
// @description  Queue processor. Strict 1-Tab Queue enforcement. No auto-reload. 26 strict return phrases. Processing lag fixed. Single task-tab enforced via heartbeat. Auto-captcha detect+alert+resume. Amazon "Server Busy" auto-dismiss. 20s auto-close for any MTurk tab except /tasks queue. HIT tabs open in background so /tasks stays focused. Default mode V2. Google Sheet Worker ID allowlist enforced on queue + task pages.
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
  const VERSION   = '36.0';

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
  const ANSWER_RETRIES   = 20;
  const TASK_TAB_HEARTBEAT_TTL = 8000; // task tab considered alive if heartbeat < 8s old

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
  function getVer()  { return GM_getValue('hbsn_version','v2'); }
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

  /* ─── Task-tab heartbeat (NEW) ─── */
  function isTaskTabAlive() {
    const lastBeat = GM_getValue('hbsn_task_heartbeat', 0);
    return (Date.now() - lastBeat) < TASK_TAB_HEARTBEAT_TTL;
  }
  let _hbInterval=null;
  function startTaskHeartbeat() {
    if(_hbInterval)clearInterval(_hbInterval);
    GM_setValue('hbsn_task_heartbeat', Date.now());

        _hbInterval=setInterval(() => { GM_setValue('hbsn_task_heartbeat', Date.now()); }, 2000);
  }
  function clearTaskHeartbeat() {
    GM_setValue('hbsn_task_heartbeat', 0);
  }

  function isPaused() { return GM_getValue('hbsn_paused',false); }
  function setPaused(val) {
    GM_setValue('hbsn_paused',val); updatePauseBtn();
    if (!val) { queueMsg('▶️ Resumed','#68d391'); processNextHIT(); }
    else { queueMsg('⏸️ PAUSED','#f6ad55'); }
  }
  function updatePauseBtn() {
    const btn=document.getElementById('hbsn-pause-btn'); if(!btn)return;
    const p=isPaused(); btn.textContent=p?'▶️ Resume':'⏸️ Pause';
    btn.style.background=p?'#22c55e':'#f59e0b'; btn.style.color=p?'#fff':'#0f172a';
  }

  /* ═══════════════════════════════════════
     AMAZON SERVER-BUSY AUTO-DISMISS
     Detects the "Server Busy / Continue shopping" interstitial that
     Amazon shows when the HIT iframe URL is rate-limited, clicks
     Continue, and closes the tab so the queue can move on.
     Adapted from NMSH_VACUUM v19.
  ═══════════════════════════════════════ */
  function isServerBusyPage(){
    if(!document.body) return false;
    const title=(document.title||'').toLowerCase();
    if(title.indexOf('server busy')>-1) return true;
    const text=document.body.innerText||'';
    return text.indexOf('Continue shopping')>-1;
  }

  let _serverBusyHandled=false;
  function handleServerBusy(){
    if(_serverBusyHandled) return true;
    if(!isServerBusyPage()) return false;
    _serverBusyHandled=true;
    console.warn('[HBSN] Amazon "Server Busy" detected — auto-dismissing');
    const els=document.querySelectorAll('input[type="submit"],button,a');
    for(let i=0;i<els.length;i++){
      if((els[i].textContent||els[i].value||'').indexOf('Continue')>-1){
        try{els[i].click();}catch(e){}
        break;
      }
    }
    setTimeout(()=>{
      try{markSubmitted();}catch(e){}
      try{clearTaskHeartbeat();}catch(e){}
      try{releaseLock();}catch(e){}
      try{window.close();}catch(e){}
      setTimeout(()=>{try{location.href='https://worker.mturk.com/dashboard';}catch(e){}},500);
    },1000);
    return true;
  }

  /* ═══════════════════════════════════════
     GENERAL MTURK TAB AUTO-CLOSE (20s)
     Closes ANY MTurk tab that isn't the /tasks queue page after
     20 seconds. Skips iframes and pauses if a CAPTCHA is active.
  ═══════════════════════════════════════ */
  function isMTurkQueueTab(){
    const u=location.href;
    if(u.includes('/projects/')||u.includes('/assignments/')) return false;
    return u.includes('worker.mturk.com/queue') || u.includes('worker.mturk.com/tasks')
        || u==='https://worker.mturk.com/' || u==='https://worker.mturk.com';
  }
  function isMTurkDomain(){
    return /(^|\.)mturk\.com$/i.test(location.hostname);
  }
  let _autoCloseArmed=false;
  function setupGeneralAutoClose(){
    if(_autoCloseArmed) return;
    if(!isMTurkDomain()) return;
    if(window.self!==window.top) return;
    if(isMTurkQueueTab()) return;
    _autoCloseArmed=true;
    console.log('[HBSN] 20s general auto-close armed for',location.href);
    setTimeout(()=>{
      if(CAPTCHA_SYSTEM.active){
        console.log('[HBSN] 20s auto-close: CAPTCHA active — skipping');
        return;
      }
      console.warn('[HBSN] ⏰ 20s auto-close — closing non-/tasks MTurk tab');
      try{markSubmitted();}catch(e){}
      try{clearTaskHeartbeat();}catch(e){}
      try{releaseLock();}catch(e){}
      try{window.close();}catch(e){}
      setTimeout(()=>{try{window.open('','_self');window.close();}catch(e){}},150);
    },20000);
  }

  /* ═══════════════════════════════════════
     CAPTCHA SYSTEM (auto-detect / alert / resume)
     Adapted from NMSH_VACUUM v19
  ═══════════════════════════════════════ */
  const CAPTCHA_SYSTEM = {
    active: false,
    alertTimer: null,
    solveTimer: null,
    scanTimer: null,
    wasPausedByCaptcha: false,

    hasCaptchaInText(h){
      return h ? /captchacharacters|validatecaptcha|\/captcha\/|g-recaptcha|recaptcha-checkbox|captchainput|opfcaptcha/i.test(h) : false;
    },
    hasCaptchaOnPage(){
      if(!document.body) return false;
      if(isServerBusyPage()) return false; // suppress false positive on Amazon "Server Busy" page
      if(document.querySelector('img[src*="captcha" i],iframe[src*="recaptcha"],.g-recaptcha,.recaptcha-checkbox-border,input[name="captchacharacters"],form[action*="captcha" i]')) return true;
      return /captchacharacters|CaptchaInput|validateCaptcha|opfcaptcha/i.test(document.body.innerHTML||'');
    },
    playAlert(){
      try{
        const ctx=new (window.AudioContext||window.webkitAudioContext)();
        const comp=ctx.createDynamicsCompressor();
        comp.threshold.value=-3; comp.ratio.value=15; comp.connect(ctx.destination);
        [800,1200,800,1200,600,1000,600,1400].forEach((f,i)=>{
          ['square','sawtooth'].forEach(type=>{
            const o=ctx.createOscillator(),g=ctx.createGain();
            o.type=type; o.frequency.value=f; o.connect(g); g.connect(comp);
            const t=ctx.currentTime+i*.1;
            g.gain.setValueAtTime(type==='square'?.9:.5,t);
            g.gain.exponentialRampToValueAtTime(.01,t+.09);
            o.start(t); o.stop(t+.09);
          });
        });
        setTimeout(()=>{try{ctx.close();}catch(e){}},2000);
      }catch(e){}
    },
    startRepeating(){
      this.stopRepeating();
      this.playAlert();
      this.alertTimer=setInterval(()=>{
        if(!this.active){this.stopRepeating();return;}
        this.playAlert();
      },20000);
    },
    stopRepeating(){if(this.alertTimer){clearInterval(this.alertTimer);this.alertTimer=null;}},
    showOverlay(){
      const ex=document.getElementById('hbsn-cap-ov'); if(ex) ex.remove();
      const ov=document.createElement('div'); ov.id='hbsn-cap-ov';
      ov.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647';
      ov.innerHTML='<div style="background:#c0392b;color:#fff;padding:10px;text-align:center;font:bold 16px system-ui;box-shadow:0 3px 15px rgba(0,0,0,.4)">⚠️ CAPTCHA — SOLVE NOW<span style="display:block;font-size:11px;opacity:.8;margin-top:3px">Script auto-resumes after solve</span><button id="hbsn-cap-dismiss" style="margin-left:12px;padding:3px 10px;background:#fff;color:#c0392b;border:none;border-radius:3px;font-weight:bold;cursor:pointer">OK</button></div>';
      if(document.body) document.body.appendChild(ov);
      const btn=document.getElementById('hbsn-cap-dismiss');
      if(btn) btn.addEventListener('click',()=>ov.remove());
    },
    removeOverlay(){const el=document.getElementById('hbsn-cap-ov'); if(el) el.remove();},
    startSolveMonitor(){
      if(this.solveTimer) clearInterval(this.solveTimer);
      this.solveTimer=setInterval(()=>{
        if(!this.hasCaptchaOnPage()) this.onSolved();
      },500);
    },
    stopSolveMonitor(){if(this.solveTimer){clearInterval(this.solveTimer);this.solveTimer=null;}},
    onSolved(){
      this.active=false;
      this.stopRepeating(); this.stopSolveMonitor(); this.removeOverlay();
      GM_setValue('hbsn_cap_active',0);
      console.log('[HBSN] ✓ CAPTCHA solved — auto-resuming');
      if(this.wasPausedByCaptcha){
        this.wasPausedByCaptcha=false;
        if(isPaused()) setPaused(false);
      }
    },
    activate(){
      if(this.active) return;
      this.active=true;
      GM_setValue('hbsn_cap_active',1);
      console.warn('[HBSN] ⚠ CAPTCHA detected on page!');
      if(!isPaused()){
        this.wasPausedByCaptcha=true;
        setPaused(true);
      }
      this.showOverlay(); this.startRepeating(); this.startSolveMonitor();
    },
    init(){
      if(this.scanTimer) return;
      const tryActivate=()=>{ if(this.hasCaptchaOnPage() && !this.active) this.activate(); };
      if(document.body) tryActivate();
      else document.addEventListener('DOMContentLoaded',tryActivate);
      this.scanTimer=setInterval(tryActivate,2000);
    }
  };

  function getDB()    { try{return JSON.parse(GM_getValue('hbsn_word_db','{}'));}catch(e){return{};} }
  function saveDB(db) { GM_setValue('hbsn_word_db',JSON.stringify(db)); }
  function getDBSorted() {
    return Object.entries(getDB()).filter(([p])=>p.trim().length>0).sort((a,b)=>b[0].length-a[0].length);
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
     WORKER ID
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

  /* ═══════════════════════════════════════
     CSV PARSER
  ═══════════════════════════════════════ */
  function parseCSV(txt){
    txt=(txt||'').replace(/^﻿/,'');const rows=[];
    txt.split('\n').forEach(line=>{line=line.trim();if(!line)return;const cols=[];let inQ=false,cur='';for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){inQ=!inQ;}else if(c===','&&!inQ){cols.push(cur.trim());cur='';}else cur+=c;}cols.push(cur.trim());rows.push(cols);});
    return rows;
  }

  /* ═══════════════════════════════════════
     SHEET CHECK
  ═══════════════════════════════════════ */
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

  /* ═══════════════════════════════════════
     AUTH SCREENS
  ═══════════════════════════════════════ */
  function injectAuthCSS(){
    if(document.getElementById('hbsn-auth-css'))return;
    const s=document.createElement('style');s.id='hbsn-auth-css';
    // Only the small auth-badge (bottom-right during verify) needs CSS.
    // The block/revoked banners set their styles inline in _showAuthBanner.
    s.textContent=`
      #hbsn-auth-badge{position:fixed;bottom:16px;right:16px;z-index:2147483647;background:rgba(10,10,10,.95);border:1px solid #2a2a2a;border-radius:10px;padding:10px 14px;font-family:'Segoe UI',system-ui,sans-serif;backdrop-filter:blur(6px);box-shadow:0 4px 20px rgba(0,0,0,.8);min-width:170px;text-align:center}
      .hb-logo{font:900 11px system-ui;color:#f59e0b;letter-spacing:1px}
      .hb-ver{font:600 8px system-ui;color:#444;letter-spacing:2px;margin-bottom:6px}
      .hb-wid{font:800 11px Consolas,monospace;color:#f59e0b;margin-bottom:4px;min-height:14px}
      .hb-st{font:600 9px system-ui;min-height:12px}`;
    (document.head||document.documentElement).appendChild(s);
  }

  function showBadge(wid){removeBadge();if(!document.body)return;const b=document.createElement('div');b.id='hbsn-auth-badge';const masked=wid?wid.substring(0,4)+'***'+wid.substring(wid.length-3):'Detecting…';b.innerHTML=`<div class="hb-logo">${TOOL_NAME}</div><div class="hb-ver">v${VERSION}</div><div class="hb-wid" id="hbsn-badge-wid">${masked}</div><div class="hb-st" id="hbsn-badge-st" style="color:#f39c12">Checking…</div>`;document.body.appendChild(b);}
  function removeBadge(){document.getElementById('hbsn-auth-badge')?.remove();}
  function setBadgeSt(msg,color){const el=document.getElementById('hbsn-badge-st');if(!el)return;el.textContent=msg;el.style.color=color||'#f39c12';}
  function setBadgeWid(wid){const el=document.getElementById('hbsn-badge-wid');if(!el)return;el.textContent=wid.substring(0,4)+'***'+wid.substring(wid.length-3);}

  // Small red top banner (Affable style) — doesn't take over the page
  function _showAuthBanner(id, text) {
    const make = () => {
      if (!document.body) { setTimeout(make, 150); return; }
      document.getElementById('hbsn-block-screen')?.remove();
      document.getElementById('hbsn-revoked')?.remove();
      if (document.getElementById(id)) return;
      const d = document.createElement('div');
      d.id = id;
      Object.assign(d.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
        background: '#c0392b', color: '#fff', textAlign: 'center', padding: '11px 16px',
        font: "600 14px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
        boxShadow: '0 2px 12px rgba(0,0,0,0.45)'
      });
      d.textContent = text;
      document.body.appendChild(d);
    };
    make();
  }

  function showBlockScreen(wid, msg) {
    removeBadge();
    _showAuthBanner('hbsn-block-screen',
      `⛔ ${TOOL_NAME}: You are NOT authorized to use this script. ${msg || 'Contact the admin.'}`);
  }

  function showRevokedScreen() {
    _showAuthBanner('hbsn-revoked',
      `🚫 ${TOOL_NAME}: Your access has been REVOKED. Contact the admin.`);
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

  /* ★ Run Amazon "Server Busy" auto-dismiss before anything else.
     Polls briefly to catch late-rendering Amazon interstitials. */
  (function initServerBusyHandler(){
    if(handleServerBusy()) return;
    document.addEventListener('DOMContentLoaded',handleServerBusy);
    let polls=0;
    const t=setInterval(()=>{
      if(handleServerBusy() || ++polls>20) clearInterval(t);
    },300);
  })();

  /* ★ Arm the 20s general MTurk auto-close on every non-/tasks tab. */
  setupGeneralAutoClose();

  const url     = location.href;
  const inFrame = window.self !== window.top;
  const isOurTab = (Date.now()-GM_getValue('hbsn_tab_open',0))<120000;

  function isQueuePage(){
    if(url.includes('/projects/')||url.includes('/assignments/')) return false;
    return url.includes('worker.mturk.com/queue') || url.includes('worker.mturk.com/tasks') || url==='https://worker.mturk.com/' || url==='https://worker.mturk.com';
  }
  function isTaskPage(){
    return url.includes('/assignments/')||(url.includes('/projects/')&&(url.includes('/tasks/')||url.includes('/tasks?')));
  }

  // ★ SINGLETON LOGIC: Ensures only ONE Queue tab is active at a time
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

  /* ★ TASK TAB SINGLETON: If another task tab is already alive, close ourselves */
  function manageTaskSingleton() {
    // Generate a unique ID for this task tab
    let myTaskId = sessionStorage.getItem('hbsn_task_tab_id');
    if (!myTaskId) {
        myTaskId = Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('hbsn_task_tab_id', myTaskId);
    }

    const activeTaskId = GM_getValue('hbsn_active_task_id', '');
    const lastBeat = GM_getValue('hbsn_task_heartbeat', 0);
    const now = Date.now();

    // If another task tab has a recent heartbeat AND it's not us, we are the duplicate
    if (activeTaskId && activeTaskId !== myTaskId && (now - lastBeat) < TASK_TAB_HEARTBEAT_TTL) {
        console.warn('[HBSN] Duplicate task tab detected — closing self. Active:', activeTaskId, 'Self:', myTaskId);
        document.body.innerHTML = '<h1 style="color:#ef4444;text-align:center;margin-top:20%;font-family:sans-serif;">Duplicate Task Tab — closing…</h1>';
        setTimeout(() => { try{window.close();}catch(e){} }, 600);
        return false;
    }

    // We are the active task tab — claim ownership and start heartbeat
    GM_setValue('hbsn_active_task_id', myTaskId);
    startTaskHeartbeat();
    return true;
  }

  // Cleanup abandoned standard MTurk submit pages
  if(!inFrame && url.includes('worker.mturk.com/projects') && !url.includes('/tasks/') && !url.includes('/assignments/')){
    if((Date.now()-GM_getValue('hbsn_submitted',0))<60000 && isOurTab){
      releaseLock(); clearTaskHeartbeat(); showClosingBanner(); setTimeout(()=>{GM_setValue('hbsn_tab_open',0);forceCloseTab();},400);
    }
    return;
  }

  // Route to Queue Page
  if(!inFrame && isQueuePage()){
    if (!manageQueueSingleton()) return;

    // ★ Google Sheet Worker ID allowlist — block queue processing if not authorized
    const startQueue = () => gate(runQueue, () => {
      console.warn('[HBSN] Worker ID not authorized — queue disabled');
    });
    if(document.body) startQueue();
    else document.addEventListener('DOMContentLoaded', startQueue);
    return;
  }

  // Route to Task Page
  if(!inFrame && isTaskPage() && isOurTab){
    // ★ Enforce single task tab before running
    if (!manageTaskSingleton()) return;

    // ★ Google Sheet Worker ID allowlist — block HIT processing if not authorized
    const startTask = () => gate(runParent, () => {
      console.warn('[HBSN] Worker ID not authorized — task disabled, releasing lock');
      clearTaskHeartbeat();
      releaseLock();
    });
    if(document.body) startTask();
    else document.addEventListener('DOMContentLoaded', startTask);
    return;
  }
  // ★ IFRAME: poll for parent signal instead of one-shot check
  if(inFrame){
    let _ir=0;
    (function pollParent(){
      if((Date.now()-GM_getValue('hbsn_time',0))<60000){runIframe();return;}
      if(isLocked()){runIframe();return;}
      if(++_ir<25)setTimeout(pollParent,200);
    })();
    return;
  }

  /* ═══════════════════════════════════════
     QUEUE RUNNER
  ═══════════════════════════════════════ */
  function runQueue(){
    const pageText = (document.body.innerText || '').toLowerCase();
    if (pageText.includes('already processing')) {
      console.warn('[HBSN] "Already processing" lock detected.');
      document.body.innerHTML = '<h1 style="color:#f59e0b;text-align:center;margin-top:20%;font-family:sans-serif;">MTurk "Already processing" lock detected.<br>Waiting 2.5s to let server catch up...</h1>';
      setTimeout(() => location.reload(), 2500);
      return;
    }

    addQueueUI(); addDBManagerUI();
    CAPTCHA_SYSTEM.init();
    checkStaleLock();

    if(isPaused()){
      queueMsg('⏸️ PAUSED','#f6ad55'); updatePauseBtn(); return;
    }

    if (!window._hbsn_lockListenerAdded) {
        window._hbsn_lockListenerAdded = true;
        GM_addValueChangeListener('hbsn_lock', function(name, old_value, new_value, remote) {
            if (new_value === 0 && remote && !isPaused()) {
                setTimeout(processNextHIT, 1500);
            }
        });
    }

    processNextHIT();
  }

  function processNextHIT(){
    if(isPaused()) return;
    checkStaleLock();

    // ★ DOUBLE GUARD: Don't open if lock is held OR if a task tab is still alive
    if(isLocked() || isTaskTabAlive()){
      const t=GM_getValue('hbsn_total',0),y=GM_getValue('hbsn_yes',0),
            n=GM_getValue('hbsn_no',0),r=GM_getValue('hbsn_returned',0);
      const reason = isLocked() ? 'locked' : 'task tab alive';
      queueMsg(`⏳ HIT processing (${reason})… Done:${t} ✅${y} ❌${n} 🔁${r}`,'#f6ad55');
      return;
    }

    const workBtn=findWorkButton();
    if(workBtn){
      acquireLock();
      GM_setValue('hbsn_tab_open',Date.now());
      workBtn.dataset.hbsnClicked = 'true';
      queueMsg('🟢 Opening HIT…','#68d391');

      setTimeout(()=>{
        // ★ Final check right before opening — abort if a task tab appeared in the meantime
        if(isTaskTabAlive()){
          console.warn('[HBSN] Task tab appeared during delay — aborting open');
          releaseLock();
          return;
        }
        let href = workBtn.href || workBtn.getAttribute('href');
        if (href) {
            if (href.startsWith('/')) { href = window.location.origin + href; }
            // active:false — open HIT tab in background so the /tasks queue tab stays focused
            GM_openInTab(href, {active: false, insert: true});
        } else {
            workBtn.click();
        }
        queueMsg('⏳ HIT open — processing…','#7dd3fc');
      },300);
    } else {
      const t=GM_getValue('hbsn_total',0),y=GM_getValue('hbsn_yes',0),
            n=GM_getValue('hbsn_no',0),r=GM_getValue('hbsn_returned',0);
      queueMsg(`📭 Empty | Done:${t} ✅${y} ❌${n} 🔁${r}`,'#a78bfa');
    }
  }

  function findWorkButton(){
    const links = document.querySelectorAll('a[href^="/projects/"][href*="/tasks"]');
    for (const a of links) {
        if (a.dataset.hbsnClicked !== 'true') return a;
    }
    for(const el of document.querySelectorAll('a,button,[role="button"],input[type="button"]')){
      const t=(el.textContent||el.value||'').trim().toLowerCase();
      if((t==='work'||t==='continue working') && el.dataset.hbsnClicked !== 'true') return el;
    }
    return null;
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

  function doAnswerInDoc(doc,choice){
    if(!doc) return false;
    const w = choice==='yes'?'yes':'no';

    function deepQueryAll(root,sel){const res=[];(function walk(n){try{n.querySelectorAll(sel).forEach(e=>res.push(e));n.querySelectorAll('*').forEach(e=>{if(e.shadowRoot)walk(e.shadowRoot);});}catch(e){};})(root);return res;}
    for(const r of deepQueryAll(doc,'input[type="radio"]')){
      if(doc.querySelectorAll('input[type="radio"]').length && Array.from(doc.querySelectorAll('input[type="radio"]')).includes(r)) continue;
      const lbl=r.id?doc.querySelector(`label[for="${r.id}"]`):r.closest('label');
      const txt=[lbl?.textContent,r.value,r.name].join(' ').toLowerCase();
      if((choice==='yes'&&(txt.includes('yes')||r.value==='1'))||(choice==='no'&&(txt.includes('no')||r.value==='0'||r.value==='2'))){
        r.click(); return true;
      }
    }

    for(const cr of doc.querySelectorAll('crowd-radio-button')){
      const rawText=(cr.textContent||'').toLowerCase().replace(/\s+/g,' ').trim();
      const firstWord=rawText.split(' ')[0];
      const attrVal=(cr.getAttribute('value')||'').toLowerCase().trim();
      const v=attrVal||firstWord;
      const isMatch = (choice==='yes' && (v.startsWith('yes')||v==='1'||v==='true'||v==='relevant')) ||
                      (choice==='no'  && (v.startsWith('no') ||v==='0'||v==='2'||v==='false'||v==='irrelevant'));
      if(isMatch){
        console.log('[HBSN] ✔ crowd-radio-button native click, value='+v);
        cr.click();
        setTimeout(() => {
          cr.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
          const grp = cr.closest('crowd-radio-group');
          if(grp) grp.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
        }, 50);
        return true;
      }
    }

    for(const cr of doc.querySelectorAll('crowd-checkbox')){
      const v=(cr.getAttribute('value')||cr.getAttribute('name')||cr.textContent||'').toLowerCase().trim();
      const isMatch = (choice==='yes' && ['yes','1','true','relevant'].includes(v)) ||
                      (choice==='no'  && ['no','0','2','false','irrelevant'].includes(v));
      if(isMatch){
        cr.click();
        return true;
      }
    }

    for(const r of doc.querySelectorAll('input[type="radio"]')){
      const lbl=r.id?doc.querySelector(`label[for="${r.id}"]`):r.closest('label');
      const txt=[lbl?.textContent,r.value].join(' ').toLowerCase();
      if((choice==='yes'&&(txt.includes('yes')||r.value==='1'))||
         (choice==='no'&&(txt.includes('no')||r.value==='0'||r.value==='2'))){
        r.click(); return true;
      }
    }

    for(const td of doc.querySelectorAll('td')){
      const f=td.textContent.trim().toLowerCase().split(/[\s\t]+/)[0];
      if(f===w){
        const tr=td.closest('tr');
        if(tr){
          const radioInRow=tr.querySelector('input[type="radio"]');
          if(radioInRow){radioInRow.click();}
        }
        deepClick(td);if(tr)deepClick(tr);return true;
      }
    }
    for(const tr of doc.querySelectorAll('tr')){
      if(tr.textContent.trim().toLowerCase().split(/[\s\t]+/)[0]===w){
        const radioInRow=tr.querySelector('input[type="radio"]');
        if(radioInRow){radioInRow.click();}
        deepClick(tr);return true;
      }
    }

    for(const el of doc.querySelectorAll('span,div,button,li,label,a,p,th,[role="radio"],[role="button"]')){
      const t=el.textContent.trim();
      if(t.length>20||el.childElementCount>3)continue;
      if(t.toLowerCase().split(/[\s\t]+/)[0]===w){el.click();return true;}
    }

    return false;
  }

  function doAnswerEverywhere(choice){
    if(doAnswerInDoc(document,choice)) return true;
    for(const ifr of document.querySelectorAll('iframe')){
      try{if(doAnswerInDoc(ifr.contentDocument,choice)) return true;}catch(e){}
    }
    return false;
  }

  /* ═══════════════════════════════════════
     ★ SUBMIT ENGINE
  ═══════════════════════════════════════ */
  function submitLoop(n){
    if(n > MAX_SUBMIT_TRIES){
      taskStatus('⚠️ All submit methods exhausted — trying external submit…');
      if(externalSubmit()){
        taskStatus('🚀 External submit fired! Waiting for redirect...');
      } else {
        taskStatus('❌ Could not submit — releasing lock');
        clearTaskHeartbeat();
        releaseLock();
      }
      return;
    }

    if(n>0 && n%10===0) console.log(`[HBSN] Submit attempt ${n}/${MAX_SUBMIT_TRIES}…`);

    let clicked = false;

    if(attemptSubmit(document)){
      clicked = true;
    } else {
      for(const ifr of document.querySelectorAll('iframe')){
        try{
          if(attemptSubmit(ifr.contentDocument)){
            clicked = true; break;
          }
        }catch(e){}
      }
    }

    if (clicked) {
      console.log('[HBSN] 🚀 Submit button clicked natively.');
      markSubmitted();
      taskStatus('🚀 Submit clicked! Waiting for page to redirect...');
      showFlash('🚀','#22c55e');

      setTimeout(() => submitLoop(n+1), 6000);
    } else {
      setTimeout(()=>submitLoop(n+1), SUBMIT_RETRY_MS);
    }
  }

  function attemptSubmit(doc){
    if(!doc) return false;

    let btn = findSubmitBtn(doc) || doc.querySelector('crowd-button[form-action="submit"]');
    if(btn){
      console.log('[HBSN] Found standard/crowd submit button in light DOM');
      btn.removeAttribute('disabled');
      btn.disabled = false;
      btn.click();
      return true;
    }

    const cf = doc.querySelector('crowd-form');
    if(cf && cf.shadowRoot){
      const shadowBtn = cf.shadowRoot.querySelector('button[type="submit"], input[type="submit"], button');
      if(shadowBtn){
        console.log('[HBSN] Found button in crowd-form shadow DOM');
        shadowBtn.removeAttribute('disabled');
        shadowBtn.disabled = false;
        shadowBtn.click();
        return true;
      }
    }

    for(const form of doc.querySelectorAll('form')){
      const action = (form.action||'').toLowerCase();
      if(action.includes('mturk') || action.includes('submit') || action.includes('external') || action.length > 10){
        console.log('[HBSN] S4: form.submit() action='+action.substring(0,60));
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

  function markSubmitted(){ GM_setValue('hbsn_submitted',Date.now()); }

  function findReturnButton(){
    for(const b of document.querySelectorAll('button,a,input,[role="button"]')){
      const t=(b.textContent||b.value||'').trim().toLowerCase();
      if(t.includes('return')&&isVis(b))return b;
    }
    return null;
  }

  function forceCloseTab(){
    clearTaskHeartbeat();
    try{window.close();}catch(e){}
    setTimeout(()=>{try{window.open('','_self');window.close();}catch(e){}},150);
    setTimeout(()=>{try{document.body.innerHTML='<h1 style="color:#22c55e;text-align:center;margin-top:20%">Task Completed ✅<br><span style="font-size:16px;color:#94a3b8">You can close this tab safely.</span></h1>';}catch(e){}},300);
  }

  /* ═══════════════════════════════════════
     ★ TASK PARENT
  ═══════════════════════════════════════ */
  function runParent(){
    let done=false;
    const ver=getVer();

    addTaskUI('…','🔍 Scanning…');
    taskStatus('⏳ Waiting for page to load…');
    GM_setValue('hbsn_time',Date.now());

    CAPTCHA_SYSTEM.init();

    window.addEventListener('beforeunload',()=>{ if(!done){ clearTaskHeartbeat(); releaseLock(); } });

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
                markSubmitted();
                clearTaskHeartbeat();
                releaseLock();
                try {
                    const scr = document.createElement('script');
                    scr.textContent = 'window.confirm = function() { return true; };';
                    document.documentElement.appendChild(scr); scr.remove();
                } catch(e){}

                const btn=findReturnButton();
                if(btn){
                    btn.click();
                    setTimeout(() => forceCloseTab(), 1000);
                    return;
                }
                const m=url.match(/assignments\/([A-Z0-9]+)/i);
                if(m){
                    location.href=`https://worker.mturk.com/assignments/${m[1]}/return`;
                    return;
                }
                forceCloseTab();
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
           markSubmitted();
           clearTaskHeartbeat();
           releaseLock();
           try {
               const scr = document.createElement('script');
               scr.textContent = 'window.confirm = function() { return true; };';
               document.documentElement.appendChild(scr); scr.remove();
           } catch(e){}

           const btn=findReturnButton();
           if(btn){
               btn.click();
               setTimeout(() => forceCloseTab(), 1000);
               return;
           }
           const m=url.match(/assignments\/([A-Z0-9]+)/i);
           if(m){
               location.href=`https://worker.mturk.com/assignments/${m[1]}/return`;
               return;
           }
           forceCloseTab();
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
            markSubmitted();
            clearTaskHeartbeat();
            releaseLock();
            try {
               const scr = document.createElement('script');
               scr.textContent = 'window.confirm = function() { return true; };';
               document.documentElement.appendChild(scr); scr.remove();
            } catch(e){}

            const btn=findReturnButton();
            if(btn){btn.click(); setTimeout(() => forceCloseTab(), 1000); return;}
            const m=url.match(/assignments\/([A-Z0-9]+)/i);
            if(m){location.href=`https://worker.mturk.com/assignments/${m[1]}/return`;return;}
            forceCloseTab();
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

      taskStatus('⏳ Answer element not found — retrying…');
      let ansRetry=0;
      const ansTimer = setInterval(()=>{
        if(done){clearInterval(ansTimer);return;}
        ansRetry++;
        if(ansRetry > ANSWER_RETRIES){
          clearInterval(ansTimer);
          if(!done){
            done=true;
            taskStatus('⚠️ Could not find answer — force submitting anyway…');
            fireKey(choice==='yes'?'1':'2');
            document.querySelectorAll('iframe').forEach(f=>{
              try{f.contentWindow.postMessage({type:'HBSN_PICK',choice},'*');}catch(e){}
              try{f.contentWindow.postMessage({type:'HBSN_SUBMIT'},'*');}catch(e){}
            });
            setTimeout(()=>{
               document.querySelectorAll('iframe').forEach(f=>{
                  try{f.contentWindow.postMessage({type:'HBSN_SUBMIT'},'*');}catch(e){}
               });
               submitLoop(0);
            },1500);
          }
          return;
        }
        if(ansRetry%3===0){
          document.querySelectorAll('iframe').forEach(f=>{
            try{f.contentWindow.postMessage({type:'HBSN_PICK',choice},'*');}catch(e){}
          });
        }
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
    const choice=GM_getValue('hbsn_choice','yes');

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
    if(doAnswerInDoc(document,c)) setTimeout(tellParent,200);
    else setTimeout(()=>answerLoop(c,n+1),RETRY_MS);
  }
  function tellParent(){try{window.top.postMessage({type:'HBSN_DONE'},'*');}catch(e){}}

  /* ═══════════════════════════════════════
     UTILITY
  ═══════════════════════════════════════ */
  function fireKey(key){
    const kc=key.charCodeAt(0);
    [document.activeElement,document.body,document.documentElement].filter(Boolean).forEach(t=>{
      ['keydown','keypress','keyup'].forEach(ev=>{
        try{t.dispatchEvent(new KeyboardEvent(ev,{key,code:'Digit'+key,keyCode:kc,which:kc,
          charCode:ev==='keypress'?kc:0,bubbles:true,cancelable:true,composed:true}));}catch(e){}
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
    const b=document.createElement('div');b.id='hbsn-closing';b.textContent='✅ Task Closed';
    try{document.body.innerHTML='';}catch(e){}
    document.body.appendChild(b);
  }
  function queueMsg(t,c){const m=document.getElementById('hbsn-qm'),d=document.getElementById('hbsn-qd');if(m)m.textContent=t;if(d){d.style.background=c;d.style.animation='blink 1s infinite';}}
  function taskStatus(t){const el=document.getElementById('hbsn-ts');if(el)el.textContent=t;console.log(`[${TOOL_NAME}]`,t);}
  function showFlash(txt,color){const el=document.getElementById('hbsn-fl');if(!el)return;el.textContent=txt;el.style.color=color;el.style.opacity='1';}

})();
