/* ============ ML.store — IndexedDB persistence (projects / asset blobs / kv) ============ */
ML.store = (function(){
  const DB_NAME = 'motion-lab-db', DB_VER = 2;
  let db = null;
  const LS_KEY = 'motionlab.v2.';

  function idbOk(){ return typeof indexedDB !== 'undefined'; }
  function openDB(){
    return new Promise((res, rej) => {
      if(!idbOk()) return rej(new Error('no_idb'));
      const timer = setTimeout(()=>rej(new Error('idb_timeout')), 2500);
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if(!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', {keyPath:'id'});
        if(!d.objectStoreNames.contains('assets')) d.createObjectStore('assets', {keyPath:'id'});
        if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        /* v1 projects carry old template fields — they stay, new writes use v2 shape */
        if(d.objectStoreNames.contains('kv')){
          try{ const tx = e.target.transaction; tx.objectStore('kv').delete('favorites'); tx.objectStore('kv').delete('brand'); }catch(err){}
        }
      };
      req.onsuccess = e => { clearTimeout(timer); db = e.target.result; res(db); };
      req.onerror = () => { clearTimeout(timer); rej(req.error); };
      req.onblocked = () => { clearTimeout(timer); rej(new Error('idb_blocked')); };
    });
  }
  function idbStore(name, mode){
    return new Promise((res, rej) => {
      if(!db) return rej(new Error('db_not_open'));
      const tx = db.transaction(name, mode);
      res(tx.objectStore(name));
    });
  }
  const idbGet = (store, key) => new Promise((res, rej) => { const r = store.get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbPut = (store, key, val) => new Promise((res, rej) => {
    let r; try{ r = store.keyPath ? store.put(val) : store.put(val, key); }catch(e){ return rej(e); }
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
  const idbDel = (store, key) => new Promise((res, rej) => { const r = store.delete(key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  const idbAll = (store) => new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const lsGet = k => { try { return JSON.parse(localStorage.getItem(LS_KEY + k)); } catch(e){ return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(LS_KEY + k, JSON.stringify(v)); } catch(e){} };

  async function init(){
    try { await openDB(); } catch(e){ db = null; }
  }
  function ready(){ return db ? true : idbOk(); }

  /* ===== projects ===== */
  async function listProjects(){
    if(db){ try { const s = await idbStore('projects','readonly'); const all = await idbAll(s); return all.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)); } catch(e){} }
    return lsGet('projects') || [];
  }
  async function getProject(id){
    if(db){ try { const s = await idbStore('projects','readonly'); return await idbGet(s, id); } catch(e){} }
    return (lsGet('projects')||[]).find(p=>p.id===id) || null;
  }
  async function saveProject(p){
    if(!p || !p.id) return;
    p.updatedAt = Date.now();
    if(db){ try { const s = await idbStore('projects','readwrite'); await idbPut(s, p.id, p); return; } catch(e){} }
    const list = lsGet('projects')||[];
    const i = list.findIndex(x=>x.id===p.id);
    if(i>=0) list[i]=p; else list.push(p);
    lsSet('projects', list);
  }
  async function deleteProject(id){
    if(db){ try { const s = await idbStore('projects','readwrite'); await idbDel(s, id); } catch(e){} }
    lsSet('projects', (lsGet('projects')||[]).filter(p=>p.id!==id));
  }

  /* ===== asset blobs ===== */
  async function saveAssetBlob(assetId, blob){
    if(db){ try { const s = await idbStore('assets','readwrite'); await idbPut(s, assetId, { id: assetId, blob }); return true; } catch(e){ return false; } }
    return false;
  }
  async function getAssetBlob(assetId){
    if(db){ try { const s = await idbStore('assets','readonly'); const r = await idbGet(s, assetId); return r && r.blob ? r.blob : null; } catch(e){ return null; } }
    return null;
  }
  async function deleteAssetBlob(assetId){
    if(db){ try { const s = await idbStore('assets','readwrite'); await idbDel(s, assetId); } catch(e){} }
  }

  /* ===== settings / kv ===== */
  async function getSetting(key, def){
    if(db){ try { const s = await idbStore('kv','readonly'); const v = await idbGet(s,'set:'+key); return v===undefined?def:v; } catch(e){} }
    const v = lsGet('set:'+key); return v===undefined||v===null?def:v;
  }
  async function setSetting(key, val){
    if(db){ try { const s = await idbStore('kv','readwrite'); await idbPut(s,'set:'+key, val); } catch(e){} }
    lsSet('set:'+key, val);
  }

  /* ===== legacy cleanup: drop v1 template-era projects entirely ===== */
  async function cleanupLegacy(){
    if(!db) return;
    try{
      const s = await idbStore('projects','readwrite');
      const all = await idbAll(s);
      for(const p of all){
        if(p && p.templateId && !p.scenes){ /* old motion-template project shape */
          await idbDel(s, p.id);
        }
      }
    }catch(e){}
  }

  return { init, ready, cleanupLegacy, listProjects, getProject, saveProject, deleteProject,
    saveAssetBlob, getAssetBlob, deleteAssetBlob, getSetting, setSetting };
})();