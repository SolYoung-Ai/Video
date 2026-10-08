/* ============ ML.autoedit — Auto Edit engine (voice-first) ============ */
ML.autoedit = (function(){
  const L = ML.lib;
  const Tn = ML.i18n.t;

  let currentJob = null;

  function newJob(projectId){
    currentJob = { id: 'job'+L.uid(), projectId, status:'queued', stage:'', progress:0, error:null };
    return currentJob;
  }
  function job(){ return currentJob; }

  async function run(project, opts){
    opts = opts || {};
    if(!currentJob) currentJob = newJob(project && project.id);
    const job = currentJob;
    job.status = 'processing'; job.stage = Tn('ae.stage.script'); job.progress = 4;
    const tick = (stage, p) => { if(job.status==='cancelled') throw new Error('cancelled'); job.stage = stage; job.progress = p; };
    try{
      /* 1 — script split */
      let scenes = ML.script.analyze(project.scriptText);
      if(!scenes.length) throw new Error('empty_script');
      project.scenes = scenes;
      tick(Tn('ae.stage.voice'), 18);

      /* 2 — voice segments (voice first: duration drives timing) */
      const vseg = [];
      for(let i=0;i<scenes.length;i++){
        const s = scenes[i];
        const seg = await ML.voice.generateSegment(project, s, opts.voice);
        vseg.push(seg);
        s.voiceSegmentId = seg.id; s.duration = seg.duration;
        if(i%2===0) tick(Tn('ae.stage.voice'), 18 + 24*(i+1)/scenes.length);
        if(job.status==='cancelled') throw new Error('cancelled');
      }
      project.voiceSegments = vseg;
      tick(Tn('ae.stage.match'), 45);

      /* 3 — match visuals */
      const assets = project.assets.filter(a=>a && a.id);
      const matches = ML.matcher.matchAll(scenes, assets, project.ratio, { threshold: 10 });
      const matchMap = {};
      matches.forEach(m=>{
        const sc = scenes.find(x=>x.id===m.scene.id);
        if(sc){ sc.assetId = m.asset ? m.asset.id : null; sc.confidence = m.asset?m.confidence:0; sc.matchReasons = m.reasons||[]; sc.weak = m.weak; }
        if(m.asset) matchMap[m.scene.id] = m;
      });
      tick(Tn('ae.stage.timeline'), 58);

      /* 4 — build timeline (voice-first timing) */
      project.timeline = { clips: [], duration: 0 };
      let cursor = 0;
      scenes.forEach(sc=>{
        const dur = sc.duration;
        const v = vseg.find(x=>x.sceneId===sc.id);
        const seg = v || { id:'v'+L.uid(), sceneId:sc.id, text:sc.text, duration:dur, provider:'DEV_MOCK', voiceId:'Chinese Female 01' };
        if(!v) project.voiceSegments.push(seg);
        sc._tlStart = cursor;
        /* video clip */
        const asset = sc.assetId ? project.assets.find(a=>a.id===sc.assetId) : null;
        if(asset){
          const srcDur = asset.type==='video' && asset.duration>0 ? Math.max(0.5, asset.duration) : dur;
          /* smart source pick: avoid hard start-at-0; for video take a middle segment sized to scene */
          let srcStart = 0;
          if(asset.type==='video' && asset.duration > dur + 0.5){
            srcStart = Math.min(Math.max(0, asset.duration - dur), (asset.duration-dur)*0.45);
          }
          const clip = ML.timeline.newClip('video', {
            sceneId: sc.id, assetId: asset.id,
            sourceStart: srcStart, sourceEnd: srcStart + Math.min(dur, srcDur),
            timelineStart: cursor, timelineEnd: cursor + dur,
            scale: asset.type==='image' ? 1.04 : 1, speed: 1
          });
          ML.timeline.addClip(project, clip);
          sc.clipId = clip.id;
        } else {
          /* no strong match — leave the gap empty rather than faking */
          sc.matchReasons = sc.matchReasons.length ? sc.matchReasons : [Tn('ae.noMatch')];
        }
        /* voice clip */
        const vc = ML.timeline.newClip('voice', {
          sceneId: sc.id, voiceId: seg.id, duration: dur,
          timelineStart: cursor, timelineEnd: cursor + dur, speed: 1, volume: 1
        });
        ML.timeline.addClip(project, vc);
        /* marker */
        const mk = ML.timeline.newClip('marker', {
          sceneId: sc.id, text: Tn('sc.scene')+' '+sc.order,
          timelineStart: cursor, timelineEnd: cursor + 0.05
        });
        ML.timeline.addClip(project, mk);
        cursor += dur;
      });
      project.timeline.duration = cursor;
      tick(Tn('ae.stage.subtitle'), 78);

      /* 5 — subtitles */
      const subs = [];
      project.timeline.clips.filter(c=>c.track==='video').sort((a,b)=>a.timelineStart-b.timelineStart).forEach(c=>{
        const sc = scenes.find(x=>x.id===c.sceneId);
        const vs = project.voiceSegments.find(x=>x.sceneId===c.sceneId);
        const sub = ML.subtitle.fromScene(sc, vs, project.settings && project.settings.subtitleStyle, subs.length);
        ML.timeline.addClip(project, ML.timeline.newClip('subtitle', {
          sceneId: sc.id, text: sc.text, lines: sub.lines, style: sub.style,
          timelineStart: c.timelineStart, timelineEnd: c.timelineEnd
        }));
        subs.push(sub);
      });
      project.subtitles = subs;
      tick(Tn('ae.stage.preview'), 92);

      /* 6 — preview render warm-up */
      await new Promise(r=>setTimeout(r, 30));
      job.status = 'completed'; job.stage = Tn('ae.stage.done'); job.progress = 100;
      return project;
    }catch(e){
      if(job.status==='cancelled'){ job.status='cancelled'; return project; }
      job.status = 'failed'; job.error = String(e&&e.message||e);
      throw e;
    }
  }

  function cancel(){
    if(currentJob && (currentJob.status==='queued'||currentJob.status==='processing')) currentJob.status = 'cancelled';
  }

  /* per-scene regenerate */
  async function regenVisual(project, sceneId){
    const sc = project.scenes.find(x=>x.id===sceneId);
    if(!sc) return;
    const matches = ML.matcher.matchAll([sc], project.assets, project.ratio, { threshold: 10 });
    const m = matches[0];
    sc.assetId = m.asset ? m.asset.id : null;
    sc.confidence = m.asset ? m.confidence : 0;
    sc.matchReasons = m.reasons||[];
    sc.weak = m.weak;
    /* rebuild that scene's video clip in place */
    project.timeline.clips.filter(c=>c.track==='video' && c.sceneId===sceneId).forEach(old=>{
      const idx = project.timeline.clips.indexOf(old);
      if(m.asset){
        const dur = old.timelineEnd - old.timelineStart;
        const asset = m.asset;
        const srcDur = asset.type==='video' && asset.duration>0 ? Math.max(0.5, asset.duration) : dur;
        const srcStart = asset.type==='video' && asset.duration > dur + 0.5 ? Math.min(Math.max(0, asset.duration-dur), (asset.duration-dur)*0.45) : 0;
        const clip = ML.timeline.newClip('video', {
          sceneId, assetId: asset.id, sourceStart: srcStart, sourceEnd: srcStart + Math.min(dur, srcDur),
          timelineStart: old.timelineStart, timelineEnd: old.timelineEnd,
          scale: asset.type==='image' ? 1.04 : 1, speed: 1
        });
        project.timeline.clips[idx] = clip;
      } else {
        project.timeline.clips.splice(idx, 1);
      }
    });
  }

  async function regenVoice(project, sceneId){
    const sc = project.scenes.find(x=>x.id===sceneId);
    if(!sc) return;
    const seg = await ML.voice.generateSegment(project, sc, {});
    sc.voiceSegmentId = seg.id; sc.duration = seg.duration;
    const old = project.voiceSegments.findIndex(x=>x.sceneId===sceneId);
    if(old>=0) project.voiceSegments[old] = seg; else project.voiceSegments.push(seg);
    /* shift following clips when duration changed */
    const d = sc.duration - (seg.duration);
    project.timeline.clips.filter(c=>{ const s = project.scenes.find(x=>x.id===c.sceneId); return s && s.order > sc.order; }).forEach(c=>{
      c.timelineStart += d; c.timelineEnd += d;
    });
    /* retime this scene's clips */
    project.timeline.clips.filter(c=>c.sceneId===sceneId).forEach(c=>{
      const dur = seg.duration;
      const start = sceneStartOf(project, sceneId);
      c.timelineStart = start; c.timelineEnd = start + (c.track==='marker'?0.05:dur);
      if(c.track==='video' && c.assetId){
        const asset = project.assets.find(a=>a.id===c.assetId);
        if(asset && asset.type==='video' && asset.duration>0){
          const srcDur = Math.max(0.5, asset.duration);
          const srcStart = asset.duration > dur + 0.5 ? Math.min(Math.max(0, asset.duration-dur), (asset.duration-dur)*0.45) : 0;
          c.sourceStart = srcStart; c.sourceEnd = srcStart + Math.min(dur, srcDur);
        }
      }
    });
    /* rebuild subtitle text/timing for the scene */
    const sub = project.timeline.clips.find(c=>c.track==='subtitle' && c.sceneId===sceneId);
    if(sub){ sub.text = sc.text; sub.lines = ML.subtitle.wrapLines(sc.text); const start = sceneStartOf(project, sceneId); sub.timelineStart = start; sub.timelineEnd = start + seg.duration; }
    project.timeline.duration = ML.timeline.durationOf(project);
  }
  function sceneStartOf(project, sceneId){
    const sc = project.scenes.find(x=>x.id===sceneId);
    if(!sc) return 0;
    let start = 0;
    for(const s of project.scenes){ if(s.id===sceneId) break; start += s.duration; }
    return start;
  }

  return { run, cancel, job, newJob, regenVisual, regenVoice, sceneStartOf };
})();
