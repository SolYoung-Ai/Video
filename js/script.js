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

  const INTENT_HOOK = /^为什么|^为何|^怎么|^如何|^你知道吗|^是不是|^你还在|^注意|^重磅|^揭秘|^别再|^stop|^why|^how|^ever wonder|^did you know|^你是否有|^有没有/i;
  const INTENT_QUESTION = /？|\?|吗|呢|是不是|对不对|是否/;
  const INTENT_CONTEXT = /很多人|许多人|现在|如今|一直以来|随着|在这个|如今|现代|今天|其实很多人|大多|通常|generally|nowadays|today|many people/i;
  const INTENT_EXPLAIN = /因为|所以|原因|导致|意味着|其实|关键|本质上|换句话说|原理|机制|because|so|reason|actually|means|the reason/i;
  const INTENT_PROOF = /比如|例如|举例|研究表明|数据显示|据统计|调查|实验|一个例子|比如说|for example|research|study|data|show|according/i;
  const INTENT_STEPS = /第一步|第二步|首先|其次|然后|接下来|最后|方法|步骤|做法|先|再|之后|step|first|then|next|method/i;
  const INTENT_LIST = /第[一二三四五六七八九十\d]个|第[1-9]|^\d+[、.)]|一是|二是|三是|原因一|原因二|原因三|①|②|③|1[、.]|2[、.]|3[、.]/;
  const INTENT_CTA = /关注|点赞|转发|收藏|评论|关注我|双击|关注我们|评论区|follow|like|subscribe|comment|share/i;
  const INTENT_CONCLUSION = /总之|记住|核心|最重要的是|总结|所以说|归根结底|因此|一句话|in short|remember|bottom line|all in all/i;
  const INTENT_TRANSITION = /接下来|下面|其次|然后|再看|还有|除了|另外|next|then|also|another|moreover/i;

  /* role → editing rhythm hint. pace>1 slows, <1 tightens; multi allows split shots */
  const ROLE_PACE = {
    'HOOK':        { pace: 0.85, multi: false, label: 'Hook' },
    'CONTEXT':     { pace: 1.0,  multi: false, label: 'Context' },
    'EXPLANATION': { pace: 1.15, multi: false, label: 'Explanation' },
    'PROOF':       { pace: 1.0,  multi: false, label: 'Proof' },
    'STEPS':       { pace: 0.9,  multi: true,  label: 'Steps' },
    'LIST':        { pace: 0.9,  multi: true,  label: 'List' },
    'TRANSITION':  { pace: 0.8,  multi: false, label: 'Transition' },
    'CONCLUSION':  { pace: 1.1,  multi: false, label: 'Conclusion' },
    'CTA':         { pace: 1.05, multi: false, label: 'CTA' },
    'QUESTION':    { pace: 0.95, multi: false, label: 'Question' },
    'EXPLANATION_FALLBACK': { pace: 1.05, multi: false, label: 'Explanation' }
  };

  function detectIntent(text, idx, total){
    if(idx === 0 && INTENT_HOOK.test(text)) return 'Hook';
    if(idx === 0 && INTENT_QUESTION.test(text)) return 'Hook';
    if(idx === total-1 && INTENT_CTA.test(text)) return 'CTA';
    if(idx === total-1 && INTENT_CONCLUSION.test(text)) return 'Conclusion';
    if(INTENT_PROOF.test(text)) return 'Proof';
    if(INTENT_STEPS.test(text)) return 'Steps';
    if(INTENT_LIST.test(text)) return 'List';
    if(INTENT_EXPLAIN.test(text)) return 'Explanation';
    if(INTENT_CONTEXT.test(text)) return 'Context';
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
      const role = ROLE_PACE[intent] ? intent : 'EXPLANATION';
      const rp = ROLE_PACE[role] || ROLE_PACE.EXPLANATION_FALLBACK;
      return {
        id: 'sc'+L.uid(), order: i+1, text: s, keywords, intent, tone, visualNeeds,
        role, pace: rp.pace, multi: rp.multi,
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
