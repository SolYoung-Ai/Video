/* ============ ML.workspace — edit workspace: preview / script-media-voice / inspector / timeline ============ */
ML.workspace = (function(){
  const L = ML.lib, Tn = ML.i18n.t;
  let root = null, ctx = null;
  let project = null, projectId = null;
  let playing = false, rafId = 0, lastTs = 0, playbackRate = 1, loop = false;
  let currentTime = 0, fps = 30;
  let selectedClipId = null, selectedSceneId = null, selectedAssetId = null;
  let history = [], hIdx = -1;
  let saveTimer = null;
  let leftTab = 'script';
  let tlZoom = 90; /* px per second — CapCut-like zoom */
  let inspectorKind = 'none'; /* video | subtitle | voice | scene */
  let dirtyFlag = true; /* forces full timeline re-render */

  const el = id => root ? root.querySelector(id) : null;
  function qAll(sel){ return root ? Array.from(root.querySelectorAll(sel)) : []; }

  /* ============ history ============ */
  function snap(){
    return {
      scriptText: project.scriptText,
      scenes: JSON.parse(JSON.stringify(project.scenes||[])),
      voiceSegments: (project.voiceSegments||[]).map(s=>Object.assign({}, s, { audioBlob: undefined })),
      timeline: JSON.parse(JSON.stringify(project.timeline||{clips:[]})),
      settings: JSON.parse(JSON.stringify(project.settings||{})),
      ratio: project.ratio
    };
  }
  function pushHistory(){
    history = history.slice(0, hIdx+1);
    history.push(snap());
    if(history.length > 50) history.shift();
    hIdx = history.length-1;
    scheduleSave();
  }
  function undo(){
    if(hIdx <= 0) return;
    hIdx--;
    applySnap(history[hIdx]);
    dirtyFlag = true;
    renderTimeline(); renderInspector(); renderLeft(); syncScript();
  }
  function redo(){
    if(hIdx >= history.length-1) return;
    hIdx++;
    applySnap(history[hIdx]);
    dirtyFlag = true;
    renderTimeline(); renderInspector(); renderLeft(); syncScript();
  }
  function applySnap(s){
    project.scriptText = s.scriptText;
    project.scenes = JSON.parse(JSON.stringify(s.scenes));
    project.voiceSegments = (s.voiceSegments||[]).map(v=>Object.assign({}, v, { audioBlob: undefined }));
    project.timeline = JSON.parse(JSON.stringify(s.timeline));
    project.settings = JSON.parse(JSON.stringify(s.settings));
    project.ratio = s.ratio;
  }

  /* ============ autosave ============ */
  function scheduleSave(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async ()=>{
      try{ await ML.store.saveProject(project); ML.lib.toast(Tn('toast.saved')); }
      catch(e){ ML.lib.toast(Tn('toast.saveFailed'), true); }
    }, 500);
  }
  async function saveNow(){
    clearTimeout(saveTimer);
    try{ await ML.store.saveProject(project); ML.lib.toast(Tn('toast.saved')); }
    catch(e){ ML.lib.toast(Tn('toast.saveFailed'), true); }
  }

  /* ============ playback ============ */
  function duration(){ return ML.timeline.durationOf(project); }
  function tick(ts){
    if(!playing){ rafId = 0; return; }
    let dt = lastTs ? (ts-lastTs)/1000 : 0;
    lastTs = ts;
    /* tab hidden pauses rAF → on resume, do not jump the clock */
    if(dt > 0.3) dt = 0;
    if(dt>0){
      currentTime += dt*playbackRate;
      const d = duration();
      if(currentTime >= d){ if(loop){ currentTime = 0; } else { currentTime = d; stop(); } }
    }
    renderFrame();
    updatePlayhead();
    updateTimecode();
    rafId = requestAnimationFrame(tick);
  }
  function play(){ if(playing) return; playing = true; lastTs = 0; rafId = requestAnimationFrame(tick); updateTransport(); }
  function stop(){ playing = false; lastTs = 0; if(rafId){ cancelAnimationFrame(rafId); rafId = 0; } updateTransport(); }
  function toggle(){ playing ? stop() : play(); }
  function seek(t){
    currentTime = L.clamp(t, 0, Math.max(0.01, duration()));
    renderFrame(); updatePlayhead(); updateTimecode();
  }
  function stepFrame(dir){
    const d = 1/fps;
    seek(currentTime + dir*d);
  }
  function renderFrame(){
    const cv = el('.ws-canvas');
    if(!cv) return;
    const c2 = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ML.compose.renderFrame(project, currentTime, c2, W, H);
  }

  /* ============ timeline DOM ============ */
  const TRACKS = ['video','voice','subtitle','marker'];
  function updatePlayhead(){
    const ph = el('.tl-playhead');
    if(!ph) return;
    const d = Math.max(0.1, duration());
    ph.style.left = (currentTime/d*100)+'%';
  }
  function updateTimecode(){
    const tc = el('.ws-timecode');
    if(tc) tc.textContent = fmtTime(currentTime)+' / '+fmtTime(duration());
  }
  function fmtTime(t){
    const m = Math.floor(t/60), s = Math.floor(t%60), ms = Math.floor((t%1)*1000/10);
    return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(ms).padStart(2,'0');
  }
  function renderTimeline(){
    const d = Math.max(0.1, duration());
    const trackWrap = el('.tl-tracks');
    if(trackWrap) trackWrap.style.width = (d*tlZoom)+'px';
    TRACKS.forEach(track=>{
      const row = el('.tl-row[data-track="'+track+'"] .tl-clips');
      if(!row) return;
      row.innerHTML = '';
      const clips = project.timeline.clips.filter(c=>c.track===track).sort((a,b)=>a.timelineStart-b.timelineStart);
      clips.forEach(c=>{
        const div = document.createElement('div');
        div.className = 'tl-clip tl-'+track+(c.id===selectedClipId?' sel':'')+(c.locked?' locked':'')+(c.muted?' muted':'');
        div.dataset.id = c.id;
        div.style.left = (c.timelineStart*tlZoom)+'px';
        div.style.width = Math.max(14, ((c.timelineEnd-c.timelineStart)*tlZoom - 2))+'px';
        if(track==='video'){
          const a = project.assets.find(x=>x.id===c.assetId);
          if(a && a.thumb) div.style.backgroundImage = 'url('+a.thumb+')';
          div.innerHTML = '<span class="tl-clip-name">'+esc(a?a.name:'?')+'</span><i class="tl-trim tl-trim-l"></i><i class="tl-trim tl-trim-r"></i>';
        } else if(track==='voice'){
          const vs = project.voiceSegments.find(x=>x.id===c.voiceId);
          div.innerHTML = '<span class="tl-clip-name">'+(vs&&vs.status==='real'?'● ':'○ ')+Tn('ws.tr.voice')+'</span><i class="tl-trim tl-trim-l"></i><i class="tl-trim tl-trim-r"></i>';
          div.title = vs ? (vs.text||'') : '';
        } else if(track==='subtitle'){
          div.innerHTML = '<span class="tl-clip-name">'+esc(c.text||'')+'</span><i class="tl-trim tl-trim-l"></i><i class="tl-trim tl-trim-r"></i>';
        } else {
          div.innerHTML = '<span class="tl-clip-name">'+esc(c.text||'')+'</span>';
        }
        if(!c.locked){
          div.addEventListener('pointerdown', ev=>onClipDown(ev, c));
        }
        div.addEventListener('click', ev=>{ ev.stopPropagation(); onClipSelect(c); });
        row.appendChild(div);
      });
    });
    renderRuler();
    updatePlayhead();
  }
  /* CapCut-style time ruler drawn on canvas */
  function renderRuler(){
    const cv = el('.tl-ruler-canvas');
    if(!cv) return;
    const d = Math.max(0.1, duration());
    const px = d*tlZoom;
    if(cv.width !== Math.ceil(px*2) || cv.height !== 40){
      cv.width = Math.ceil(px*2); cv.height = 40;
    }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0,0,cv.width,40);
    const step = tlZoom>=70 ? 0.5 : 1;
    ctx.fillStyle = '#555555';
    ctx.font = '10px JetBrains Mono, monospace';
    for(let t=0; t<=d; t+=step){
      const x = t*tlZoom*2;
      ctx.strokeStyle = t%5===0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.moveTo(x, t%5===0?12:18); ctx.lineTo(x,22); ctx.stroke();
      if(t%5===0){
        ctx.fillText(fmtTime(t).slice(0,5), x+3, 11);
      }
    }
  }
  function updatePlayhead(){
    const d = Math.max(0.1, duration());
    const pct = currentTime/d*100;
    const px = currentTime*tlZoom;
    const ph = el('.tl-playhead');
    if(ph){ ph.style.left = px+'px'; }
    const rph = el('.tl-ruler-playhead');
    if(rph){ rph.style.left = px+'px'; }
    const tc = el('.ws-timecode');
    if(tc) tc.textContent = fmtTime(currentTime)+' / '+fmtTime(d);
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  /* clip interactions (select / drag / trim) */
  function onClipSelect(c){
    selectedClipId = c.id; dirtyFlag = true;
    if(c.sceneId) selectScene(c.sceneId);
    renderInspector(); renderTimeline(); syncScript();
  }
  function onClipDown(ev, c){
    if(ev.target.classList.contains('tl-trim-l') || ev.target.classList.contains('tl-trim-r')) return onTrim(ev, c);
    onClipSelect(c);
    const startX = ev.clientX;
    const tlStart = c.timelineStart, tlEnd = c.timelineEnd;
    const move = e2 => {
      const dx = (e2.clientX-startX) / tlZoom;
      let snap = Math.round((tlStart+dx)*10)/10;
      /* magnet to playhead */
      if(Math.abs(snap-currentTime) < 0.35) snap = Math.round(currentTime*10)/10;
      c.timelineStart = Math.max(0, snap);
      c.timelineEnd = Math.max(0.2, c.timelineEnd + (c.timelineStart - (tlStart + Math.round(dx*10)/10)));
      c.timelineEnd = Math.max(c.timelineStart + 0.2, tlEnd + (c.timelineStart - tlStart));
      dirtyFlag = true;
      renderTimeline();
    };
    const up = ()=>{
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      pushHistory(); updateTimelineModel();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    ev.preventDefault();
  }
  function onTrim(ev, c){
    ev.stopPropagation();
    const isL = ev.target.classList.contains('tl-trim-l');
    const startX = ev.clientX;
    const orig = { s: c.timelineStart, e: c.timelineEnd };
    const move = e2 => {
      const dx = (e2.clientX-startX) / tlZoom;
      if(isL){
        const ns = Math.round((orig.s+dx)*10)/10;
        c.timelineStart = Math.max(0, Math.min(ns, c.timelineEnd-0.2));
        c.sourceStart = Math.max(0, c.sourceStart + (c.timelineStart - orig.s));
        c.sourceEnd = c.sourceStart + (c.timelineEnd-c.timelineStart);
      } else {
        const ne = Math.round((orig.e+dx)*10)/10;
        c.timelineEnd = Math.max(c.timelineStart+0.2, ne);
        c.sourceEnd = c.sourceStart + (c.timelineEnd-c.timelineStart);
      }
      dirtyFlag = true; renderTimeline();
    };
    const up = ()=>{ window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); pushHistory(); updateTimelineModel(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    ev.preventDefault();
  }
  /* keep model times in sync with clip objects after drags */
  function updateTimelineModel(){}

  /* ============ inspector ============ */
  function renderInspector(){
    const box = el('.ws-inspector-body');
    if(!box) return;
    const c = project.timeline.clips.find(x=>x.id===selectedClipId);
    if(!c){ box.innerHTML = '<div class="ws-none">'+Tn('ws.none')+'</div>'; inspectorKind='none'; return; }
    if(c.track==='video') return renderVideoInspector(box, c);
    if(c.track==='subtitle') return renderSubtitleInspector(box, c);
    if(c.track==='voice') return renderVoiceInspector(box, c);
    box.innerHTML = '<div class="ws-none">'+Tn('ws.noSel')+'</div>';
    inspectorKind='none';
  }

  function field(box, label, html){ box.insertAdjacentHTML('beforeend', '<div class="if-row"><span class="if-label">'+label+'</span><div class="if-ctl">'+html+'</div></div>'); }
  function rangeHTML(key, min, max, step, val){ return '<input type="range" data-k="'+key+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"><span class="if-val" data-v="'+key+'">'+val+'</span>'; }
  function numberHTML(key, val){ return '<input type="number" data-k="'+key+'" value="'+val+'">'; }
  function colorHTML(key, val){ return '<input type="color" data-k="'+key+'" value="'+val+'">'; }
  function selectHTML(key, opts, val){ return '<select data-k="'+key+'">'+opts.map(o=>'<option value="'+o+'"'+(o===val?' selected':'')+'>'+o+'</option>').join('')+'</select>'; }

  function renderVideoInspector(box, c){
    inspectorKind = 'video';
    const a = project.assets.find(x=>x.id===c.assetId);
    box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', '<div class="if-title">'+Tn('ws.video')+(a?' — '+esc(a.name):'')+'</div>');
    field(box, Tn('ws.scale'), rangeHTML('scale', 0.5, 2.5, 0.01, L.round(c.transform.scale,2)));
    field(box, 'X', rangeHTML('x', -1, 1, 0.01, L.round(c.transform.x,2)));
    field(box, 'Y', rangeHTML('y', -1, 1, 0.01, L.round(c.transform.y,2)));
    field(box, Tn('ws.rotation'), rangeHTML('rotation', -180, 180, 1, L.round((c.transform&&c.transform.rotation)||0,0)));
    field(box, Tn('ws.opacity'), rangeHTML('opacity', 0, 1, 0.01, c.opacity));
    field(box, Tn('ws.speed'), rangeHTML('speed', 0.25, 2, 0.05, c.speed));
    field(box, Tn('ws.source')+' '+Tn('ws.start'), numberHTML('sourceStart', L.round(c.sourceStart,2)));
    field(box, Tn('ws.source')+' '+Tn('ws.end'), numberHTML('sourceEnd', L.round(c.sourceEnd,2)));
    field(box, Tn('ws.replace'), '<button class="btn btn-ghost sm" data-act="replace">'+Tn('ws.replace')+'</button>');
    box.insertAdjacentHTML('beforeend', '<div class="if-recommend"></div>');
    renderRecommendations(box.querySelector('.if-recommend'), c);
  }
  function renderSubtitleInspector(box, c){
    inspectorKind = 'subtitle';
    box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', '<div class="if-title">'+Tn('sub.title')+'</div>');
    field(box, Tn('ws.text'), '<textarea data-k="text" rows="2">'+esc(c.text||'')+'</textarea>');
    field(box, Tn('sub.font'), selectHTML('font', ['Inter, PingFang SC, sans-serif','Georgia, serif','JetBrains Mono, monospace','PingFang SC, sans-serif'], c.style.font||'Inter, PingFang SC, sans-serif'));
    field(box, Tn('sub.size'), rangeHTML('size', 20, 90, 1, c.style.size||46));
    field(box, Tn('sub.weight'), selectHTML('weight', [400,500,600,700,800], c.style.weight||600));
    field(box, Tn('sub.color'), colorHTML('color', c.style.color||'#FFFFFF'));
    field(box, Tn('sub.highlight'), '<input type="checkbox" data-k="highlight"'+(c.style.highlight!==false?' checked':'')+'>');
    field(box, Tn('sub.pos'), rangeHTML('posY', 0.1, 0.95, 0.01, c.style.posY!=null?c.style.posY:0.78));
    field(box, Tn('ws.bg'), '<input type="checkbox" data-k="bg"'+(c.style.bg!==false?' checked':'')+'>');
    field(box, Tn('ws.shadow'), '<input type="checkbox" data-k="shadow"'+(c.style.shadow!==false?' checked':'')+'>');
    field(box, Tn('sub.anim'), selectHTML('animation', ['rise','fade','pop','none'], c.style.animation||'rise'));
  }
  function renderVoiceInspector(box, c){
    inspectorKind = 'voice';
    const vs = project.voiceSegments.find(x=>x.id===c.voiceId);
    box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', '<div class="if-title">'+Tn('voice.title')+(vs?' — '+esc(vs.voiceId||''):'')+'</div>');
    field(box, Tn('ws.volume'), rangeHTML('volume', 0, 1.5, 0.05, c.volume));
    field(box, Tn('ws.speed'), rangeHTML('speed', 0.5, 2, 0.05, c.speed));
    field(box, Tn('ws.start'), numberHTML('timelineStart', L.round(c.timelineStart,2)));
    field(box, Tn('ws.end'), numberHTML('timelineEnd', L.round(c.timelineEnd,2)));
    if(vs){
      box.insertAdjacentHTML('beforeend', '<div class="if-note">'+(vs.status==='real'?'● ':'○ ')+Tn('voice.seg')+' '+esc(vs.text||'')+'</div>');
    }
  }
  function renderRecommendations(box, c){
    const sc = project.scenes.find(x=>x.id===c.sceneId);
    if(!sc) return;
    const recs = ML.matcher.recommendForScene(sc, project.assets, project.ratio, c.assetId);
    box.insertAdjacentHTML('beforeend', '<div class="if-recommend-title">'+Tn('ws.recommended')+'</div>');
    recs.forEach(r=>{
      const row = document.createElement('div');
      row.className = 'if-rec';
      row.innerHTML = '<span class="if-rec-name">'+esc(r.asset.name)+'</span><span class="if-rec-score">'+r.score+'</span><button class="btn btn-ghost sm" data-act="replaceWith" data-id="'+r.asset.id+'">'+Tn('ws.replace')+'</button>';
      box.appendChild(row);
    });
  }

  /* ============ inspector events ============ */
  function onInspectorChange(e2){
    const t = e2.target;
    const k = t.dataset.k;
    if(!k) return;
    const c = project.timeline.clips.find(x=>x.id===selectedClipId);
    if(!c) return;
    let v = t.type==='checkbox' ? t.checked : (t.type==='number' ? parseFloat(t.value) : t.value);
    if(t.type==='range'){ const vv = parseFloat(t.value); const lab = t.parentElement.querySelector('.if-val'); if(lab) lab.textContent = vv; }
    applyClipParam(c, k, v);
    if(t.type==='range' || t.type==='checkbox' || t.type==='color'){
      schedulePreviewRefresh();
    } else {
      pushHistory();
    }
    renderTimeline();
  }
  function applyClipParam(c, k, v){
    switch(k){
      case 'scale': c.transform.scale = L.clamp(parseFloat(v)||1, 0.5, 2.5); break;
      case 'x': c.transform.x = L.clamp(parseFloat(v)||0, -1, 1); break;
      case 'y': c.transform.y = L.clamp(parseFloat(v)||0, -1, 1); break;
      case 'rotation': c.transform.rotation = L.clamp(parseFloat(v)||0, -180, 180); break;
      case 'opacity': c.opacity = L.clamp(parseFloat(v)||1, 0, 1); break;
      case 'speed': c.speed = L.clamp(parseFloat(v)||1, 0.25, 2); break;
      case 'volume': c.volume = L.clamp(parseFloat(v)||1, 0, 1.5); break;
      case 'timelineStart': c.timelineStart = Math.max(0, parseFloat(v)||0); c.timelineEnd = Math.max(c.timelineStart+0.2, c.timelineEnd); break;
      case 'timelineEnd': c.timelineEnd = Math.max(c.timelineStart+0.2, parseFloat(v)||0); break;
      case 'sourceStart': c.sourceStart = Math.max(0, parseFloat(v)||0); break;
      case 'sourceEnd': c.sourceEnd = Math.max(c.sourceStart+0.2, parseFloat(v)||0); break;
      case 'text': c.text = String(v); c.lines = ML.subtitle.wrapLines(c.text); syncSceneText(c.sceneId, c.text); break;
      case 'font': case 'size': case 'weight': case 'color': case 'highlight': case 'bg': case 'shadow': case 'posY': case 'animation':
        c.style = c.style||{}; c.style[k] = v; break;
    }
  }
  function syncSceneText(sceneId, text){
    const sc = project.scenes.find(x=>x.id===sceneId);
    if(sc){ sc.text = text; sc.keywords = ML.providers.extractKeywords(text); }
  }
  function schedulePreviewRefresh(){
    /* throttled frame refresh for slider drags */
    if(!previewTimer){ previewTimer = setTimeout(()=>{ previewTimer = null; renderFrame(); }, 40); }
  }
  let previewTimer = null;

  /* ============ script / media / voice panes ============ */
  function renderLeft(){
    const pane = el('.ws-left-pane');
    if(!pane) return;
    if(leftTab==='script') renderScriptPane(pane);
    else if(leftTab==='media') renderMediaPane(pane);
    else renderVoicePane(pane);
  }
  function renderScriptPane(pane){
    pane.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'ws-pane';
    (project.scenes||[]).forEach(sc=>{
      const row = document.createElement('div');
      row.className = 'sc-row'+(sc.id===selectedSceneId?' sel':'')+(sc.weak?' weak':'');
      row.dataset.id = sc.id;
      row.innerHTML = '<div class="sc-head"><span class="sc-idx">'+String(sc.order).padStart(2,'0')+'</span><span class="sc-intent">'+esc(sc.intent||'')+'</span><span class="sc-dur">'+(sc.duration?L.round(sc.duration,1)+'s':'')+'</span></div>'+
        '<div class="sc-text">'+esc(sc.text)+'</div>'+
        '<div class="sc-meta"><span class="sc-kw">'+esc((sc.keywords||[]).join(' · '))+'</span>'+(sc.visualNeeds&&sc.visualNeeds.length?'<span class="sc-vis">'+esc(sc.visualNeeds.slice(0,3).join(' / '))+'</span>':'')+'</div>'+
        (sc.matchReasons&&sc.matchReasons.length?'<div class="sc-reason">'+Tn('ws.reason')+': '+esc(sc.matchReasons.slice(0,3).join(', '))+(sc.confidence?' · '+Tn('ws.confidence')+' '+sc.confidence+'%':'')+'</div>':'')+
        '<div class="sc-actions"><button class="btn btn-ghost sm" data-act="regenVisual" data-id="'+sc.id+'">'+Tn('ws.regenVisual')+'</button><button class="btn btn-ghost sm" data-act="regenVoice" data-id="'+sc.id+'">'+Tn('ws.regenVoice')+'</button></div>';
      row.addEventListener('click', ()=>selectScene(sc.id));
      wrap.appendChild(row);
    });
    if(!(project.scenes||[]).length){
      wrap.innerHTML = '<div class="ws-empty">'+Tn('sc.noScenes')+'</div>';
    }
    pane.appendChild(wrap);
  }
  function renderMediaPane(pane){
    pane.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'ws-pane ws-media-pane';
    const assets = project.assets||[];
    if(!assets.length){ wrap.innerHTML = '<div class="ws-empty">'+Tn('media.noAssets')+'</div>'; pane.appendChild(wrap); return; }
    assets.forEach(a=>{
      const card = document.createElement('div');
      card.className = 'media-card'+(a.id===selectedAssetId?' sel':'');
      card.dataset.id = a.id;
      card.draggable = true;
      card.addEventListener('dragstart', ev=>{
        ev.dataTransfer.setData('text/plain', a.id);
        ev.dataTransfer.effectAllowed = 'copy';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', ()=>card.classList.remove('dragging'));
      card.innerHTML = (a.thumb?'<div class="mc-thumb" style="background-image:url('+a.thumb+')"></div>':'<div class="mc-thumb mc-none"></div>')+
        '<div class="mc-name">'+esc(a.name)+'</div>'+
        '<div class="mc-meta">'+(a.type==='video'?'🎞 '+(a.duration?L.round(a.duration,1)+'s':'')+' · '+a.width+'×'+a.height : a.type==='image'?'🖼 '+a.width+'×'+a.height:'🎧 '+(a.duration?L.round(a.duration,1)+'s':''))+'</div>'+
        (a.analysis&&a.analysis.tags&&a.analysis.tags.length?'<div class="mc-tags">'+esc(a.analysis.tags.slice(0,4).join(' · '))+'</div>':'')+
        (a.analysis&&a.analysis.mock?'<div class="mc-mock">'+Tn('media.mock')+'</div>':'')+
        '<div class="mc-actions"><button class="btn btn-ghost sm" data-act="useAsset" data-id="'+a.id+'">'+Tn('ws.replace')+'</button></div>';
      card.addEventListener('click', ()=>selectAsset(a.id));
      wrap.appendChild(card);
    });
    if(assets.length) wrap.insertAdjacentHTML('beforeend', '<div class="mc-drophint">'+Tn('media.dragHint')+'</div>');
    pane.appendChild(wrap);
  }
  /* CapCut-like: drop media asset onto a track to create a clip */
  function bindTimelineDrop(){
    const tlMain = el('.tl-main');
    if(!tlMain) return;
    /* scroll ruler canvas + ruler playhead in sync with tracks */
    const tracks = el('.tl-tracks');
    const rulerCanvas = el('.tl-ruler-canvas');
    const rulerPh = el('.tl-ruler-playhead');
    if(tracks && rulerCanvas){
      tracks.addEventListener('scroll', ()=>{
        rulerCanvas.style.transform = 'translateX('+(-tracks.scrollLeft)+'px)';
        if(rulerPh) rulerPh.style.transform = 'translateX('+(-tracks.scrollLeft)+'px)';
      });
    }
    tlMain.addEventListener('dragover', ev=>{ ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
    tlMain.addEventListener('drop', ev=>{
      ev.preventDefault();
      const assetId = ev.dataTransfer.getData('text/plain');
      const asset = (project.assets||[]).find(a=>a.id===assetId);
      if(!asset) return;
      const row = ev.target.closest && ev.target.closest('.tl-row');
      if(!row || !row.dataset.track) return;
      const track = row.dataset.track;
      if(track==='subtitle' || track==='marker'){ ML.lib.toast(Tn('media.dropDenied')); return; }
      const r = tlMain.getBoundingClientRect();
      const t = L.clamp((ev.clientX - r.left + tlMain.scrollLeft)/tlZoom, 0, duration());
      const dur = asset.type==='image' ? 3 : (asset.duration && asset.duration>0.3 ? asset.duration : 3);
      const clip = {
        id: 'c'+L.uid(), track,
        assetId: asset.id, sceneId: null,
        sourceStart: 0, sourceEnd: Math.min(dur, asset.duration||dur),
        timelineStart: Math.round(t*10)/10, timelineEnd: Math.round((t+dur)*10)/10,
        transform: { scale:1, x:0, y:0, rotation:0 },
        opacity: 1, volume: 1, speed: 1,
        text: track==='voice' ? 'Voice' : asset.name
      };
      ML.timeline.addClip(project, clip);
      pushHistory(); dirtyFlag = true;
      selectedClipId = clip.id; renderTimeline(); renderInspector(); syncScript();
      ML.lib.toast(Tn('media.added'));
    });
  }
  function renderVoicePane(pane){
    pane.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'ws-pane ws-voice-pane';
    const vs = project.voiceSegments||[];
    const anyReal = vs.some(v=>v.status==='real');
    if(!anyReal){
      wrap.innerHTML = '<div class="ws-empty">'+Tn('voice.mock')+'</div>';
      pane.appendChild(wrap); return;
    }
    vs.forEach(v=>{
      const row = document.createElement('div');
      row.className = 'sc-row';
      const sc = project.scenes.find(x=>x.id===v.sceneId);
      row.innerHTML = '<div class="sc-head"><span class="sc-idx">'+String(sc?sc.order:'?').padStart(2,'0')+'</span><span class="sc-intent">'+esc(v.voiceId||'')+'</span><span class="sc-dur">'+L.round(v.duration,1)+'s</span></div><div class="sc-text">'+esc(v.text||'')+'</div>';
      wrap.appendChild(row);
    });
    pane.appendChild(wrap);
  }
  function selectScene(id){
    selectedSceneId = id;
    const sc = project.scenes.find(x=>x.id===id);
    if(sc){
      let t = 0;
      for(const s of project.scenes){ if(s.id===id) break; t += s.duration; }
      seek(t);
    }
    renderLeft(); renderTimeline();
  }
  function selectAsset(id){
    selectedAssetId = id;
    const c = project.timeline.clips.find(x=>x.id===selectedClipId);
    if(c && c.track==='video'){
      ML.timeline.replaceAsset(project, c.id, id);
      pushHistory(); dirtyFlag = true; renderTimeline(); renderInspector();
      ML.lib.toast(Tn('ws.replaced'));
    }
    renderLeft();
  }
  function syncScript(){
    qAll('.sc-row').forEach(r=>r.classList.toggle('sel', r.dataset.id===selectedSceneId));
  }

  /* ============ timeline toolbar actions ============ */
  function doSplit(){
    const c = project.timeline.clips.find(x=>x.id===selectedClipId);
    if(!c || c.track!=='video') return;
    const res = ML.timeline.splitClip(project, c.id, currentTime);
    if(res){ selectedClipId = null; pushHistory(); dirtyFlag = true; renderTimeline(); renderInspector(); }
  }
  function doDelete(){
    const c = project.timeline.clips.find(x=>x.id===selectedClipId);
    if(!c) return;
    ML.timeline.removeClip(project, c.id);
    selectedClipId = null; pushHistory(); dirtyFlag = true; renderTimeline(); renderInspector();
  }
  function doDuplicate(){
    const c = project.timeline.clips.find(x=>x.id===selectedClipId);
    if(!c) return;
    const d = ML.timeline.duplicateClip(project, c.id);
    if(d){ selectedClipId = d.id; pushHistory(); dirtyFlag = true; renderTimeline(); renderInspector(); }
  }
  function doMute(){
    const c = project.timeline.clips.find(x=>x.id===selectedClipId);
    if(!c) return;
    c.muted = !c.muted; pushHistory(); dirtyFlag = true; renderTimeline();
  }
  function doLock(){
    const c = project.timeline.clips.find(x=>x.id===selectedClipId);
    if(!c) return;
    c.locked = !c.locked; pushHistory(); dirtyFlag = true; renderTimeline();
  }

  /* ============ regen (scene-level) ============ */
  async function regenVisual(sceneId){
    await ML.autoedit.regenVisual(project, sceneId);
    pushHistory(); dirtyFlag = true; renderTimeline(); renderLeft(); renderInspector();
    ML.lib.toast(Tn('ws.regenDone'));
  }
  async function regenVoice(sceneId){
    try{
      await ML.autoedit.regenVoice(project, sceneId);
      pushHistory(); dirtyFlag = true; renderTimeline(); renderLeft();
      ML.lib.toast(Tn('ws.regenDone'));
    }catch(e){
      ML.lib.toast(String(e&&e.message||e), true);
    }
  }

  /* ============ events ============ */
  function bindEvents(){
    bindTimelineDrop();
    root.addEventListener('click', ev=>{
      const act = ev.target.closest('[data-act]');
      if(!act) return;
      const a = act.dataset.act;
      switch(a){
        case 'back': ML.router.go('/projects'); break;
        case 'undo': undo(); dirtyFlag=true; renderAll(); break;
        case 'redo': redo(); dirtyFlag=true; renderAll(); break;
        case 'save': saveNow(); break;
        case 'preview': break;
        case 'play': toggle(); break;
        case 'export': openExport(); break;
        case 'split': doSplit(); break;
        case 'delete': doDelete(); break;
        case 'dup': doDuplicate(); break;
        case 'mute': doMute(); break;
        case 'lock': doLock(); break;
        case 'regenVisual': regenVisual(act.dataset.id); break;
        case 'regenVoice': regenVoice(act.dataset.id); break;
        case 'replace': openReplaceModal(); break;
        case 'replaceWith': {
          const c = project.timeline.clips.find(x=>x.id===selectedClipId);
          if(c){ ML.timeline.replaceAsset(project, c.id, act.dataset.id); pushHistory(); dirtyFlag=true; renderTimeline(); renderInspector(); ML.lib.toast(Tn('ws.replaced')); }
          break;
        }
        case 'useAsset': selectAsset(act.dataset.id); break;
      }
    });
    root.addEventListener('input', onInspectorChange);
    root.addEventListener('change', onInspectorChange);
    root.addEventListener('keydown', ev=>{
      if(ev.target && (ev.target.tagName==='TEXTAREA'||ev.target.tagName==='INPUT')) return;
      if(ev.key===' ') { ev.preventDefault(); toggle(); }
      if(ev.key==='Delete'||ev.key==='Backspace'){ if(selectedClipId) doDelete(); }
    });
    const tabs = qAll('.ws-tab');
    tabs.forEach(t=>t.addEventListener('click', ()=>{
      leftTab = t.dataset.tab; renderLeft();
      tabs.forEach(x=>x.classList.toggle('on', x===t));
    }));
    /* timeline seek — ruler canvas + empty track area */
    const tlMain = el('.tl-main');
    if(tlMain){
      tlMain.addEventListener('click', ev=>{
        if(ev.target.closest('.tl-clip')) return;
        const d = Math.max(0.1, duration());
        const r = tlMain.getBoundingClientRect();
        const t = (ev.clientX - r.left + tlMain.scrollLeft) / tlZoom;
        seek(L.clamp(t, 0, d));
      });
    }
    /* timeline zoom controls */
    const zoomIn = el('[data-act=zoomIn]'), zoomOut = el('[data-act=zoomOut]');
    const applyZoom = z=>{
      tlZoom = L.clamp(Math.round(z), 30, 300);
      const zv = el('#tlZoomVal'); if(zv) zv.textContent = Math.round(tlZoom/90*100)+'%';
      renderTimeline();
    };
    if(zoomIn) zoomIn.addEventListener('click', ()=>applyZoom(tlZoom*1.3));
    if(zoomOut) zoomOut.addEventListener('click', ()=>applyZoom(tlZoom/1.3));
    /* safe area toggle */
    const sf = el('.ws-safearea');
    if(sf) sf.addEventListener('change', ()=>root.querySelector('.ws-canvas-wrap').classList.toggle('safe-on', sf.checked));
  }

  /* ============ replace modal ============ */
  function openReplaceModal(){
    const assets = project.assets||[];
    const c = project.timeline.clips.find(x=>x.id===selectedClipId);
    if(!c) return;
    const items = assets.filter(a=>a.type==='video'||a.type==='image').map(a=>
      '<div class="rm-item" data-id="'+a.id+'">'+(a.thumb?'<img src="'+a.thumb+'">':'<div class="rm-none"></div>')+'<span>'+esc(a.name)+'</span></div>').join('');
    ML.lib.modal(Tn('ws.replace'), '<div class="rm-grid">'+items+'</div>', ()=>{
      const pick = root.querySelector('.rm-item.sel');
      if(pick){
        ML.timeline.replaceAsset(project, c.id, pick.dataset.id);
        pushHistory(); dirtyFlag = true; renderTimeline(); renderInspector();
        ML.lib.toast(Tn('ws.replaced'));
      }
    });
    const grid = document.querySelector('.rm-grid');
    if(grid) grid.addEventListener('click', e=>{
      const it = e.target.closest('.rm-item'); if(!it) return;
      qAll('.rm-item').forEach(x=>x.classList.remove('sel'));
      it.classList.add('sel');
    });
  }

  /* ============ export modal ============ */
  function openExport(){
    const cap = ML.cap.summary();
    const dur = duration();
    const [w,h] = ML.compose.ratioSize(project.ratio, 1080);
    const v = ML.export.validateProject(project);
    const noRealAudio = !(project.voiceSegments||[]).some(s=>s.status==='real');
    ML.lib.modal(Tn('exp.title'), ''+
      '<div class="exp-row"><span>'+Tn('exp.format')+'</span><span class="exp-strong">MP4 · H.264</span></div>'+
      '<div class="exp-row"><span>'+Tn('exp.res')+'</span><span class="exp-strong">'+w+' × '+h+'</span></div>'+
      '<div class="exp-row"><span>'+Tn('exp.fps')+'</span><span class="exp-strong">30</span></div>'+
      '<div class="exp-row"><span>'+Tn('exp.dur')+'</span><span class="exp-strong">'+L.round(dur,2)+'s</span></div>'+
      '<div class="exp-row"><span>'+Tn('ws.tr.voice')+'</span><span class="exp-strong">'+(noRealAudio?Tn('exp.noAudio'):'●')+'</span></div>'+
      (v.ok?'':'<div class="exp-err">'+esc(v.problems.join('; '))+'</div>')+
      '<div class="exp-progress" hidden><div class="exp-bar"><div class="exp-bar-in"></div></div><div class="exp-stage">'+Tn('exp.progress')+'</div></div>'+
      '<div class="exp-actions"><button class="btn" data-exp="go"'+(cap.mp4?'':' disabled')+'>'+Tn('exp.start')+'</button><button class="btn btn-ghost" data-exp="cancel" hidden>'+Tn('exp.cancel')+'</button><button class="btn btn-ghost" data-exp="srt">'+Tn('exp.srt')+'</button></div>'+
      (cap.mp4?'':'<div class="exp-err">'+Tn('exp.unavailable')+'</div>'),
    ()=>{}, false);
    const box = document.querySelector('.modal-body');
    if(box){
      box.addEventListener('click', async e2=>{
        const b = e2.target.closest('[data-exp]');
        if(!b) return;
        if(b.dataset.exp==='srt'){
          const out = ML.export.exportSRT(project);
          ML.lib.download(out.blob, out.name);
          ML.lib.toast(Tn('exp.srtDone'));
          return;
        }
        if(b.dataset.exp==='go' && cap.mp4 && !b.disabled){
          const pb = box.querySelector('.exp-progress'), stage = box.querySelector('.exp-stage'), bar = box.querySelector('.exp-bar-in');
          const goBtn = box.querySelector('[data-exp=go]'), cancelBtn = box.querySelector('[data-exp=cancel]');
          pb.hidden = false; goBtn.disabled = true; cancelBtn.hidden = false;
          const onProg = (st, pct)=>{ stage.textContent = st+' '+Math.round(pct)+'%'; bar.style.width = pct+'%'; };
          try{
            const res = await ML.export.exportMP4(project, { fps:30, base:1080, bitrate:8 }, onProg);
            onProg(Tn('exp.complete'), 100);
            ML.lib.download(res.blob, res.name);
            setTimeout(()=>{ pb.hidden = true; goBtn.disabled=false; cancelBtn.hidden=true; }, 400);
          }catch(err){
            ML.lib.toast(err && err.message==='cancelled' ? Tn('ae.cancelled') : String(err&&err.message||err), true);
            pb.hidden = true; goBtn.disabled=false; cancelBtn.hidden=true;
          }
        }
      });
      box.addEventListener('click', e2=>{ const c = e2.target.closest('[data-exp=cancel]'); if(c) ML.export.cancel(); });
    }
  }

  /* ============ mount / unmount ============ */
  function renderAll(){
    renderTimeline(); renderFrame(); updateTimecode(); renderLeft(); renderInspector(); updateTransport();
    const nameEl = el('.ws-proj-name');
    if(nameEl) nameEl.textContent = project.name||Tn('proj.untitled');
    const ratioEl = el('.ws-ratio');
    if(ratioEl) ratioEl.textContent = project.ratio;
  }
  function updateTransport(){
    const pb = el('.ws-play');
    if(pb) pb.textContent = playing ? '❚❚' : '▶';
    const pl = el('.ws-loop');
    if(pl) pl.classList.toggle('on', loop);
  }
  async function mount(container, pid){
    root = container;
    projectId = pid;
    project = await ML.store.getProject(pid);
    if(!project){ container.innerHTML = '<div class="ws-error">'+Tn('err.generic')+'</div>'; return; }
    if(!project.timeline) project.timeline = { clips: [], duration: 0 };
    if(!project.assets) project.assets = [];
    if(!project.scenes) project.scenes = [];
    if(!project.voiceSegments) project.voiceSegments = [];
    if(!project.settings) project.settings = {};
    history = [snap()]; hIdx = 0;
    container.innerHTML = ''+
      '<div class="ws-top">'+
        '<button class="btn btn-ghost" data-act="back">← '+Tn('nav.projects')+'</button>'+
        '<span class="ws-proj-name"></span>'+
        '<span class="ws-ratio"></span>'+
        '<span class="ws-spacer"></span>'+
        '<button class="btn btn-ghost sm" data-act="undo">↶</button>'+
        '<button class="btn btn-ghost sm" data-act="redo">↷</button>'+
        '<button class="btn btn-ghost sm" data-act="save">'+(ML.i18n.lang==='zh'?'保存':'Save')+'</button>'+
        '<button class="btn btn-primary sm ws-export" data-act="export">'+Tn('exp.start')+'</button>'+
      '</div>'+
      '<div class="ws-body">'+
        '<aside class="ws-left">'+
          '<div class="ws-tabs"><button class="ws-tab on" data-tab="script">'+Tn('ws.tabsScript')+'</button><button class="ws-tab" data-tab="media">'+Tn('ws.tabsMedia')+'</button><button class="ws-tab" data-tab="voice">'+Tn('ws.tabsVoice')+'</button></div>'+
          '<div class="ws-left-pane"></div>'+
        '</aside>'+
        '<div class="ws-center">'+
          '<div class="ws-canvas-wrap"><canvas class="ws-canvas"></canvas><div class="ws-sa-hint">'+Tn('sub.safe')+'</div></div>'+
          '<div class="ws-transport">'+
            '<button class="btn btn-ghost sm ws-step" data-step="-1">⏮</button>'+
            '<button class="btn sm ws-play" data-act="play">▶</button>'+
            '<button class="btn btn-ghost sm ws-step" data-step="1">⏭</button>'+
            '<button class="btn btn-ghost sm ws-loop">↻</button>'+
            '<span class="ws-timecode">00:00.0 / 00:00.0</span>'+
            '<span class="ws-speed" contenteditable="true">1x</span>'+
          '</div>'+
        '</div>'+
        '<aside class="ws-right"><div class="ws-inspector-title">'+Tn('ws.inspector')+'</div><div class="ws-inspector-body"></div></aside>'+
      '</div>'+
      '<div class="ws-timeline">'+
        '<div class="tl-toolbar">'+
          '<span class="tl-tb-label">'+Tn('ws.timeline')+'</span>'+
          '<button class="btn btn-ghost sm" data-act="split">'+Tn('ws.split')+'</button>'+
          '<button class="btn btn-ghost sm" data-act="dup">'+Tn('ws.duplicated')+'</button>'+
          '<button class="btn btn-ghost sm" data-act="delete">'+Tn('ws.deleted')+'</button>'+
          '<button class="btn btn-ghost sm" data-act="mute">'+Tn('ws.muted')+'</button>'+
          '<button class="btn btn-ghost sm" data-act="lock">'+Tn('ws.locked')+'</button>'+
          '<span class="tl-tb-spacer"></span>'+
          '<span class="tl-zoomctl"><button class="btn btn-ghost sm" data-act="zoomOut">−</button><span class="tl-zoomval" id="tlZoomVal">100%</span><button class="btn btn-ghost sm" data-act="zoomIn">+</button></span>'+
          '<label class="ws-sf"><input type="checkbox" class="ws-safearea"> '+Tn('sub.safe')+'</label>'+
        '</div>'+
        '<div class="tl-wrap">'+
          '<div class="tl-heads">'+
            '<div class="tl-rh tl-rh-ruler"></div>'+
            '<div class="tl-rh"><span class="tl-rh-ic">🎞</span><span>'+Tn('ws.tr.video')+'</span></div>'+
            '<div class="tl-rh"><span class="tl-rh-ic">🎙</span><span>'+Tn('ws.tr.voice')+'</span></div>'+
            '<div class="tl-rh"><span class="tl-rh-ic">Aa</span><span>'+Tn('ws.tr.subtitle')+'</span></div>'+
            '<div class="tl-rh"><span class="tl-rh-ic">▣</span><span>'+Tn('ws.tr.marker')+'</span></div>'+
          '</div>'+
          '<div class="tl-main">'+
            '<div class="tl-ruler"><canvas class="tl-ruler-canvas"></canvas><div class="tl-ruler-playhead"></div></div>'+
            '<div class="tl-tracks">'+
              '<div class="tl-row" data-track="video"><div class="tl-clips"></div></div>'+
              '<div class="tl-row" data-track="voice"><div class="tl-clips"></div></div>'+
              '<div class="tl-row" data-track="subtitle"><div class="tl-clips"></div></div>'+
              '<div class="tl-row" data-track="marker"><div class="tl-clips"></div></div>'+
              '<div class="tl-playhead"></div>'+
            '</div>'+
          '</div>'+
        '</div>'+
      '</div>';
    bindEvents();
    const cv = el('.ws-canvas');
    const [W,H] = ML.compose.ratioSize(project.ratio, 720);
    cv.width = W; cv.height = H;
    /* canvas size class for CSS sizing */
    cv.style.aspectRatio = W+'/'+H;
    /* step buttons */
    qAll('.ws-step').forEach(b=>b.addEventListener('click', ()=>stepFrame(parseInt(b.dataset.step,10))));
    el('.ws-loop').addEventListener('click', ()=>{ loop=!loop; updateTransport(); });
    el('.ws-speed').addEventListener('input', ()=>{
      const v = parseFloat(el('.ws-speed').textContent);
      playbackRate = isFinite(v)&&v>0 ? L.clamp(v,0.25,2) : 1;
      el('.ws-speed').textContent = playbackRate+'x';
    });
    renderAll();
    /* canvas click → seek near center */
    cv.addEventListener('pointerdown', ev=>{
      const r = cv.getBoundingClientRect();
      const d = Math.max(0.1, duration());
      seek(((ev.clientX-r.left)/r.width)*d);
    });
  }
  function unmount(){
    stop();
    ML.voice.stopPreview();
    if(saveTimer) clearTimeout(saveTimer);
    root = null; ctx = null; project = null; projectId = null;
    history = []; hIdx = -1; selectedClipId = null; selectedSceneId = null;
  }

  return {
    mount, unmount,
    undo, redo, saveNow,
    isActive(){ return !!root; },
    projectId(){ return projectId; }
  };
})();
