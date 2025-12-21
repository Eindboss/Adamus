// /assets/header.js — shared topbar loader (v4)
// - One consistent header everywhere
// - On QUIZ: hide dropdown, show ONLY 'Begin opnieuw', and push it to the right (spacing from brand)
// - On HOME + SUBJECT: hide all controls
(function(){
  if (window.TOPBAR_INITED) return; window.TOPBAR_INITED = true;
  'use strict';
  var mount = document.getElementById('topbar-root');
  if(!mount) return; if (mount.querySelector('.topbar')) return;

  function isQuiz(){
    var path = (location.pathname||'').toLowerCase();
    return !!document.getElementById('quizArea') || path.indexOf('quiz.html')>=0;
  }
  function isHome(){
    return document.body && document.body.dataset && document.body.dataset.page === 'home';
  }
  function isSubject(){
    var path = (location.pathname||'').toLowerCase();
    return path.indexOf('subject.html')>=0;
  }
  function $(sel){ return (mount||document).querySelector(sel); }

  window.__TOPBAR_HTML ? Promise.resolve({text:()=>Promise.resolve(window.__TOPBAR_HTML)}) : fetch('partials/topbar.html?v=20251106')
    .then(function(r){return r.text();})
    .then(function(html){
      mount.innerHTML = html; window.__TOPBAR_HTML = html;

      // Brand → index.html
      var brand = $('.brand');
      if (brand){
        brand.href = 'index.html';
        brand.addEventListener('click', function(e){
          if ((location.pathname||'').toLowerCase().indexOf('index.html')===-1){
            e.preventDefault(); location.href='index.html';
          }
        });
      }

      var controls = $('.controls');
      var restart  = $('#btn-restart');
      var select   = $('#subjectSelect');
      var group    = $('.group');

      if (isQuiz()){
        // Only 'Begin opnieuw' on quiz
        if (controls){ controls.style.display='flex'; controls.classList.add('quiz-only'); }
        if (restart){ restart.disabled=false; restart.style.display='inline-flex'; }
        if (select){  select.style.display='none'; }
        if (group){   group.style.display='none'; }
      } else {
        // No controls on home/subject
        if (controls){ controls.style.display='none'; }
      }
    })
    .catch(function(err){
      console.error('Header kon niet geladen worden:', err);
    });
})();
