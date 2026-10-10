/* ============ ML.export — export manager (MP4 / SRT / Voice), real rendering ============ */
/* MP4: WebCodecs H.264 + Mp4Muxer (in-memory fastStart). Capability-gated — never faked.
   SRT: derived from the actual timeline subtitles. Voice: only real TTS audio. */
ML.export = (function(){
  const L = ML.lib;
  const Tn = ML.i18n.t;

  let cancelFlag = false;

  function cancel(){ cancelFlag = true; }

  /* ---- project validation before export ---- */
  function validateProject(project){
    const problems = [];
    const tv = ML.timeline.validate(project);
    if(!tv.ok){ problems.push(Tn('exp.disabled.invalid')); return { ok:false, problems }; }
    project.timeline.clips.filter(c=>c.track==='video').forEach(c=>{
      if(!c.assetId) return;
      const a = project.assets.find(x=>x.id===c.assetId);
      if(!a) problems.push(Tn('exp.disabled.missing')+' ('+c.assetId+')');
    });
    if(problems.length) return { ok:false, problems };
    return { ok:true, problems:[] };
  }

  function snapshot(project){
    /* deep copy so in-editor changes never leak into the running export */
    return JSON.parse(JSON.stringify(project));
  }

  async function preloadSnapshotAssets(snap){
    for(const a of snap.assets || []){
      try{ await ML.compose.loadAsset(a); }catch(e){}
    }
  }

  /* ---- MP4 ---- */
  async function exportMP4(project, opts, onProgress){
    cancelFlag = false;
    const cap = ML.cap.summary();
    if(!cap.mp4) throw new Error('mp4_unavailable');
    const v = validateProject(project);
    if(!v.ok) throw new Error(v.problems.join('; '));

    const snap = snapshot(project);
    await preloadSnapshotAssets(snap);
    const fps = opts.fps || 30;
    const [W, H] = ML.compose.ratioSize(snap.ratio, opts.base || 1080);
    const duration = ML.timeline.durationOf(snap) || 5;
    const totalFrames = Math.max(1, Math.ceil(duration*fps));

    if(typeof Mp4Muxer === 'undefined') throw new Error('mp4_muxer_missing');
    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    });
    const encoder = new VideoEncoder({
      output: chunk => muxer.addVideoChunk(chunk, { decoderConfig: encCfg }, chunk.timestamp),
      error: e => { throw e; }
    });
    let encCfg = null;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    /* audio mixing when real TTS audio exists */
    let audioCtx = null, audioBuf = null, hasRealAudio = false;
    if(cap.audio && snap.voiceSegments){
      const real = snap.voiceSegments.filter(s=>s.status==='real' && s.audioBlob);
      if(real.length){
        hasRealAudio = true;
        audioCtx = new (window.AudioContext||window.webkitAudioContext)();
        const off = new OfflineAudioContext(1, Math.ceil(duration*48000), 48000);
        for(const seg of real){
          try{
            const ab = await seg.audioBlob.arrayBuffer();
            const buf = await off.decodeAudioData(ab);
            const src = off.createBufferSource();
            src.buffer = buf;
            const g = off.createGain(); g.gain.value = seg.volume||1;
            src.connect(g); g.connect(off.destination);
            const sc = snap.scenes.find(x=>x.id===seg.sceneId);
            let start = 0;
            if(sc){ for(const s of snap.scenes){ if(s.id===seg.sceneId) break; start += s.duration; } }
            src.start(start);
          }catch(e){}
        }
        audioBuf = await off.startRendering();
      }
    }

    try{
      await encoder.configure({
        codec: 'avc1.4d401f', width: W, height: H,
        bitrate: (opts.bitrate||8) * 1e6,
        framerate: fps, avc: { format: 'avc' }
      });
      encCfg = { codec: 'avc1.4d401f', width: W, height: H, avc: { format: 'avc' } };
    }catch(e){ throw new Error('mp4_encoder_cfg'); }

    let audioEnc = null, audioEncCfg = null;
    if(hasRealAudio && window.AudioEncoder){
      try{
        audioEnc = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta, chunk.timestamp),
          error: ()=>{}
        });
        await audioEnc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1, bitrate: 128000 });
        audioEncCfg = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1 };
      }catch(e){ audioEnc = null; }
    }

    onProgress(Tn('exp.stage.render'), 1);
    const t0 = performance.now();
    for(let i=0;i<totalFrames;i++){
      if(cancelFlag){ cleanup(encoder, audioEnc, muxer, canvas, audioCtx); throw new Error('cancelled'); }
      const t = i/fps;
      await ML.compose.renderFrame(snap, t, ctx, W, H);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i*1e6/fps), duration: Math.round(1e6/fps) });
      encoder.encode(frame, { keyFrame: i % (fps*2) === 0 });
      frame.close();
      /* keep UI responsive — yield every frame batch */
      if(i%4===0){ onProgress(Tn('exp.stage.render'), 10 + 60*(i+1)/totalFrames); await new Promise(r=>setTimeout(r,0)); }
    }
    onProgress(Tn('exp.stage.enc'), 72);
    await encoder.flush();

    if(audioEnc){
      try{
        const ch = new AudioData({
          format:'f32-planar', sampleRate:48000, numberOfFrames: audioBuf.length,
          numberOfChannels:1, timestamp:0, data: audioBuf.getChannelData(0)
        });
        audioEnc.encode(ch); ch.close();
        await audioEnc.flush();
      }catch(e){}
    }

    onProgress(Tn('exp.stage.final'), 92);
    muxer.finalize();
    const bytes = muxer.target.buffer;
    if(!bytes || !bytes.byteLength) throw new Error('mp4_empty');
    const blob = new Blob([bytes], { type: 'video/mp4' });
    onProgress(Tn('exp.stage.dl'), 99);
    return { blob, name: safeName(project, 'mp4'), hasAudio: hasRealAudio, frames: totalFrames };
  }

  function cleanup(enc, aenc, muxer, canvas, audioCtx){
    try{ enc && enc.state!=='closed' && enc.close(); }catch(e){}
    try{ aenc && aenc.state!=='closed' && aenc.close(); }catch(e){}
    try{ audioCtx && audioCtx.close(); }catch(e){}
  }

  /* ---- SRT ---- */
  function exportSRT(project){
    const subs = project.timeline.clips
      .filter(c=>c.track==='subtitle')
      .sort((a,b)=>a.timelineStart-b.timelineStart)
      .map(c=>({ start:c.timelineStart, end:c.timelineEnd, text:c.text }));
    const srt = ML.subtitle.srt(subs);
    return { blob: new Blob([srt], { type:'text/plain;charset=utf-8' }), name: safeName(project,'srt') };
  }

  /* ---- Voice ---- */
  async function exportVoice(project){
    const real = (project.voiceSegments||[]).filter(s=>s.status==='real' && s.audioBlob);
    if(!real.length) return null;
    /* concat in scene order */
    const ordered = [];
    project.scenes.forEach(sc=>{ const s = real.find(x=>x.sceneId===sc.id); if(s) ordered.push(s); });
    const blobs = [];
    for(const s of ordered){ blobs.push(s.audioBlob); }
    return { blob: new Blob(blobs, { type: blobs[0].type || 'audio/mpeg' }), name: safeName(project,'voice') };
  }

  function safeName(project, ext){
    const base = (project.name||'untitled').replace(/[\\/:*?"<>|#]/g,'-').replace(/\s+/g,'-');
    return base + '.' + ext;
  }

  /* capability summary for the export panel */
  function capabilities(){
    const cap = ML.cap.summary();
    return {
      mp4: cap.mp4, srt: true,
      voice: { real: false, note: Tn('exp.voiceUnavail') }
    };
  }

  return { exportMP4, exportSRT, exportVoice, validateProject, cancel, snapshot, capabilities, safeName };
})();
