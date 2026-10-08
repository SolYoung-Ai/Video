/* ============ ML.script — script parsing & scene analysis ============ */
/* Local rule-based parser (real logic). When an AI provider is configured,
   its structured output augments the local result. */
ML.script = (function(){
  const L = ML.lib;

  function splitSentences(text){
    if(!text) return [];
    const raw = String(text)
      .replace(/\r/g,'')
      .split(/\n+/)
      .map(s=>s.trim())
      .filter(Boolean);
    const out = [];
    raw.forEach(para=>{
      /* split on 。！？； and English .!?; but keep quotes/numbers intact */
      const parts = para.split(/(?<=[。！？；!?;])/);
      parts.forEach(p=>{
        const s = p.trim();
        if(!s) return;
        /* paragraphs without terminal punctuation stay as one scene */
        if(s.length <= 200 && !/[。！？;!?]$/.test(s)) out.push(s);
        else {
          const chunks = s.split(/(?<=[，,])/).filter(Boolean);
          let buf = '';
          chunks.forEach(c=>{
            if((buf+c).length > 140){ out.push(buf.trim()); buf = c; }
            else buf += c;
          });
          if(buf.trim()) out.push(buf.trim());
        }
      });
    });
    /* merge very short fragments (<6 chars) into previous */
    const merged = [];
    out.forEach(s=>{
      if(s.length < 6 && merged.length) merged[merged.length-1] += s;
      else merged.push(s);
    });
    return merged.filter(Boolean);
  }

  const INTENT_HOOK = /^为什么|^为何|^怎么|^如何|^你知道吗|^是不是|^你还在|^注意|^重磅|^揭秘|^别再|^stop|^why|^how|^ever wonder|^did you know/i;
  const INTENT_QUESTION = /？|\?|吗|呢|是不是|对不对/;
  const INTENT_LIST = /第[一二三四五六七八九十\d]个|第[1-9]|^\d+[、.)]|首先|其次|最后|一是|二是|原因一|原因二|原因三|①|②|③/;
  const INTENT_EXPLAIN = /因为|所以|原因|导致|意味着|其实|关键|本质上|换句话说|because|so|reason|actually|means/i;
  const INTENT_CTA = /关注|点赞|转发|收藏|评论|关注我|双击|关注我们|follow|like|subscribe|comment|share/i;
  const INTENT_CONCLUSION = /所以|总之|记住|核心|最后|最重要的是|总结|therefore|in short|remember|bottom line/i;
  const INTENT_TRANSITION = /接下来|下面|其次|然后|再看|还有|next|then|also|another/i;

  function detectIntent(text, idx, total){
    if(idx === 0 && INTENT_HOOK.test(text)) return 'Hook';
    if(INTENT_QUESTION.test(text) && idx === 0) return 'Hook';
    if(idx === total-1 && INTENT_CTA.test(text)) return 'CTA';
    if(idx === total-1 && (INTENT_CONCLUSION.test(text) || total>1)) return 'Conclusion';
    if(INTENT_LIST.test(text)) return 'List';
    if(INTENT_EXPLAIN.test(text)) return 'Explanation';
    if(INTENT_TRANSITION.test(text)) return 'Transition';
    if(INTENT_QUESTION.test(text)) return 'Question';
    return 'Explanation';
  }

  function detectTone(text){
    const pos = /好|棒|轻松|开心|幸福|温暖|喜欢|爱/g;
    const neg = /累|痛|烦|焦虑|压力|失败|问题|难|苦/g;
    const p = (text.match(pos)||[]).length, n = (text.match(neg)||[]).length;
    return p>n ? 'positive' : (n>p ? 'tension' : 'neutral');
  }

  function analyze(text){
    const sentences = splitSentences(text);
    return sentences.map((s, i) => {
      const keywords = ML.providers.extractKeywords(s);
      const intent = detectIntent(s, i, sentences.length);
      const tone = detectTone(s);
      const visualNeeds = visualNeedsFor(keywords, s);
      return {
        id: 'sc'+L.uid(), order: i+1, text: s, keywords, intent, tone, visualNeeds,
        duration: ML.providers.estimateDuration(s),
        assetId: null, voiceId: null, confidence: 0, matchReasons: []
      };
    });
  }

  function visualNeedsFor(keywords, text){
    const found = [];
    ML.providers.VISUAL_MAP.forEach(entry=>{
      if(entry.re.test(text)) found.push(...entry.tags);
    });
    /* fall back to keyword-derived generic tags */
    if(!found.length){
      keywords.slice(0,2).forEach(k=>found.push(k));
      found.push('人物');
    }
    return Array.from(new Set(found)).slice(0,6);
  }

  /* validate that scene timing is sane */
  function normalize(scenes){
    scenes.forEach((s, i)=>{
      s.order = i+1;
      s.duration = L.clamp(Number(s.duration)||ML.providers.estimateDuration(s.text), 1.2, 20);
    });
    return scenes;
  }

  return { splitSentences, analyze, normalize, detectIntent };
})();