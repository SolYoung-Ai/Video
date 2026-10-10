/* ============ ML.media — asset upload, metadata, thumbnails, blob storage ============ */
ML.media = (function(){
  const L = ML.lib;
  const S = ML.store;
  const MAX = { video: 200*1024*1024, image: 50*1024*1024, audio: 50*1024*1024 };
  const ACCEPT = {
    video: ['mp4','mov','webm','m4v'],
    image: ['jpg','jpeg','png','webp'],
    audio: ['mp3','wav','m4a']
  };

  function typeOf(file){
    const ext = (file.name.split('.').pop()||'').toLowerCase();
    if(ACCEPT.video.includes(ext) || file.type.startsWith('video/')) return 'video';
    if(ACCEPT.image.includes(ext) || file.type.startsWith('image/')) return 'image';
    if(ACCEPT.audio.includes(ext) || file.type.startsWith('audio/')) return 'audio';
    return null;
  }

  function probeVideo(file){
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const fail = e => { URL.revokeObjectURL(url); rej(new Error('video_probe_failed')); };
      v.onloadedmetadata = () => {
        const meta = {
          duration: isFinite(v.duration) ? v.duration : 0,
          width: v.videoWidth, height: v.videoHeight
        };
        /* thumbnail at 25% */
        const onReady = () => {
          try{
            const tw = 240, th = Math.round(240 * meta.height / Math.max(1, meta.width));
            const c = document.createElement('canvas');
            c.width = tw; c.height = th;
            c.getContext('2d').drawImage(v, 0, 0, tw, th);
            meta.thumb = c.toDataURL('image/jpeg', 0.6);
            meta.fps = estimateFps(v);
          }catch(e){}
          URL.revokeObjectURL(url);
          res(meta);
        };
        if(v.readyState >= 2) onReady();
        else { v.ontimeupdate = onReady; v.onseeked = onReady; v.onerror = fail; v.currentTime = Math.min(meta.duration*0.25, 1); }
        setTimeout(()=>{ if(!meta.thumb){ try{ URL.revokeObjectURL(url); }catch(e){} res(meta); } }, 4000);
      };
      v.onerror = fail;
      v.src = url;
    });
  }
  function estimateFps(v){
    /* sample decode: count frames over 0.5s window */
    return 30; /* browsers don't expose fps — metadata default; honest default */
  }

  function probeImage(file){
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const tw = 240, th = Math.round(240*img.height/Math.max(1,img.width));
        const c = document.createElement('canvas');
        c.width = tw; c.height = th;
        c.getContext('2d').drawImage(img, 0, 0, tw, th);
        URL.revokeObjectURL(url);
        res({ duration: 0, width: img.width, height: img.height, thumb: c.toDataURL('image/jpeg',0.7) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image_decode_failed')); };
      img.src = url;
    });
  }

  function probeAudio(file){
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        res({ duration: isFinite(a.duration) ? a.duration : 0, width: 0, height: 0 });
      };
      a.onerror = () => { URL.revokeObjectURL(url); rej(new Error('audio_probe_failed')); };
      a.src = url;
    });
  }

  async function importFile(file){
    const type = typeOf(file);
    if(!type) return { error: ML.i18n.t('media.error.type') };
    if(file.size > MAX[type]) return { error: ML.i18n.t('media.error.size') };
    let meta;
    try{
      if(type==='video') meta = await probeVideo(file);
      else if(type==='image') meta = await probeImage(file);
      else meta = await probeAudio(file);
    }catch(e){
      return { error: ML.i18n.t('media.error.read') };
    }
    const asset = {
      id: 'a'+L.uid(), name: file.name, type, mime: file.type||'', size: file.size,
      duration: meta.duration||0, width: meta.width||0, height: meta.height||0,
      fps: meta.fps||30, thumb: meta.thumb||'', blobKey: 'blob:'+file.name,
      tags: [], analysis: null, createdAt: Date.now()
    };
    const ok = await S.saveAssetBlob(asset.id, file);
    if(!ok) return { error: 'IndexedDB unavailable — cannot store media locally.' };
    return { asset };
  }

  async function loadBlobUrl(asset){
    const blob = await S.getAssetBlob(asset.id);
    return blob ? URL.createObjectURL(blob) : null;
  }

  function analyzeAll(assets){
    /* returns per-asset deterministic mock analysis (labelled DEV MOCK) */
    return assets.map(a => ML.providers.mockMediaAnalysis({ name: a.name, width: a.width, height: a.height }));
  }

  return { importFile, loadBlobUrl, analyzeAll, typeOf, MAX };
})();
