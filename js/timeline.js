/* ============ ML.timeline — timeline model: tracks, clips, ops, validator ============ */
/* All time units are SECONDS. Tracks: video / voice / subtitle / marker. */
ML.timeline = (function(){
  const L = ML.lib;

  function newClip(track, opts){
    const c = {
      id: 'c'+L.uid(), track,
      sceneId: opts.sceneId||null, assetId: opts.assetId||null,
      sourceStart: opts.sourceStart||0, sourceEnd: opts.sourceEnd||1,
      timelineStart: opts.timelineStart||0, timelineEnd: opts.timelineEnd||1,
      transform: { scale: opts.scale||1, x: opts.x||0, y: opts.y||0 },
      speed: opts.speed||1, opacity: opts.opacity||1, volume: opts.volume||1,
      muted: !!opts.muted, locked: !!opts.locked,
      transition: opts.transition||0
    };
    if(opts.rotation) c.transform.rotation = opts.rotation;
    if(opts.crop) c.transform.crop = opts.crop;
    if(track==='voice'){ c.voiceId = opts.voiceId||null; c.duration = opts.duration||1; }
    if(track==='subtitle'){ c.text = opts.text||''; c.lines = opts.lines||[]; c.style = opts.style||{}; c.sceneId = opts.sceneId||null; }
    if(track==='marker'){ c.text = opts.text||''; }
    return c;
  }

  function durationOf(project){
    let end = 0;
    const clips = project && project.timeline && project.timeline.clips;
    if(clips) clips.forEach(c=>{ if(c && c.timelineEnd > end) end = c.timelineEnd; });
    return Math.max(end, (project && project.timeline && project.timeline.duration) || 0);
  }

  function clipsIn(project, track, t0, t1){
    return project.timeline.clips.filter(c=>c.track===track && c.timelineEnd>t0 && c.timelineStart<t1);
  }

  /* find clip under time on a track (topmost = last added) */
  function clipAt(project, track, t){
    return project.timeline.clips.filter(c=>c.track===track && t>=c.timelineStart && t<=c.timelineEnd).sort((a,b)=>b.id.localeCompare(a.id))[0] || null;
  }

  function activeVideoAt(project, t){
    return clipAt(project, 'video', t);
  }
  function activeSubtitleAt(project, t){
    return project.timeline.clips.filter(c=>c.track==='subtitle' && t>=c.timelineStart && t<c.timelineEnd).sort((a,b)=>a.timelineStart-b.timelineStart)[0] || null;
  }

  /* ---- ops (all mutate project.timeline.clips; workspace pushes history) ---- */
  function addClip(project, clip){ project.timeline.clips.push(clip); return clip; }
  function removeClip(project, id){ project.timeline.clips = project.timeline.clips.filter(c=>c.id!==id); }
  function moveClip(project, id, dt){ const c = find(project,id); if(c){ c.timelineStart += dt; c.timelineEnd += dt; } return c; }
  function trimClip(project, id, edge, newTime){
    const c = find(project,id); if(!c) return null;
    if(edge==='start'){ c.timelineStart = Math.min(newTime, c.timelineEnd-0.2); c.sourceStart = Math.min(c.sourceEnd-0.2, c.sourceStart + (newTime - (c.timelineStart - (c.sourceStart>0?0:0)))); }
    else { c.timelineEnd = Math.max(newTime, c.timelineStart+0.2); c.sourceEnd = c.sourceStart + (c.timelineEnd-c.timelineStart); }
    return c;
  }
  function splitClip(project, id, t){
    const c = find(project,id); if(!c || t<=c.timelineStart+0.1 || t>=c.timelineEnd-0.1) return null;
    const dur = t - c.timelineStart;
    const srcDur = c.sourceEnd - c.sourceStart;
    const a = Object.assign({}, c, { id: 'c'+L.uid(), timelineEnd: t, sourceEnd: c.sourceStart + srcDur*(dur/(c.timelineEnd-c.timelineStart)) });
    const b = Object.assign({}, c, { id: 'c'+L.uid(), timelineStart: t, sourceStart: c.sourceStart + srcDur*(dur/(c.timelineEnd-c.timelineStart)) });
    removeClip(project, c.id);
    project.timeline.clips.push(a, b);
    return [a,b];
  }
  function duplicateClip(project, id){
    const c = find(project,id); if(!c) return null;
    const d = Object.assign({}, c, { id:'c'+L.uid() });
    project.timeline.clips.push(d);
    return d;
  }
  function replaceAsset(project, id, assetId){
    const c = find(project,id); if(!c) return null;
    c.assetId = assetId; c.sourceStart = 0; c.sourceEnd = Math.max(0.5, c.timelineEnd - c.timelineStart);
    return c;
  }
  function find(project, id){ return project.timeline.clips.find(c=>c.id===id)||null; }

  /* ---- validator ---- */
  function validate(project){
    const problems = [];
    project.timeline.clips.forEach(c=>{
      if(!(c.timelineStart>=0) || !(c.timelineEnd>c.timelineStart)) problems.push('clip '+c.id+' invalid range');
      if(!(c.sourceEnd>c.sourceStart)) problems.push('clip '+c.id+' invalid source range');
      if(!isFinite(c.timelineStart) || !isFinite(c.timelineEnd)) problems.push('clip '+c.id+' NaN time');
      if(c.track==='voice' && !(c.duration>0)) problems.push('voice clip '+c.id+' bad duration');
    });
    /* overlap check on voice track */
    const vs = project.timeline.clips.filter(c=>c.track==='voice').sort((a,b)=>a.timelineStart-b.timelineStart);
    for(let i=1;i<vs.length;i++){
      if(vs[i].timelineStart < vs[i-1].timelineEnd - 0.001) problems.push('voice overlap '+vs[i-1].id);
    }
    return { ok: problems.length===0, problems };
  }

  return { newClip, durationOf, clipsIn, clipAt, activeVideoAt, activeSubtitleAt,
    addClip, removeClip, moveClip, trimClip, splitClip, duplicateClip, replaceAsset, find, validate };
})();
