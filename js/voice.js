/* ============ ML.voice — voiceover generation, caching, preview ============ */
ML.voice = (function(){
  const L = ML.lib;
  const S = ML.store;

  /* cache key: text + voice + speed + pitch → duration/audio */
  async function cacheKey(project, text, voiceId, speed, pitch){
    return 'v:'+L.hashStr(text)+':'+voiceId+':'+speed+':'+pitch;
  }

  async function generateSegment(project, scene, opts){
    opts = opts || {};
    const voiceId = opts.voiceId || (ML.providers.config().tts && ML.providers.config().tts.voice) || 'Chinese Female 01';
    const speed = opts.speed || 1, pitch = opts.pitch || 1;
    const key = await cacheKey(project, scene.text, voiceId, speed, pitch);
    const cached = await S.getSetting('vseg:'+key, null);
    if(cached){
      return Object.assign({}, cached, { id: 'v'+L.uid(), sceneId: scene.id, text: scene.text, audioKey: key, cached: true });
    }
    let res;
    try{
      res = await ML.providers.TTS.synthesize(scene.text, voiceId);
    }catch(e){
      throw new Error(ML.i18n.t('voice.notConfig')+' '+String(e&&e.message||e));
    }
    const seg = {
      id: 'v'+L.uid(), sceneId: scene.id, text: scene.text,
      audioKey: key, provider: res.provider, voiceId, speed, pitch,
      duration: res.duration, status: res.status, audioBlob: res.audio||null, cached: false
    };
    /* store small metadata (audio blob lives in kv too when real — keep project JSON light) */
    await S.setSetting('vseg:'+key, { duration: seg.duration, provider: seg.provider, voiceId, speed, pitch, status: seg.status });
    if(res.audio){
      /* persist real audio so preview & restore survive refresh/history */
      try{ await S.setSetting('vaudio:'+key, { blob: res.audio }); }catch(e){}
    }
    return seg;
  }

  async function loadAudio(seg){
    if(seg.audioBlob) return seg.audioBlob;
    const cached = await S.getSetting('vaudio:'+seg.audioKey, null);
    if(cached && cached.blob) return cached.blob;
    return null;
  }

  /* browser speech preview — real, not faked */
  async function preview(text, voiceId){
    return ML.providers.TTS.preview(text, voiceId);
  }
  function stopPreview(){ ML.providers.TTS.stopPreview(); }
  function isPreviewing(){ return !!(ML.providers.TTS.isPreviewing && ML.providers.TTS.isPreviewing()); }

  /* audio waveform-free duration estimate for a scene (re-calculable) */
  function sceneDuration(seg){ return seg ? seg.duration : 2.5; }

  return { generateSegment, loadAudio, preview, stopPreview, isPreviewing, cacheKey, sceneDuration };
})();
