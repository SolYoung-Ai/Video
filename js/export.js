/* ============ ML.export — real export engine (PNG / JPG / WebM / MP4 via WebCodecs + mp4-muxer) ============ */
ML.export = (function(){
  const L = ML.lib;
  const Tn = ML.i18n.t;
  const cap = ML.cap;
  const _jobs = {};

  function supportedFormats(){
    const f = { png:true, jpg:true };
    f.webm = !!(cap.mediaRecorder && (cap.webmVp9 || cap.webmVp8 || cap.webm));
    f.mp4 = !!(cap.webCodecs && cap.avc);
    f.gif = false; /* no gif encoder bundled — never fake it */
    return f;
  }

  function validateProject(project){
    const errs = [];
    if(!project) return ['no project'];
    if(!project.timeline || !Array.isArray(project.timeline.clips)) errs.push('timeline invalid');
    const tl = project.timeline || {};
    for(const c of (tl.clips||[])){
      if(c.timelineStart == null || c.timelineEnd == null || c.timelineEnd < c.timelineStart) errs.push('clip '+c.id+' invalid');
      if(!Number.isFinite(c.timelineStart) || !Number.isFinite(c.timelineEnd)) errs.push('clip '+c.id+' NaN');
    }
    const voice = project.voiceSegments || [];
    if(project.settings && project.settings.voice && voice.length){ /* voice optional in DEV MOCK */ }
    return errs;
  }

  /* PNG / JPG — render final frame at playhead (or t=0.15) and download */
  async function exportImage(project, fmt, opts){
    opts = opts || {};
    const [W, H] = ML.compose.ratioSize(project.ratio || '9:16', opts.size || 1080);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const t = opts.time != null ? opts.time : Math.min(0.15, (project.timeline.duration||3)/2);
    await ML.compose.renderFrame(project, t, ctx, W, H);
    let blob;
    if(fmt==='png'){
      blob = await new Promise((res, rej)=>cv.toBlob(b=>b?res(b):rej(new Error('png fail')), 'image/png'));
    } else {
      blob = await new Promise((res, rej)=>cv.toBlob(b=>b?res(b):rej(new Error('jpg fail')), 'image/jpeg', opts.quality||0.92));
    }
    if(!blob || blob.size===0) throw new Error('empty blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (opts.name||'video-lab-frame')+'.'+(fmt==='png'?'png':'jpg');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 3000);
    return { blob, url };
  }

  /* WebM via captureStream + MediaRecorder with capability-checked mime */
  async function exportWebM(project, opts){
    opts = opts || {};
    const [W, H] = ML.compose.ratioSize(project.ratio || '9:16', opts.size || 720);
    const fps = opts.fps || 30;
    const dur = opts.duration || (project.timeline && project.timeline.duration) || 3;
    const mime = pickWebMMime();
    if(!mime) throw new Error('webm unsupported');
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const stream = cv.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: (opts.bitrate||8e6) });
    const chunks = [];
    rec.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res, rej)=>{
      rec.onstop = ()=>{
        try{
          const blob = new Blob(chunks, { type: mime });
          res(blob);
        }catch(e){ rej(e); }
      };
      rec.onerror = e=>rej(e.error||new Error('recorder error'));
    });
    rec.start(100);
    /* render frames in real-time (MediaRecorder captures the live stream) */
    const start = performance.now();
    let t = 0;
    while(t < dur){
      await ML.compose.renderFrame(project, t, ctx, W, H);
      t += 1/fps;
      const wall = (performance.now()-start)/1000;
      if(wall < t) await sleep((t-wall)*1000);
      /* allow recorder to flush */
      if(Math.floor(t*fps)%10===0) await sleep(0);
    }
    /* hold final frame briefly so last frames flush */
    await ML.compose.renderFrame(project, dur-1/fps, ctx, W, H);
    await sleep(150);
    rec.stop();
    const blob = await stopped;
    if(!blob || blob.size===0) throw new Error('webm empty');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (opts.name||'video-lab')+'.webm';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 3000);
    return { blob, url, mime };
  }

  function pickWebMMime(){
    const cands = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for(const c of cands){ try{ if(MediaRecorder.isTypeSupported(c)) return c; }catch(e){} }
    return null;
  }

  /* MP4 via WebCodecs VideoEncoder (H.264) + Mp4Muxer */
  async function exportMP4(project, opts, onProgress){
    opts = opts || {};
    if(!cap.webCodecs || !cap.avc) throw new Error('mp4 unsupported');
    if(typeof Mp4Muxer === 'undefined') throw new Error('mp4-muxer missing');
    const [W, H] = ML.compose.ratioSize(project.ratio || '9:16', opts.size || 1080);
    const fps = opts.fps || 30;
    const dur = opts.duration || (project.timeline && project.timeline.duration) || 3;
    const total = Math.max(1, Math.round(dur*fps));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    let encoder, muxer;
    try{
      const config = { codec:'avc1.4d401f', width:W, height:H, bitrate:(opts.bitrate||12e6), framerate:fps, avc:{ format:'avc' } };
      const support = await VideoEncoder.isConfigSupported(config);
      if(!support || !support.supported) throw new Error('avc config unsupported');
      const out = new ArrayBufferTarget();
      muxer = new Mp4Muxer.Muxer({ target: out, video: { codec:'avc', width:W, height:H }, fastStart:'in-memory', firstTimestampBehavior:'offset' });
      encoder = new VideoEncoder({
        output: (chunk, meta)=> muxer.addVideoChunk(chunk, meta),
        error: e=>{ throw e; }
      });
      encoder.configure(config);
    }catch(e){
      throw new Error('mp4 init failed: '+(e&&e.message||e));
    }

    let frame = 0;
    const tsStep = Math.round(1e6/fps);
    for(let f=0; f<total; f++){
      const t = Math.min(f/fps, dur-0.001);
      await ML.compose.renderFrame(project, t, ctx, W, H);
      const vf = new VideoFrame(cv, { timestamp: f*tsStep, duration: tsStep });
      encoder.encode(vf, { keyFrame: f%Math.max(1, fps*2)===0 });
      vf.close();
      frame = f+1;
      if(onProgress && frame%Math.max(1, Math.floor(total/20))===0) onProgress({ frame, total });
      if(frame%10===0) await sleep(0); /* yield to keep UI alive */
    }
    await encoder.flush();
    muxer.finalize();
    encoder.close();

    const blob = new Blob([out.bytes], { type:'video/mp4' });
    if(!blob || blob.size===0) throw new Error('mp4 empty');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (opts.name||'video-lab')+'.mp4';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
    return { blob, url };
  }

  function exportSRT(project){
    const subs = (project.timeline.clips||[]).filter(c=>c.track==='subtitle').sort((a,b)=>a.timelineStart-b.timelineStart);
    let srt = '';
    subs.forEach((s, i)=>{
      const st = fmtSrt(s.timelineStart), en = fmtSrt(s.timelineEnd);
      srt += (i+1)+'\n'+st+' --> '+en+'\n'+(s.text||'')+'\n\n';
    });
    const blob = new Blob([srt], { type:'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'video-lab.srt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 3000);
    return srt;
  }

  function fmtSrt(t){
    const ms = Math.max(0, t||0);
    const h = Math.floor(ms/3600), m = Math.floor(ms%3600/60), s = Math.floor(ms%60), mm = Math.round((ms%1)*1000);
    return [pad(h),pad(m),pad(s)+','+String(mm).padStart(3,'0')].join(':').replace(/(\d+):(\d+):(\d+),(\d+)/, '$1:$2:$3,$4');
  }
  function pad(n){ return String(n).padStart(2,'0'); }

  async function run(project, config, onProgress){
    const errs = validateProject(project);
    if(errs.length) throw new Error('invalid project: '+errs.join(', '));
    const fmt = (config.format||'mp4').toLowerCase();
    const job = { id: L.uid(), status:'processing', stage:'render', progress:0, cancel:false };
    _jobs[job.id] = job;
    try{
      let res;
      if(fmt==='png'||fmt==='jpg') res = await exportImage(project, fmt, config);
      else if(fmt==='webm') res = await exportWebM(project, config);
      else if(fmt==='mp4'){
        res = await exportMP4(project, config, p=>{
          job.progress = Math.round(p.frame/p.total*88);
          if(onProgress) onProgress({ stage:'enc', frame:p.frame, total:p.total, pct:job.progress });
        });
      } else throw new Error('unsupported format: '+fmt);
      if(job.cancel){ URL.revokeObjectURL(res.url); throw new Error('cancelled'); }
      job.status='done'; job.progress=100;
      return res;
    }catch(e){
      job.status='failed'; job.error=String(e&&e.message||e);
      throw e;
    }finally{
      delete _jobs[job.id];
    }
  }
  function cancel(id){ const j=_jobs[id]; if(j) j.cancel=true; }
  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  return { run, supportedFormats, validateProject, exportSRT, exportImage, exportWebM, exportMP4 };
})();
