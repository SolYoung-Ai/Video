/* ============ ML.lib — utils ============ */
window.ML = window.ML || {};
ML.lib = (function(){
  const $ = (s, el) => (el||document).querySelector(s);
  const $$ = (s, el) => Array.from((el||document).querySelectorAll(s));
  function el(tag, cls, html){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(html !== undefined) e.innerHTML = html;
    return e;
  }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function round(v, d){ d = d==null?0:d; const p = Math.pow(10,d); return Math.round(Number(v)*p)/p; }
  function lerp(a, b, t){ return a + (b-a)*t; }
  function uid(){ return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function debounce(fn, ms){ let t; return function(...a){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,a), ms); }; }
  function fmtTime(s){ s = Math.max(0, s); const m = Math.floor(s/60); const ss = s - m*60; return (m<10?'0':'')+m+':'+(ss<10?'0':'')+ss.toFixed(1); }
  function fmtBytes(b){
    if(b > 1e9) return (b/1e9).toFixed(2)+' GB';
    if(b > 1e6) return (b/1e6).toFixed(1)+' MB';
    if(b > 1e3) return (b/1e3).toFixed(0)+' KB';
    return b+' B';
  }
  function download(blob, name){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function readFile(file, asDataURL){
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('read_failed'));
      asDataURL ? r.readAsDataURL(file) : r.readAsText(file);
    });
  }
  /* deterministic rng */
  function mulberry32(seed){
    let a = seed >>> 0;
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s){
    let h = 0;
    for(let i=0;i<s.length;i++){ h = ((h<<5)-h + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }
  /* ===== colors ===== */
  function hexToRgb(hex){
    hex = String(hex||'#000000').replace('#','');
    if(hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
    const n = parseInt(hex, 16);
    if(isNaN(n)) return {r:0,g:0,b:0};
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
  }
  function rgbToHex(r,g,b){
    const h = c => clamp(Math.round(c),0,255).toString(16).padStart(2,'0');
    return '#'+h(r)+h(g)+h(b);
  }
  function rgbToHsl(r,g,b){
    r/=255; g/=255; b/=255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h=0,s=0; const l=(max+min)/2;
    if(max!==min){
      const d = max-min;
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: h = (g-b)/d + (g<b?6:0); break;
        case g: h = (b-r)/d + 2; break;
        default: h = (r-g)/d + 4;
      }
      h *= 60;
    }
    return {h,s,l};
  }
  function hslToHex(h,s,l){
    h = ((h%360)+360)%360; s = clamp(s,0,1); l = clamp(l,0,1);
    const c = (1-Math.abs(2*l-1))*s, x = c*(1-Math.abs(((h/60)%2)-1)), m = l-c/2;
    let r=0,g=0,b=0;
    if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}
    else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}
    return rgbToHex((r+m)*255,(g+m)*255,(b+m)*255);
  }
  function mix(a, b, t){
    const ca = hexToRgb(a), cb = hexToRgb(b);
    return rgbToHex(lerp(ca.r,cb.r,t), lerp(ca.g,cb.g,t), lerp(ca.b,cb.b,t));
  }
  function parseColor(str){
    str = String(str||'').trim().toLowerCase();
    if(str[0]==='#') return {type:'hex', v:str.slice(0,7)};
    let m = str.match(/rgba?\(([^)]+)\)/);
    if(m){
      const p = m[1].split(',').map(s=>parseFloat(s));
      return {type:'rgb', r:p[0], g:p[1], b:p[2]};
    }
    m = str.match(/hsla?\(([^)]+)\)/);
    if(m){
      const p = m[1].split(',').map(s=>parseFloat(s));
      return {type:'hsl', h:p[0], s:p[1], l:p[2]};
    }
    return {type:'hex', v:'#000000'};
  }
  /* ===== events ===== */
  const bus = { map:{} };
  bus.on = function(ev, fn){ (this.map[ev] = this.map[ev]||[]).push(fn); return () => this.off(ev, fn); };
  bus.off = function(ev, fn){ if(this.map[ev]) this.map[ev] = this.map[ev].filter(f=>f!==fn); };
  bus.emit = function(ev, data){ (this.map[ev]||[]).forEach(f=>{ try{ f(data); }catch(e){ console.error(e); } }); };
  ML.bus = bus; /* top-level alias used across modules */
  /* ===== toast ===== */
  function toast(msg, type){
    const wrap = $('#toasts');
    const t = el('div', 'toast'+(type?' '+type:''), '<i></i><span>'+msg+'</span>');
    wrap.appendChild(t);
    setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(), 320); }, 2600);
  }
  /* ===== modal (object API) ===== */
  function modal(opts){
    /* compat: modal(title, html, onClick) string form */
    if(typeof opts === 'string'){
      const title = opts, html = arguments[1], onClick = arguments[2];
      opts = { title, body: el('div','modal-html', html), actions: onClick ? [{ label: 'OK', cls: '', onClick }] : [] };
    }
    const mask = el('div','modal-mask');
    const m = el('div','modal');
    m.innerHTML = '<div class="modal-head"><div class="modal-title">'+opts.title+'</div><button class="modal-close">✕</button></div>';
    const body = el('div','modal-body');
    if(opts.body) body.appendChild(opts.body);
    m.appendChild(body);
    const foot = el('div','modal-foot');
    if(opts.actions){
      opts.actions.forEach(a => {
        const b = el('button', 'btn '+(a.cls||''), a.label);
        b.addEventListener('click', () => { const r = a.onClick && a.onClick(b, close); if(r !== false) close(); });
        foot.appendChild(b);
      });
    }
    m.appendChild(foot);
    mask.appendChild(m); $('#overlays').appendChild(mask);
    function close(){ mask.remove(); opts.onClose && opts.onClose(); }
    const closeBtn = $('.modal-close', m);
    if(closeBtn) closeBtn.addEventListener('click', close);
    mask.addEventListener('click', e => { if(e.target === mask) close(); });
    return { el: m, close, body };
  }
  /* ===== confirm dialog ===== */
  function confirm(msg, okLabel){
    return new Promise(res => {
      const mask = el('div','modal-mask');
      const m = el('div','modal modal-confirm');
      m.innerHTML = '<div class="modal-body">'+msg+'</div><div class="modal-foot"><button class="btn btn-ghost">Cancel</button><button class="btn">'+(okLabel||'OK')+'</button></div>';
      mask.appendChild(m); $('#overlays').appendChild(mask);
      const close = v => { mask.remove(); res(v); };
      const x = m.querySelector('.modal-close');
      if(x) x.addEventListener('click', ()=>close(false));
      const cancelBtn = m.querySelector('.btn-ghost');
      if(cancelBtn) cancelBtn.addEventListener('click', ()=>close(false));
      const okBtn = m.querySelector('.btn:not(.btn-ghost)');
      if(okBtn) okBtn.addEventListener('click', ()=>close(true));
      mask.addEventListener('click', e => { if(e.target===mask) close(false); });
    });
  }
  /* ===== icons ===== */
  const ICONS = {
    text:'<path d="M4 6h16M12 6v12M7 18h10"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-8 8"/>',
    shape:'<rect x="4" y="6" width="16" height="12" rx="2"/>',
    particles:'<circle cx="6" cy="10" r="1.2"/><circle cx="12" cy="6" r="1.2"/><circle cx="18" cy="11" r="1.2"/><circle cx="9" cy="17" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    code:'<path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
    fx:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
    bg:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/>',
    grid:'<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    glow:'<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8" opacity="0.4"/>',
    noise:'<path d="M4 5h3M9 5h3M15 5h5M4 9h2M8 9h4M14 9h6M5 13h5M12 13h7M4 17h6M12 17h3M17 17h3"/>',
    eye:'<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
    lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    trash:'<path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13h10l1-13"/>',
    play:'<path d="M7 4l13 8-13 8z"/>',
    pause:'<path d="M8 5v14M16 5v14"/>',
    heart:'<path d="M12 21C6 16 3 12.5 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.8 4.2 2.2C13 4.8 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 3.7-3 7.2-9 12.2z"/>',
    arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    back:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    undo:'<path d="M8 5L3 10l5 5"/><path d="M3 10h11a7 7 0 017 7v1"/>',
    redo:'<path d="M16 5l5 5-5 5"/><path d="M21 10H10a7 7 0 00-7 7v1"/>',
    save:'<path d="M5 3h11l5 5v13H5z"/><path d="M8 3v6h8M8 21v-7h8v7"/>',
    export:'<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v4h16v-4"/>',
    sparkle:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
    layers:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    gridon:'<path d="M4 4h16v16H4zM4 10h16M4 14h16M10 4v16M14 4v16"/>',
    cube:'<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>'
  };
  function icon(name, size){
    return '<svg viewBox="0 0 24 24" style="width:'+(size||15)+'px;height:'+(size||15)+'px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round">'+(ICONS[name]||ICONS.shape)+'</svg>';
  }
  return { $, $$, el, clamp, round, lerp, uid, debounce, fmtTime, fmtBytes, download, readFile,
    mulberry32, hashStr, hexToRgb, rgbToHex, rgbToHsl, hslToHex, mix, parseColor,
    bus, toast, modal, confirm, icon };
})();