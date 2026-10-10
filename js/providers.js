/* ============ ML.providers — AI Analysis + TTS Provider registry ============ */
/* No real API is called. DEV MOCK is the active mode until a provider is configured.
   Config lives in settings (LocalStorage/IndexedDB) — keys are never hard-coded. */
ML.providers = (function(){
  const L = ML.lib;

  /* ---- provider config ---- */
  const DEFAULTS = {
    ai:   { provider: 'none', endpoint: '', key: '', model: 'gpt-4o-mini' },
    tts:  { provider: 'none', endpoint: '', key: '', model: '', voice: 'Chinese Female 01' }
  };
  let cfg = null;
  async function loadConfig(){
    cfg = await ML.store.getSetting('providers', null);
    if(!cfg) cfg = JSON.parse(JSON.stringify(DEFAULTS));
    return cfg;
  }
  async function saveConfig(next){
    cfg = next; await ML.store.setSetting('providers', next);
  }
  function config(){ return cfg || DEFAULTS; }
  function hasAI(){ const c = config(); return c && c.ai && c.ai.provider !== 'none' && !!c.ai.endpoint; }
  function hasTTS(){ const c = config(); return c && c.tts && c.tts.provider !== 'none' && !!c.tts.endpoint; }
  function mode(){ return { ai: hasAI() ? 'provider' : 'DEV_MOCK', tts: hasTTS() ? 'provider' : 'DEV_MOCK' }; }

  /* ---- AI provider interface ---- */
  /* analyzeMedia(assetMeta) -> {tags, labels, subjects, scene, mock}
     analyzeText(text)     -> {keywords, intent, visualNeeds, tone, mock} */
  const AI = {
    async analyzeMedia(meta){
      if(!hasAI()) return mockMediaAnalysis(meta);
      return callRemote(cfg.ai, '/analyze-media', meta, mockMediaAnalysis(meta));
    },
    async analyzeText(text){
      if(!hasAI()) return { mock: true };
      return callRemote(cfg.ai, '/analyze-text', { text }, null);
    },
    mode: ()=>hasAI() ? 'provider' : 'DEV_MOCK'
  };

  async function callRemote(c, path, body, fallback){
    try{
      const r = await fetch((c.endpoint.replace(/\/$/,'')) + path, {
        method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+c.key },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
      if(!r.ok) throw new Error('provider_http_'+r.status);
      const data = await r.json();
      return data || fallback;
    }catch(e){
      ML.diag && ML.diag.error('PROVIDER','analyze',null,e);
      throw new Error('AI provider request failed: '+String(e&&e.message||e));
    }
  }

  /* ---- TTS provider interface ----
     synthesize(text, voice) -> { audio: Blob|null, duration, provider, voiceId, status }
     Mock returns duration estimate only; browser SpeechSynthesis is used for live preview. */
  let _previewActive = false;

  const TTS = {
    async synthesize(text, voiceId){
      const v = voiceId || (config().tts && config().tts.voice) || 'Chinese Female 01';
      if(!hasTTS()){
        const dur = estimateDuration(text);
        return { audio: null, duration: dur, provider: 'DEV_MOCK', voiceId: v, status: 'mock' };
      }
      const c = config().tts;
      const r = await fetch((c.endpoint.replace(/\/$/,'')) + '/synthesize', {
        method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+c.key },
        body: JSON.stringify({ text, voice: v, model: c.model||undefined }), signal: AbortSignal.timeout(60000)
      });
      if(!r.ok) throw new Error('tts_http_'+r.status);
      const blob = await r.blob();
      const dur = parseFloat(r.headers.get('x-audio-duration') || '') || estimateDuration(text);
      return { audio: blob, duration: dur, provider: c.provider, voiceId: v, status: 'real' };
    },
    async preview(text, voiceId){
      /* live listen — browser speech synthesis, never faked audio */
      if(!window.speechSynthesis) return false;
      return new Promise(res=>{
        let settled = false;
        const done = ok=>{ if(!settled){ settled = true; _previewActive = false; res(ok); } };
        const u = new SpeechSynthesisUtterance(text);
        u.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
        u.rate = 1; u.pitch = 1;
        u.onend = ()=>done(true);
        u.onerror = ()=>done(false);
        window.speechSynthesis.cancel();
        _previewActive = true;
        window.speechSynthesis.speak(u);
        /* guard: a cancel() or paused engine must never hang the caller */
        setTimeout(()=>done(false), 45000);
      });
    },
    stopPreview(){ if(window.speechSynthesis) window.speechSynthesis.cancel(); _previewActive = false; },
    isPreviewing(){ return _previewActive; },
    voices(){
      return ['Chinese Female 01','Chinese Female 02','Chinese Male 01','Chinese Male 02','English Female','English Male'];
    },
    mode: ()=>hasTTS() ? 'provider' : 'DEV_MOCK'
  };

  /* ---- DEV MOCK analyzers (deterministic, clearly labelled) ---- */
  function estimateDuration(text){
    /* ~3.2 chars/sec zh, ~2.6 words/sec en, clamped */
    const zh = (text.match(/[\u4e00-\u9fff]/g)||[]).length;
    const rest = text.replace(/[\u4e00-\u9fff]/g,' ').trim();
    const enWords = rest?rest.split(/\s+/).length:0;
    const secs = zh/3.2 + enWords/2.6;
    return L.clamp(secs, 1.2, 20);
  }

  /* semantic dictionary used by the local analyzer — keyword → visual tags */
  const VISUAL_MAP = [
    { re:/睡眠|睡觉|睡|失眠|疲惫|累|tired|sleep|insomnia/i, tags:['卧室','夜晚','床','安静','人物','疲惫'] },
    { re:/工作|上班|加班|职场|压力|办公|大脑|高强度|work|office|stress/i, tags:['办公室','电脑','工作','城市','人物'] },
    { re:/跑步|健身|运动|锻炼|run|fitness|exercise|workout/i, tags:['运动','户外','人物','活力'] },
    { re:/咖啡|早餐|饮食|吃|食物|coffee|breakfast|food|eat/i, tags:['咖啡','餐桌','食物','早晨'] },
    { re:/城市|地铁|通勤|交通|city|metro|commute/i, tags:['城市','街道','地铁','通勤'] },
    { re:/手机|手机屏幕|app|应用|digital|phone|screen/i, tags:['手机','屏幕','数码','界面'] },
    { re:/效率|方法|技巧|tips|productivity|how/i, tags:['办公','电脑','笔记','人物'] },
    { re:/健康|身体|疾病|医生|hospital|health|doctor/i, tags:['医院','健康','人物','医疗'] },
    { re:/钱|收入|理财|存钱|省钱|money|finance|save/i, tags:['财务','数字','图表','城市'] },
    { re:/创业|副业|老板|生意|startup|business/i, tags:['办公室','电脑','会议','人物'] },
    { re:/旅行|旅游|风景|海边|旅行|travel|beach/i, tags:['风景','旅行','户外','天空'] }
  ];
  const STOP = new Set(['的','了','是','在','和','也','都','而','及','与','着','或','一个','没有','我们','你们','他们','这个','那个','因为','所以','但是','但是','可能','并不','还是','什么','为什么','怎么','如何','可以','需要','自己','大家','很多','第','个','原因','时间','真的','比','更','要','只','就','对','被','把','让','给','会','能','有','不','很','最','种','些']);

  function extractKeywords(text){
    const zhTokens = text.match(/[\u4e00-\u9fff]{2,4}/g) || [];
    const enTokens = text.toLowerCase().match(/[a-z]{3,}/g) || [];
    const freq = {};
    zhTokens.concat(enTokens).forEach(w=>{ if(!STOP.has(w)) freq[w] = (freq[w]||0)+1; });
    return Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).slice(0,6);
  }

  function mockMediaAnalysis(meta){
    /* deterministic Chinese tags derived from file name + basic metadata —
       aligned with scene.visualNeeds (also Chinese) so matching works */
    const Lx = ML.lib;
    const name = String(meta.name||'').toLowerCase();
    const dict = [
      { keys:['bed','bedroom','room','卧室','床','睡眠'], tags:['卧室','床','夜晚','安静','室内','疲惫'] },
      { keys:['office','desk','computer','办公','电脑','工位','工作','会议'], tags:['办公室','电脑','工作','办公','室内','会议'] },
      { keys:['city','street','地铁','城市','街道','通勤'], tags:['城市','街道','地铁','通勤','人群'] },
      { keys:['nature','forest','sea','beach','sky','自然','风景','天空','旅行'], tags:['自然','风景','天空','户外','旅行'] },
      { keys:['person','face','portrait','口播','talk','人物','人像'], tags:['人物','特写','人物访谈','室内'] },
      { keys:['product','goods','产品','商品'], tags:['产品','商品','特写','展示'] },
      { keys:['food','coffee','eat','食物','咖啡','早餐','餐桌'], tags:['食物','咖啡','餐桌','早晨','饮食'] },
      { keys:['phone','screen','手机','屏幕'], tags:['手机','屏幕','数码','界面'] },
      { keys:['run','sport','gym','运动','跑步','健身','锻炼'], tags:['运动','户外','活力','人物'] },
      { keys:['money','finance','财务','钱','理财'], tags:['财务','数字','图表','城市'] },
      { keys:['health','hospital','医生','健康','医疗'], tags:['医院','健康','医疗','人物'] }
    ];
    const tags = [];
    dict.forEach(d=>{ if(d.keys.some(k=>name.includes(k))) tags.push(...d.tags); });
    const seed = Lx.hashStr(name + (meta.width||0));
    const rnd = Lx.mulberry32(seed);
    const scenePool = ['室内','户外','城市','自然','工作场景','生活场景','特写','全景'];
    return {
      mock: true,
      provider: 'DEV_MOCK',
      tags: Array.from(new Set(tags)).slice(0,6),
      labels: Array.from(new Set(tags)).slice(0,6),
      scene: scenePool[Math.floor(rnd()*scenePool.length)],
      subjects: Array.from(new Set(tags)).slice(0,2),
      emotion: rnd()>0.5?'neutral':'focus',
      importance: 0.5 + rnd()*0.5
    };
  }

  return { loadConfig, saveConfig, config, hasAI, hasTTS, mode, AI, TTS,
    estimateDuration, extractKeywords, mockMediaAnalysis, VISUAL_MAP };
})();
