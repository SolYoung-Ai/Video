/* ============ ML.subtitle — subtitle engine: split, style, highlight ============ */
ML.subtitle = (function(){
  const L = ML.lib;

  const MAX_CHARS = 22, MAX_LINES = 2;

  function wrapLines(text){
    /* split into ≤2 lines, prefer natural breaks (，。、/ spaces) */
    const clean = String(text||'').replace(/\s+/g,' ').trim();
    if(!clean) return [' '];
    if(clean.length <= MAX_CHARS) return [clean];
    let lines = [];
    let buf = '';
    const chars = Array.from(clean);
    for(let i=0;i<chars.length;i++){
      buf += chars[i];
      const natural = /[，。！？、;:,.!?;: ]/.test(chars[i]);
      if((natural && buf.length>=8) || buf.length >= MAX_CHARS){
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
    return {
      id: 'sub'+L.uid(), sceneId: scene.id, text: scene.text,
      lines: wrapLines(scene.text), start, end: start + dur,
      style: Object.assign({}, defaultStyle(), style || {})
    };
  }

  function defaultStyle(){
    return {
      font: 'Inter, PingFang SC, sans-serif',
      size: 46, weight: 600, color: '#FFFFFF',
      highlight: true, highlightColor: '#FFFFFF',
      posY: 0.78, /* 0..1 of height; 0.78 sits inside 9:16 safe area */
      bg: true, bgColor: 'rgba(0,0,0,0.35)', radius: 8,
      shadow: true, animation: 'rise', align: 'center'
    };
  }

  /* rebuild subtitle text/lines for a scene (edited text keeps timing) */
  function updateText(sub, text){
    sub.text = text;
    sub.lines = wrapLines(text);
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

  return { wrapLines, fromScene, updateText, segments, srt, MAX_CHARS, MAX_LINES, defaultStyle };
})();