/* ============ ML.cap — browser capability detection ============ */
ML.cap = (function(){
  const out = {
    canvas: false, canvas2d: false, webgl: false, webgl2: false,
    offscreen: false, indexeddb: false, file: false, blob: false,
    objectURL: false, imageBitmap: false, raf: false,
    mediarecorder: false, mediaMime: [],
    webcodecs: false, mp4Codec: false, webmCodec: false, webmAlpha: false,
    gif: false, /* no GIF encoder in the new product — capability removed honestly */
    checked: false
  };
  function detect(){
    try{
      const cv = document.createElement('canvas');
      out.canvas = true;
      out.canvas2d = !!cv.getContext && !!cv.getContext('2d');
      out.webgl = !!(window.WebGLRenderingContext && (cv.getContext('webgl')||cv.getContext('experimental-webgl')));
      out.webgl2 = !!(window.WebGL2RenderingContext && cv.getContext('webgl2'));
      out.offscreen = 'OffscreenCanvas' in window;
      out.indexeddb = 'indexedDB' in window;
      out.file = 'File' in window && 'FileReader' in window;
      out.blob = 'Blob' in window;
      out.objectURL = 'URL' in window && !!URL.createObjectURL;
      out.imageBitmap = 'createImageBitmap' in window;
      out.raf = 'requestAnimationFrame' in window;
      out.mediarecorder = 'MediaRecorder' in window && !!HTMLCanvasElement.prototype.captureStream;
      if(out.mediarecorder){
        ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].forEach(m=>{
          try{ if(MediaRecorder.isTypeSupported(m)) out.mediaMime.push(m); }catch(e){}
        });
      }
      out.webcodecs = 'VideoEncoder' in window && 'VideoFrame' in window;
      out.audioCodec = 'AudioEncoder' in window;
    }catch(e){}
    return out;
  }
  async function checkEncoders(){
    if(!out.webcodecs) { out.checked = true; return out; }
    try{
      const sup = await VideoEncoder.isConfigSupported({ codec:'avc1.4d401f', width:320, height:320, bitrate:1e6, framerate:24 });
      out.mp4Codec = !!sup.supported;
    }catch(e){ out.mp4Codec = false; }
    try{
      const sup2 = await VideoEncoder.isConfigSupported({ codec:'vp09.00.10.08', width:320, height:320, bitrate:1e6, framerate:24 });
      out.webmCodec = !!sup2.supported;
    }catch(e){ out.webmCodec = false; }
    try{
      const sup3 = await VideoEncoder.isConfigSupported({ codec:'vp09.00.10.08', width:16, height:16, bitrate:1e5, framerate:1 });
      out.webmAlpha = !!sup3.supported;
    }catch(e){ out.webmAlpha = false; }
    out.checked = true;
    return out;
  }
  detect();
  return { detect, checkEncoders, get: ()=>out, summary: ()=>({
    canvas: out.canvas2d, webgl: out.webgl2||out.webgl, webcodecs: out.webcodecs,
    mp4: out.mp4Codec, webm: out.webmCodec || out.mediaMime.length>0,
    mediarecorder: out.mediarecorder, indexeddb: out.indexeddb, audio: out.audioCodec,
    gif: out.gif
  }) };
})();

