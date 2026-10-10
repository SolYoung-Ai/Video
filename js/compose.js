/* ============ ML.compose — unified composition renderer (Preview = Export) ============ */
/* Renders a single frame of the FINAL timeline (video + subtitle + voice-driven timing).
   Used by both workspace preview and export — one code path, no drift. */
ML.compose = (function(){
  const L = ML.lib;
  const _els = {}; /* assetId → {video?, img?, url} */

  async function loadAsset(asset){
    if(!asset) return null;
    if(_els[asset.id]) return _els[asset.id];
    const url = await ML.media.loadBlobUrl(asset);
    if(!url) return null;
    let el;
    if(asset.type==='video'){
      el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.preload = 'auto';
      el.src = url;
      el.load();
      _els[asset.id] = { video: el, url, type:'video' };
    } else if(asset.type==='image'){
      el = new Image();
      el.src = url;
      _els[asset.id] = { img: el, url, type:'image' };
    }
    return _els[asset.id] || null;
  }
  function release(assetId){ const e = _els[assetId]; if(e){ if(e.url) URL.revokeObjectURL(e.url); delete _els[assetId]; } }

  /* draw video/image clip covering canvas — real cover/contain/fill math */
  function drawMedia(ctx, entry, clip, asset, t, W, H){
    const mode = (clip.transform && clip.transform.crop) || clip.crop || 'cover';
    const scale = (clip.transform && clip.transform.scale) || 1;
    const cx = (clip.transform && clip.transform.x) || 0;
    const cy = (clip.transform && clip.transform.y) || 0;
    const ar = (asset && asset.width && asset.height) ? asset.width/asset.height : W/H;
    const target = W/H;
    let dw = W, dh = H;
    if(mode==='fill'){ dw = W; dh = H; }
    else if(mode==='contain'){
      if(ar >= target){ dw = W; dh = W/ar; } else { dh = H; dw = H*ar; }
    } else { /* cover */
      if(ar >= target){ dh = H; dw = H*ar; } else { dw = W; dh = W/ar; }
    }
    dw *= scale; dh *= scale;
    const dx = (W-dw)/2 + cx, dy = (H-dh)/2 + cy;

    /* Ken Burns for images: gentle push-in across the clip */
    let k = 0;
    if(entry.type==='image'){
      const dur = Math.max(0.1, clip.timelineEnd - clip.timelineStart);
      const p = L.clamp((t - clip.timelineStart)/dur, 0, 1);
      k = 0.04 * p; /* up to 4% */
    }
    const s = 1 + k;
    const sw = dw*s, sh = dh*s;
    const sx = dx - (sw-dw)/2, sy = dy - (sh-dh)/2;

    ctx.save();
    let alpha = (clip.opacity!=null?clip.opacity:1);
    /* cinematic fade transition at clip edges (seconds, style-driven) */
    const fade = (clip.transition && clip.transition>0) ? clip.transition : 0;
    if(fade>0){
      const dur = Math.max(0.1, clip.timelineEnd - clip.timelineStart);
      const p = L.clamp((t - clip.timelineStart)/dur, 0, 1);
      const ft = L.clamp(fade/dur, 0.01, 0.5);
      if(p < ft) alpha *= p/ft;
      if(p > 1-ft) alpha *= (1-p)/ft;
    }
    ctx.globalAlpha = L.clamp(alpha, 0, 1);
    const rot = (clip.transform && clip.transform.rotation) || 0;
    if(rot){
      ctx.translate(W/2, H/2);
      ctx.rotate(rot*Math.PI/180);
      ctx.translate(-W/2, -H/2);
    }
    if(entry.type==='video' && entry.video){
      const v = entry.video;
      const srcT = L.clamp(clip.sourceStart + (t - clip.timelineStart)*((clip.speed||1)), clip.sourceStart, clip.sourceEnd);
      try{ if(Math.abs((v.currentTime||0)-srcT)>0.08 && v.readyState>=1) v.currentTime = srcT; }catch(e){}
      if(v.readyState>=2) ctx.drawImage(v, sx, sy, sw, sh);
      else { ctx.fillStyle='#0a0a0a'; ctx.fillRect(sx, sy, sw, sh); }
    } else if(entry.type==='image' && entry.img && entry.img.complete && entry.img.naturalWidth){
      ctx.drawImage(entry.img, sx, sy, sw, sh);
    } else { ctx.fillStyle='#0c0c0c'; ctx.fillRect(sx, sy, sw, sh); }
    ctx.restore();
  }

  function fit(asset, W, H){
    if(!asset || !asset.width || !asset.height) return { ratio: W/H };
    return { ratio: asset.width/asset.height };
  }

  function drawSubtitle(ctx, sub, t, W, H){
    if(!sub || t < sub.timelineStart || t > sub.timelineEnd) return;
    const st = sub.style || {};
    const dur = Math.max(0.1, sub.timelineEnd - sub.timelineStart);
    const p = L.clamp((t - sub.timelineStart)/dur, 0, 1);
    const fadeIn = 0.18, fadeOut = 0.15;
    let alpha = 1;
    if(p < fadeIn) alpha = p/fadeIn;
    if(p > 1-fadeOut) alpha = Math.max(0, (1-p)/fadeOut);

    const size = Math.max(14, Math.round((st.size||46) * (H/1080)));
    ctx.save();
    ctx.font = (st.weight||600) + ' ' + size + 'px ' + (st.font||'Inter, PingFang SC, sans-serif');
    try{ ctx.letterSpacing = ((st.tracking||0)*size)+'px'; }catch(e){}
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let y = H * (st.posY != null ? st.posY : 0.78);
    let animScale = 1, animAlpha = alpha;
    const anim = st.animation || 'rise';
    if(anim==='rise'){ y += (1-p)*14; animAlpha = alpha; }
    if(anim==='fade'){ animAlpha = alpha; }
    if(anim==='pop'){ animScale = 1 + Math.max(0, 0.06*(1-p)); animAlpha = alpha; }

    const lines = sub.lines && sub.lines.length ? sub.lines : [sub.text||' '];
    const lineH = size*1.25;
    const startY = y - (lines.length-1)*lineH/2;
    ctx.globalAlpha = animAlpha;
    const align = st.align || 'center';

    const keywords = (sub.keywords||[]);
    lines.forEach((ln, i)=>{
      const ly = startY + i*lineH;
      const tw = ctx.measureText(ln).width;
      /* align-aware line center */
      let x = W/2;
      if(align==='left') x = W*0.10 + tw/2;
      if(align==='right') x = W*0.90 - tw/2;
      /* background pill */
      if(st.bg){
        ctx.fillStyle = st.bgColor || 'rgba(0,0,0,0.35)';
        const pad = size*0.45, rad = st.radius!=null?st.radius:8;
        roundRect(ctx, x-tw/2-pad, ly-lineH/2-pad*0.5, tw+pad*2, lineH+pad, rad);
        ctx.fill();
      }
      if(st.shadow){ ctx.shadowColor='rgba(0,0,0,0.7)'; ctx.shadowBlur = size*0.18; ctx.shadowOffsetY = 2; }
      /* highlighted keyword segments */
      const segs = ML.subtitle.segments(ln, keywords, st.highlight!==false);
      let drawX = x - ctx.measureText(ln).width/2;
      segs.forEach(sg=>{
        ctx.fillStyle = sg.hl ? (st.highlightColor||st.color||'#fff') : (st.color||'#fff');
        ctx.fillText(sg.t, drawX, ly);
        drawX += ctx.measureText(sg.t).width;
      });
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    });
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  /* main frame function — single source of truth */
  async function renderFrame(project, t, ctx, W, H){
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    const clip = ML.timeline.activeVideoAt(project, t);
    if(clip && clip.assetId){
      const asset = project.assets.find(a=>a.id===clip.assetId);
      if(asset){
        const entry = await loadAsset(asset);
        if(entry) drawMedia(ctx, entry, clip, asset, t, W, H);
      }
    }
    const sub = ML.timeline.activeSubtitleAt(project, t);
    if(sub) drawSubtitle(ctx, sub, t, W, H);
  }

  /* aspect helpers */
  function ratioSize(ratio, base){
    base = base || 1080;
    const map = { '1:1':[base,base], '4:5':[base,Math.round(base*1.25)], '3:4':[Math.round(base*0.75),base],
      '4:3':[base,Math.round(base*0.75)], '9:16':[Math.round(base*0.5625),base], '16:9':[base,Math.round(base*0.5625)],
      '3:2':[base,Math.round(base*0.6667)], '21:9':[base,Math.round(base*0.4286)] };
    return map[ratio] || [base, base];
  }

  return { renderFrame, loadAsset, release, ratioSize };
})();
