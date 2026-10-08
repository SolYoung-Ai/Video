/* ============ ML.app — boot ============ */
ML.app = (function(){
  function runIntro(cb){
    const box = document.getElementById('loading');
    if(!box){ cb(); return; }
    const word = box.querySelector('.loading-word');
    if(!word){ box.classList.add('done'); cb(); return; }
    const txt = word.textContent.trim();
    word.innerHTML = '';
    [...txt].forEach((ch,i)=>{
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.cssText = 'display:inline-block;opacity:0;transform:translateY(14px);transition:opacity .3s ease,transform .3s ease;transition-delay:'+(i*0.055)+'s';
      word.appendChild(s);
      setTimeout(()=>{ s.style.opacity='1'; s.style.transform='translateY(0)'; }, 30);
    });
    const nums = box.querySelector('.loading-nums');
    if(nums){ setTimeout(()=>nums.textContent='01',500); setTimeout(()=>nums.textContent='02',640); setTimeout(()=>nums.textContent='03',780); }
    const line = box.querySelector('.loading-line');
    setTimeout(()=>{ if(line) line.classList.add('go'); }, 920);
    setTimeout(()=>{ box.classList.add('done'); cb(); }, 1250);
  }

  /* ============ command palette (⌘K) + global shortcuts ============ */
  function buildPalette(){
    const Tn = ML.i18n.t;
    let pal = document.getElementById('palette');
    if(pal) pal.remove();
    pal = document.createElement('div');
    pal.id = 'palette';
    pal.className = 'palette';
    pal.innerHTML = '<div class="pal-box"><div class="pal-title">Command</div><input class="pal-input" placeholder="'+Tn('cmd.search')+'" autocomplete="off" spellcheck="false"><div class="pal-list"></div></div>';
    document.body.appendChild(pal);
    const input = pal.querySelector('.pal-input');
    const list = pal.querySelector('.pal-list');
    const close = ()=>{ pal.classList.remove('open'); setTimeout(()=>{ pal.remove(); }, 150); };
    const actions = [
      { label: Tn('nav.new'), key: 'N', run: ()=>ML.router.go('/new') },
      { label: Tn('cmd.save'), key: '⌘S', run: ()=>{ if(ML.workspace.isActive()) ML.workspace.saveNow(); } },
      { label: Tn('cmd.export'), key: 'E', run: ()=>{ const b = document.querySelector('[data-act=export]'); if(b) b.click(); } },
      { label: Tn('cmd.openRecent'), key: 'R', run: async ()=>{ const ps = await ML.store.listProjects(); if(ps.length) ML.router.go('/projects/'+ps[0].id); } },
      { label: Tn('nav.assets'), key: '', run: ()=>ML.router.go('/assets') },
      { label: Tn('nav.settings'), key: '', run: ()=>ML.router.go('/settings') },
      { label: Tn('cmd.lang'), key: '', run: ()=>{ ML.i18n.set(ML.i18n.lang==='zh'?'en':'zh'); ML.router.render(); } }
    ];
    function run(filter){
      const f = (filter||'').toLowerCase();
      list.innerHTML = '';
      actions.filter(a=>!f || a.label.toLowerCase().includes(f)).slice(0,9).forEach(a=>{
        const row = document.createElement('div');
        row.className = 'pal-item';
        row.innerHTML = '<span>'+a.label+'</span><kbd>'+(a.key||'')+'</kbd>';
        row.addEventListener('click', ()=>{ close(); a.run(); });
        list.appendChild(row);
      });
    }
    input.addEventListener('input', ()=>run(input.value));
    input.addEventListener('keydown', ev=>{
      if(ev.key==='Enter'){ const first = list.querySelector('.pal-item'); if(first) first.click(); }
      if(ev.key==='Escape') close();
    });
    pal.addEventListener('click', ev=>{ if(ev.target===pal) close(); });
    run('');
    pal.classList.add('open');
    input.focus();
  }
  function togglePalette(){ buildPalette(); }

  function installShortcuts(){
    document.addEventListener('keydown', ev=>{
      const m = ev.metaKey || ev.ctrlKey;
      const tag = ev.target && ev.target.tagName;
      if(m && (ev.key==='k'||ev.key==='K')){ ev.preventDefault(); togglePalette(); return; }
      if(m && (ev.key==='z'||ev.key==='Z')){
        if(!tag || !['TEXTAREA','INPUT','SELECT'].includes(tag)){
          ev.preventDefault();
          if(ML.workspace.isActive()){ if(ev.shiftKey) ML.workspace.redo(); else ML.workspace.undo(); }
        }
        return;
      }
      if(m && (ev.key==='s'||ev.key==='S')){
        if(!tag || !['TEXTAREA','INPUT','SELECT'].includes(tag)){
          ev.preventDefault();
          if(ML.workspace.isActive()) ML.workspace.saveNow();
        }
        return;
      }
    });
  }

  async function boot(){
    try{
      ML.cap.detect();
      ML.cap.checkEncoders().then(()=>{ try{ window.dispatchEvent(new CustomEvent('ml-cap-ready')); }catch(e){} }).catch(e=>ML.diag.error('CAPABILITY','check',null,e));
      ML.diag.installGlobalErrorHandlers();
      try{ await ML.store.init(); }catch(e){}
      try{ await ML.store.cleanupLegacy(); }catch(e){}
      try{ await ML.providers.loadConfig(); }catch(e){}
      buildTopbar();
      ML.router.init();
      installShortcuts();
      window.__ML = { store: ML.store, providers: ML.providers, script: ML.script, media: ML.media,
        matcher: ML.matcher, voice: ML.voice, autoedit: ML.autoedit, timeline: ML.timeline,
        compose: ML.compose, export: ML.export, workspace: ML.workspace, views: ML.views, diag: ML.diag, cap: ML.cap };
      runIntro(()=>{ document.body.classList.add('ready'); });
    }catch(e){
      ML.diag.error('BOOT','start',null,e);
      const app = document.getElementById('app');
      if(app) app.innerHTML = '<div style="padding:40px;color:#f5f5f5;font:12px JetBrains Mono,monospace">BOOT ERROR: '+String(e&&e.message||e)+'</div>';
    }
  }

  function buildTopbar(){
    const bar = document.getElementById('topbar');
    if(!bar) return;
    const Tn = ML.i18n.t;
    const langLabel = ML.i18n.lang==='zh' ? 'EN' : '中文';
    bar.innerHTML = ''+
      '<div class="tb-left"><div class="tb-brand"><span class="tb-logo">'+Tn('app.name')+'</span><span class="tb-tag">'+Tn('app.tag')+'</span></div></div>'+
      '<nav class="tb-nav">'+
        '<button class="nav-item" data-route="home">'+Tn('nav.projects')+'</button>'+
        '<button class="nav-item" data-route="assets">'+Tn('nav.assets')+'</button>'+
        '<button class="nav-item" data-route="new">'+Tn('nav.new')+'</button>'+
        '<button class="nav-item" data-route="settings">'+Tn('nav.settings')+'</button>'+
      '</nav>'+
      '<div class="tb-right">'+
        '<button class="btn btn-ghost sm lang-switch" data-act="lang">'+langLabel+'</button>'+
        '<button class="btn sm" data-act="newTop">'+Tn('nav.new')+'</button>'+
      '</div>';
    bar.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click', ()=>{
      const r = n.dataset.route;
      ML.router.go(r==='home' ? '/' : '/'+r);
    }));
    bar.querySelector('[data-act=newTop]').addEventListener('click', ()=>ML.router.go('/new'));
    bar.querySelector('[data-act=lang]').addEventListener('click', ()=>{
      ML.i18n.set(ML.i18n.lang==='zh' ? 'en' : 'zh');
      ML.router.render();
      buildTopbar();
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
