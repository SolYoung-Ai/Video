/* ============ ML.subtitle — subtitle engine: split, style, highlight ============ */
ML.subtitle = (function(){
  const L = ML.lib;

  const MAX_CHARS = 22, MAX_LINES = 2;

  /* ============ subtitle style registry — 6 designed looks ============ */
  const STYLE_PRESETS = {
    editorial: {
      key:'editorial', label:'Editorial',
      font:'Playfair Display, "Noto Serif SC", serif', size:44, weight:600, color:'#F5F5F5',
      highlightColor:'#C8A45C', posY:0.74, bg:false, bgColor:'rgba(0,0,0,0.35)', radius:8,
      shadow:true, animation:'fade', align:'center', tracking:0.03, maxChars:18, lines:2
    },
    clean: {
      key:'clean', label:'Clean Knowledge',
      font:'Inter, "Noto Sans SC", sans-serif', size:46, weight:600, color:'#FFFFFF',
      highlightColor:'#FFFFFF', posY:0.78, bg:true, bgColor:'rgba(0,0,0,0.35)', radius:8,
      shadow:true, animation:'rise', align:'center', tracking:0, maxChars:22, lines:2
    },
    highlight: {
      key:'highlight', label:'Keyword Highlight',
      font:'Inter, "Noto Sans SC", sans-serif', size:48, weight:700, color:'#FFFFFF',
      highlightColor:'#FFD166', posY:0.78, bg:false, bgColor:'rgba(0,0,0,0.45)', radius:8,
      shadow:true, animation:'rise', align:'center', tracking:0, maxChars:20, lines:2
    },
    cinematic: {
      key:'cinematic', label:'Cinematic',
      font:'"Space Grotesk", "Noto Sans SC", sans-serif', size:42, weight:500, color:'#F5F5F5',
      highlightColor:'#F5F5F5', posY:0.82, bg:false, bgColor:'rgba(0,0,0,0.4)', radius:6,
      shadow:true, animation:'fade', align:'center', tracking:0.04, maxChars:20, lines:2
    },
    documentary: {
      key:'documentary', label:'Documentary',
      font:'"Noto Serif SC", serif', size:44, weight:400, color:'#EDEDED',
      highlightColor:'#EDEDED', posY:0.8, bg:false, bgColor:'rgba(0,0,0,0.35)', radius:4,
      shadow:true, animation:'none', align:'center', tracking:0.01, maxChars:24, lines:2
    },
    tech: {
      key:'tech', label:'Tech / Mono',
      font:'"JetBrains Mono", monospace', size:42, weight:500, color:'#A8FF60',
      highlightColor:'#E0FFB0', posY:0.78, bg:true, bgColor:'rgba(0,0,0,0.5)', radius:4,
      shadow:false, animation:'rise', align:'center', tracking:0, maxChars:22, lines:2
    }
  };
  function stylePreset(key){
    return STYLE_PRESETS[key] ? Object.assign({}, STYLE_PRESETS[key]) : null;
  }
  function resolveStyle(styleObj){
    /* merge preset + per-subtitle overrides onto the default base */
    const base = defaultStyle();
    const key = styleObj && styleObj.styleKey;
    const preset = key ? stylePreset(key) : null;
    const merged = Object.assign({}, base, preset||{}, styleObj||{});
    merged.styleKey = key || (preset ? preset.key : '');
    return merged;
  }

  function wrapLines(text, maxChars){
    maxChars = maxChars || MAX_CHARS;
    /* split into ≤2 lines, prefer natural breaks (，。、/ spaces) */
    const clean = String(text||'').replace(/\s+/g,' ').trim();
    if(!clean) return [' '];
    if(clean.length <= maxChars) return [clean];
    let lines = [];
    let buf = '';
    const chars = Array.from(clean);
    for(let i=0;i<chars.length;i++){
      buf += chars[i];
      const natural = /[，。！？、;:,.!?;: ]/.test(chars[i]);
      if((natural && buf.length>=Math.min(8, Math.round(maxChars*0.45))) || buf.length >= maxChars){
        if(lines.length < MAX_LINES-1){ lines.push(buf.trim()); buf=''; }
      }
    }
    if(buf.trim()) lines.push(buf.trim());
    if(lines.length > MAX_LINES){ lines = [lines.slice(0,MAX_LINES-1).join(''), lines[lines.length-1]].filter(Boolean); }
    if(!lines.length) lines=[' '];
    return lines;
  }

  /* build subtitle for a scene from voice timing (sentence-level, never fake word timestamps) */
  function fromScene(scene, voiceSeg, style, idx){
    const start = scene._tlStart || 0;
    const dur = voiceSeg ? voiceSeg.duration : (scene.duration || 2.5);
    const st = resolveStyle(style);
    return {
      id: 'sub'+L.uid(), sceneId: scene.id, text: scene.text,
      lines: wrapLines(scene.text, st.maxChars), start, end: start + dur,
      style: st
    };
  }

  function defaultStyle(){
    return {
      font: 'Inter, "PingFang SC", sans-serif',
      size: 46, weight: 600, color: '#FFFFFF',
      highlight: true, highlightColor: '#FFFFFF',
      posY: 0.78, /* 0..1 of height; 0.78 sits inside 9:16 safe area */
      bg: true, bgColor: 'rgba(0,0,0,0.35)', radius: 8,
      shadow: true, animation: 'rise', align: 'center', tracking: 0,
      maxChars: 22, lines: 2, styleKey: ''
    };
  }

  /* rebuild subtitle text/lines for a scene (edited text keeps timing) */
  function updateText(sub, text){
    sub.text = text;
    sub.lines = wrapLines(text, (sub.style&&sub.style.maxChars)||MAX_CHARS);
    return sub;
  }

  /* highlight keywords inside a line → returns [{t, hl}] segments */
  function segments(line, keywords, enabled){
    if(!enabled || !keywords || !keywords.length) return [{ t: line, hl: false }];
    const out = [];
    let rest = line;
    for(const kw of keywords){
      const i = rest.indexOf(kw);
      if(i>=0){
        if(i>0) out.push({ t: rest.slice(0,i), hl: false });
        out.push({ t: rest.slice(i, i+kw.length), hl: true });
        rest = rest.slice(i+kw.length);
      }
    }
    if(rest) out.push({ t: rest, hl: false });
    return out;
  }

  function srt(subtitles){
    const pad = n => String(Math.max(0,n)).padStart(2,'0');
    const ts = s => { const h=Math.floor(s/3600), m=Math.floor(s%3600/60), ss=Math.floor(s%60), ms=Math.floor((s%1)*1000); return pad(h)+':'+pad(m)+':'+pad(ss)+','+String(ms).padStart(3,'0'); };
    return subtitles.map((sub,i)=> i+1+'\n'+ts(sub.start)+' --> '+ts(sub.end)+'\n'+sub.text+'\n').join('\n');
  }

  return { wrapLines, fromScene, updateText, segments, srt, MAX_CHARS, MAX_LINES, defaultStyle,
    STYLE_PRESETS, stylePreset, resolveStyle };
})();
