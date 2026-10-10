/* ============ ML.router — hash routing ============ */
ML.router = (function(){
  let current = null;
  function parse(){
    const h = location.hash || '#/';
    if(h.indexOf('#/projects/')===0) return { name:'project', id: decodeURIComponent(h.slice('#/projects/'.length)) };
    if(h==='#/'||h==='#/projects') return { name:'home' };
    if(h==='#/new') return { name:'new' };
    if(h==='#/assets') return { name:'assets' };
    if(h==='#/settings') return { name:'settings' };
    return { name:'404' };
  }
  function go(path){
    if(location.hash === '#'+path) render();
    else location.hash = path;
  }
  function render(){
    const route = parse();
    if(current === route.name && route.name==='project' && currentId===route.id){ return; }
    const app = document.getElementById('app');
    if(!app) return;
    /* unmount workspace if leaving it */
    if(current==='project' && ML.workspace){ ML.workspace.unmount(); }
    const navActive = route.name;
    document.body.dataset.route = route.name;
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('on', n.dataset.route===navActive));
    current = route.name; currentId = route.id;
    try{
      if(route.name==='home') ML.views.home(app);
      else if(route.name==='new') ML.views.newEdit(app);
      else if(route.name==='assets') ML.views.assets(app);
      else if(route.name==='settings') ML.views.settings(app);
      else if(route.name==='project') ML.views.project(app, route.id);
      else ML.views.notFound(app);
    }catch(e){
      ML.diag && ML.diag.error('ROUTER','render',route.name,e);
      app.innerHTML = '<div class="view-error">'+ML.i18n.t('err.generic')+'<button class="btn" onclick="location.hash=\'#/\'">'+ML.i18n.t('err.home')+'</button></div>';
    }
  }
  let currentId = null;
  function init(){
    window.addEventListener('hashchange', render);
    if(!location.hash) location.replace('#/');
    render();
  }
  return { init, render, go, get current(){ return current; } };
})();