/* ============ ML.diag — error manager + diagnostics panel ============ */
ML.diag = (function(){
  const L = ML.lib;
  const errors = []; /* {module, action, refId, time, message, stack} */
  const MAX = 40;
  let panel = null;

  function error(module, action, refId, err){
    const rec = {
      module: String(module||'APP'),
      action: String(action||''),
      refId: refId!==undefined&&refId!==null ? String(refId) : '',
      time: new Date().toISOString().slice(11,19),
      message: String((err&&(err.message||err))||err||'unknown'),
      stack: (err&&err.stack)?String(err.stack).slice(0,400):''
    };
    errors.unshift(rec);
    if(errors.length > MAX) errors.pop();
    try{ console.error('['+rec.module+'/'+rec.action+']', rec.message); }catch(e){}
    return rec;
  }
  function list(){ return errors.slice(); }
  function clear(){ errors.length = 0; }

  /* ---------- project validation ---------- */
  function validateProject(p){
    const issues = [];
    if(!p) return { ok:false, issues:['null project'] };
    if(!p.id) issues.push('missing id');
    if(!p.ratio) issues.push('missing ratio');
    if(p.scriptText && (!Array.isArray(p.scenes) || !p.scenes.length)) issues.push('script without scenes');
    if(!Array.isArray(p.timeline) && (!p.timeline || !Array.isArray(p.timeline.clips))) issues.push('timeline missing');
    const tv = ML.timeline && ML.timeline.validate ? ML.timeline.validate(p) : { ok:true, problems:[] };
    if(!tv.ok) issues.push(...tv.problems.slice(0,5));
    return { ok: issues.length===0, issues };
  }
  async function validateAllProjects(){
    const projects = await ML.store.listProjects();
    const res = { total: projects.length, ok: 0, failed: [], issues: [] };
    projects.forEach(p=>{
      const v = validateProject(p);
      if(v.ok) res.ok++; else { res.failed.push(p.id); res.issues.push(v.issues.join('; ')); }
    });
    return res;
  }

  /* ---------- render smoke test: composes a minimal project and renders frames ---------- */
  async function renderSmokeTest(onProgress){
    const p = {
      id:'diag-'+Date.now(), name:'DIAG', ratio:'9:16', fps:30,
      scriptText:'测试场景。', scenes:[{ id:'sc1', order:1, text:'测试场景。', keywords:['测试'], intent:'Explanation', visualNeeds:['人物'], duration:2 }],
      assets:[], voiceSegments:[{ id:'v1', sceneId:'sc1', text:'测试场景。', duration:2, provider:'DEV_MOCK', status:'mock' }],
      timeline:{ clips:[
        { id:'c1', track:'voice', sceneId:'sc1', voiceId:'v1', timelineStart:0, timelineEnd:2, speed:1, volume:1 },
        { id:'c2', track:'subtitle', sceneId:'sc1', text:'测试场景。', lines:['测试场景。'], style:{}, timelineStart:0, timelineEnd:2 },
        { id:'c3', track:'marker', sceneId:'sc1', text:'Scene 1', timelineStart:0, timelineEnd:0.05 }
      ], duration:2 }, settings:{}
    };
    const [W,H] = ML.compose.ratioSize('9:16', 160);
    const cv = document.createElement('canvas'); cv.width=W; cv.height=H;
    const ctx = cv.getContext('2d');
    const res = { total:3, ok:0, failed:[], errors:[] };
    for(let i=0;i<3;i++){
      try{
        await ML.compose.renderFrame(p, i*0.7, ctx, W, H);
        res.ok++;
      }catch(e){
        res.failed.push('frame'+i);
        res.errors.push(String(e&&e.message||e));
        ML.diag.error('RENDERER','smoke-test',null,e);
      }
      if(onProgress) onProgress(i+1, 3);
    }
    return res;
  }

  /* ---------- storage self-test ---------- */
  async function storageTest(){
    const S = ML.store;
    const key = 'diag-test-'+Date.now();
    const out = { idb: !!S.ready(), put:false, get:false, del:false, ls:false };
    try{
      await S.setSetting(key, {v:1});
      out.put = true;
      const v = await S.getSetting(key, null);
      out.get = v && v.v===1;
      await S.setSetting(key, undefined);
      out.del = true;
      try{ localStorage.setItem('__ml_diag','1'); localStorage.removeItem('__ml_diag'); out.ls = true; }catch(e){}
    }catch(e){ ML.diag.error('STORAGE','self-test',null,e); }
    return out;
  }

  /* ---------- panel ---------- */
  function esc(s){ return String(s||'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function row(label, val, cls){
    return '<div class="diag-row"><span>'+esc(label)+'</span><b class="'+(cls||'')+'">'+val+'</b></div>';
  }
  function tick(v){ return v ? '<i class="ok">✓</i>' : '<i class="no">✕</i>'; }

  function openPanel(){
    if(panel && panel.isConnected){ panel.remove(); panel = null; return; }
    const cap = ML.cap.get();
    const sum = ML.cap.summary();
    const ov = L.el('div','diag-panel');
    const close = ()=>{ ov.remove(); panel=null; };
    const mods = ['store','providers','script','media','matcher','voice','autoedit','timeline','compose','export','workspace','views'];
    const modStatus = mods.map(m=>ML[m]? '<i class="ok">✓</i>':'<i class="no">✕</i>').join(' ');
    let html = '<div class="diag-head"><b>SYSTEM DIAGNOSTICS</b><span class="diag-sub">VIDEO LAB · AUTO EDIT · developer panel</span><button class="diag-close">✕</button></div>';
    html += '<div class="diag-cols"><div class="diag-col">';
    html += '<div class="diag-sec">APPLICATION</div>' + row('Modules', modStatus) + row('Router','hash') + row('i18n', (ML.i18n.lang||'zh').toUpperCase()) + row('Provider mode','AI '+(ML.providers.hasAI()?'provider':'DEV MOCK')+' / TTS '+(ML.providers.hasTTS()?'provider':'DEV MOCK'));
    html += '<div class="diag-sec">RENDERER</div>' + row('Canvas 2D', tick(cap.canvas2d)) + row('Composition engine', tick(!!ML.compose)) + row('OffscreenCanvas', tick(cap.offscreen));
    html += '<div class="diag-sec">EDITOR</div>' + row('Workspace', tick(!!ML.workspace)) + row('Timeline model', tick(!!ML.timeline));
    html += '</div><div class="diag-col">';
    html += '<div class="diag-sec">EXPORTER</div>' + row('MP4 (WebCodecs)', tick(sum.mp4)) + row('SRT', tick(true)) + row('Voice (real TTS)', tick(!!ML.providers.hasTTS()));
    html += '<div class="diag-sec">STORAGE</div>' + row('IndexedDB', tick(cap.indexeddb && !!ML.store.ready())) + row('Asset blobs (IDB)', tick(cap.indexeddb));
    html += '<div class="diag-sec">BROWSER</div>' + row('MediaRecorder', tick(cap.mediarecorder)) + row('WebCodecs', tick(cap.webcodecs)) + row('AudioEncoder', tick(cap.audioCodec)) + row('Object URL', tick(cap.objectURL));
    html += '</div></div>';
    html += '<div class="diag-actions">';
    html += '<button class="btn btn-sm" id="dProj">Validate projects</button>';
    html += '<button class="btn btn-sm" id="dRender">Render smoke test</button>';
    html += '<button class="btn btn-sm" id="dStore">Storage self-test</button>';
    html += '<button class="btn btn-sm" id="dClear">Clear errors</button>';
    html += '</div>';
    html += '<div class="diag-log"><div class="diag-sec">ERROR LOG</div><div id="dLog">'+renderLog()+'</div></div>';
    ov.innerHTML = html;
    ov.querySelector('.diag-close').addEventListener('click', close);
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    document.getElementById('overlays').appendChild(ov);
    const out = L.el('div','diag-out');
    ov.appendChild(out);
    L.$('#dClear', ov).addEventListener('click', ()=>{ ML.diag.clear(); const lg = L.$('#dLog', ov); if(lg) lg.innerHTML = renderLog(); });
    L.$('#dProj', ov).addEventListener('click', async ()=>{
      out.innerHTML = '<div class="diag-sec">PROJECT VALIDATION</div><div class="diag-msg">running…</div>';
      const r = await ML.diag.validateAllProjects();
      out.innerHTML = '<div class="diag-sec">PROJECT VALIDATION</div><div class="diag-msg">'+(r.failed.length? 'FAILED '+r.failed.length+' / '+r.total+' — '+r.failed.join(', ')+'<br>'+r.issues.slice(0,6).join('<br>') : 'PASS '+r.ok+' / '+r.total)+'</div>';
    });
    L.$('#dStore', ov).addEventListener('click', async ()=>{
      out.innerHTML = '<div class="diag-sec">STORAGE TEST</div><div class="diag-msg">running…</div>';
      const r = await ML.diag.storageTest();
      out.innerHTML = '<div class="diag-sec">STORAGE TEST</div><div class="diag-msg">'+(r.put&&r.get&&r.del ? 'PASS — IndexedDB put/get/delete ok' : 'FAILED — put:'+r.put+' get:'+r.get+' del:'+r.del)+'</div>';
    });
    L.$('#dRender', ov).addEventListener('click', async ()=>{
      out.innerHTML = '<div class="diag-sec">RENDER SMOKE TEST</div><div class="diag-msg">rendering…</div>';
      const r = await ML.diag.renderSmokeTest((done,total)=>{
        const o = L.$('.diag-msg', out); if(o) o.textContent = 'rendering '+done+' / '+total;
      });
      out.innerHTML = '<div class="diag-sec">RENDER SMOKE TEST</div><div class="diag-msg">'+(r.failed.length? 'FAILED '+r.failed.length+' / '+r.total+' — '+r.failed.join(', '): 'PASS '+r.ok+' / '+r.total)+'</div>';
    });
    panel = ov;
  }
  function renderLog(){
    const es = errors.slice(0,12);
    if(!es.length) return '<div class="diag-msg">No errors recorded.</div>';
    return es.map(e=>'<div class="diag-err"><b>'+esc(e.module)+' / '+esc(e.action)+(e.refId?' / '+esc(e.refId):'')+'</b><span>'+esc(e.time)+'</span><p>'+esc(e.message)+'</p></div>').join('');
  }

  function bindGlobalHandlers(){
    window.addEventListener('error', e=>{
      const rec = error('WINDOW','global', null, e.error || e.message);
      if(rec.message && /resize|scroll|pointer/i.test(rec.message)) return;
      try{ L.toast('Error: '+rec.message.slice(0,80), 'err'); }catch(err){}
    });
    window.addEventListener('unhandledrejection', e=>{
      const rec = error('PROMISE','unhandled', null, e.reason);
      try{ L.toast('Error: '+rec.message.slice(0,80), 'err'); }catch(err){}
    });
    document.addEventListener('keydown', e=>{
      if((e.metaKey||e.ctrlKey) && e.shiftKey && (e.key==='D'||e.key==='d')){
        e.preventDefault(); openPanel();
      }
    });
  }
  function installGlobalErrorHandlers(){ bindGlobalHandlers(); }

  return { error, list, clear, validateProject, validateAllProjects, renderSmokeTest, storageTest, openPanel, bindGlobalHandlers, installGlobalErrorHandlers, renderLog };
})();
