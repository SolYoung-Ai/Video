/* ============ ML.matcher — scene → asset scoring & selection ============ */
ML.matcher = (function(){
  const L = ML.lib;

  /* weights — calibrated toward the spec: semantic 35 / subject-action 15 /
     visual coverage 15 / duration 10 / quality 10 / ratio 5 (continuity is
     applied as a neighbour-reuse penalty, not a weight) */
  const W = { semantic: 0.35, keyword: 0.15, visual: 0.15, duration: 0.10, quality: 0.10, ratio: 0.05 };
  const REUSE_PENALTY = 0.15, NEIGHBOUR_PENALTY = 0.12;

  function score(scene, asset, ratio, usedCount, prevAssetId){
    let semantic = 0, keyword = 0, visual = 0, duration = 0, ratioFit = 0, quality = 0;
    const tags = ((asset.tags||[]).length ? asset.tags : ((asset.analysis && asset.analysis.tags) || [])).map(t=>String(t).toLowerCase());
    const sceneWords = (scene.text||'').toLowerCase();
    const need = (scene.visualNeeds||[]).map(t=>String(t).toLowerCase());

    /* semantic: any asset tag appears in scene text or visual needs */
    const hitSem = tags.filter(t=> sceneWords.includes(t) || need.includes(t));
    semantic = hitSem.length ? L.clamp(0.4 + 0.6*(hitSem.length/Math.max(1, need.length||tags.length)), 0, 1) : 0;

    /* keyword: asset filename/tags overlap scene keywords */
    const kwHit = (scene.keywords||[]).filter(k=> tags.some(t=> t.includes(k) || k.includes(t)));
    keyword = kwHit.length ? L.clamp(kwHit.length/3, 0, 1) : (tags.some(t=>sceneWords.includes(t))?0.35:0);

    /* visual need coverage */
    visual = need.length ? L.clamp(need.filter(n=> tags.includes(n) || hitSem.includes(n)).length/need.length, 0, 1) : 0.3;

    /* duration fit: asset length vs needed scene duration (voice-first) */
    const needDur = scene.duration || 3;
    if(asset.type==='video' && asset.duration>0){
      duration = L.clamp(Math.min(1, asset.duration/needDur) * (asset.duration>=needDur*0.6?1:0.8), 0, 1);
    } else if(asset.type==='image'){
      duration = 0.7; /* images can hold any length (Ken Burns) */
    } else duration = 0.2;

    /* ratio fit */
    if(asset.width && asset.height){
      const ar = asset.width/asset.height;
      const target = ratio==='9:16'?0.5625 : ratio==='1:1'?1 : ratio==='4:5'?0.8 : ratio==='16:9'?1.7778 : 1;
      ratioFit = L.clamp(1 - Math.abs(Math.log(ar/target)), 0, 1);
    } else ratioFit = 0.5;

    /* quality: resolution */
    quality = asset.width ? L.clamp(Math.min(1, asset.width/1080), 0.35, 1) : 0.5;

    /* continuity + reuse penalties */
    const reuse = Math.max(0, (usedCount||0)-1) * REUSE_PENALTY;
    const neighbour = prevAssetId && prevAssetId===asset.id ? NEIGHBOUR_PENALTY : 0;

    const total = semantic*W.semantic + keyword*W.keyword + visual*W.visual + duration*W.duration + ratioFit*W.ratio + quality*W.quality;
    const scoreVal = L.clamp(total - reuse - neighbour, 0, 1);
    const reasons = [];
    if(hitSem.length) reasons.push(...hitSem.slice(0,3));
    if(kwHit.length) reasons.push(...kwHit.slice(0,2));
    if(!reasons.length && scoreVal>0.15) reasons.push('best available');
    return { score: Math.round(scoreVal*100), semantic, reasons: Array.from(new Set(reasons)).slice(0,4) };
  }

  function matchAll(scenes, assets, ratio, opts){
    opts = opts || {};
    const used = {};
    let prevId = null;
    return scenes.map(scene => {
      const scored = assets
        .filter(a=>a.type==='video'||a.type==='image')
        .map(a=>{
          const s = score(scene, a, ratio, used[a.id]||0, prevId);
          return { asset: a, ...s };
        })
        .sort((a,b)=>b.score-a.score);
      const best = scored[0];
      let chosen = null, confidence = 0, reasons = [], weak = false;
      if(best && best.score >= (opts.threshold!=null?opts.threshold:20)){
        chosen = best.asset; confidence = best.score; reasons = best.reasons;
        used[best.asset.id] = (used[best.asset.id]||0)+1;
        weak = best.score < 40;
      }
      prevId = chosen ? chosen.id : prevId;
      return { scene, asset: chosen, confidence, reasons, weak, alternatives: scored.slice(0,3) };
    });
  }

  function recommendForScene(scene, assets, ratio, excludeId){
    return assets
      .filter(a=>(a.type==='video'||a.type==='image') && a.id!==excludeId)
      .map(a=>{ const s = score(scene, a, ratio, 0); return { asset: a, score: s.score, reasons: s.reasons }; })
      .sort((a,b)=>b.score-a.score)
      .slice(0,3);
  }

  return { score, matchAll, recommendForScene, W, REUSE_PENALTY, NEIGHBOUR_PENALTY };
})();
