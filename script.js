
/*! Adamus Quiz Engine — table/block UI (2025-11-09)
 *  - Ondersteunt: mc, open, short_text, grouped_short_text, translation_open,
 *                 grouped_translation, table_parse, grouped_select
 *  - MC detectie: answers/options/a + c
 *  - Toets (Flumen): behoudt originele structuur; speciale renderers i.p.v. flatten
 */
(function () {
  'use strict';

  /* ========================= Utilities ========================= */
  function $(id) { return document.getElementById(id); }
  function bySel(s, root){ return (root||document).querySelector(s); }
  function bySelAll(s, root){ return Array.prototype.slice.call((root||document).querySelectorAll(s)); }

  function subjectFromURL() {
    try {
      var p = new URLSearchParams(location.search);
      var s = (p.get('subject') || '').trim();
      return s || null;
    } catch (e) { return null; }
  }

  function htmlToText(html) {
    if (typeof html !== 'string') return '';
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function loadJSON(path) {
    return fetch(path, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('Kon ' + path + ' niet laden (' + r.status + ')');
        return r.json();
      })
      .catch(function (err) {
        if (window.__EMBEDDED_DATA && window.__EMBEDDED_DATA[path]) {
          console.warn('Gebruik embedded fallback voor', path, err);
          return window.__EMBEDDED_DATA[path];
        }
        throw err;
      });
  }

  /* ========================= Extractors ========================= */
  function extractQuestionsFlexible(data, schema) {
    try {
      if (!data) return [];
      if (schema === 'toets') {
        if (Array.isArray(data.questions)) return data.questions.slice();
        if (Array.isArray(data.toets)) {
          // Val terug op platte lijst van alle vragen in alle onderdelen
          var out = [];
          data.toets.forEach(function (sec) {
            if (sec && Array.isArray(sec.vragen)) sec.vragen.forEach(function (v) { out.push(v); });
          });
          return out;
        }
        return [];
      }
      // quiz/default
      if (Array.isArray(data.questions)) return data.questions.slice();
      if (Array.isArray(data)) return data.slice();
      if (data && typeof data === 'object' && Array.isArray(data.questions)) return data.questions.slice();
      return [];
    } catch (e) {
      console.warn('extractQuestionsFlexible error:', e);
      return [];
    }
  }

  /* ========================= Normalizers ========================= */
  function normalizeMC(raw) {
    var q = raw.q || raw.question || '';
    var explanation = raw.explanation || raw.why || raw.e || '';
    var answers = [], correctIndex = null;

    if (Array.isArray(raw.answers) || Array.isArray(raw.a)) {
      answers = (raw.answers || raw.a).slice();
      if (typeof raw.correctIndex === 'number') correctIndex = raw.correctIndex;
      if (typeof raw.c === 'number' && correctIndex == null) correctIndex = raw.c;
    } else if (Array.isArray(raw.options)) {
      raw.options.forEach(function (opt, idx) {
        answers.push(opt.text != null ? String(opt.text) : '');
        if (opt.correct && correctIndex === null) correctIndex = idx;
      });
      if (typeof raw.correctIndex === 'number') correctIndex = raw.correctIndex;
      if (typeof raw.c === 'number') correctIndex = raw.c;
      if (!explanation && raw.options) {
        var ci = correctIndex;
        if (ci != null && raw.options[ci] && raw.options[ci].why) explanation = raw.options[ci].why;
      }
    }
    return { type: 'mc', q: q, answers: answers, correctIndex: correctIndex, explanation: explanation };
  }

  function normalizeOpenSimple(qtext, accepts, explanation){
    return { type:'open', q: String(qtext||''), accept: (accepts||[]).slice(), explanation: explanation||'' };
  }

  function normalizeQuestion(raw, preferMC) {
    // Als er een 'type' is dat we speciaal ondersteunen (Flumen), laat 'm staan
    var richTypes = ['short_text','grouped_short_text','translation_open','grouped_translation','table_parse','grouped_select'];
    if (richTypes.indexOf(raw.type) >= 0) return raw;

    var hasMCSignals = Array.isArray(raw.answers) || Array.isArray(raw.options) || Array.isArray(raw.a);
    if (preferMC && hasMCSignals) {
      if (!raw.answers && Array.isArray(raw.a)) raw.answers = raw.a;
      if (typeof raw.correctIndex !== 'number' && typeof raw.c === 'number') raw.correctIndex = raw.c;
      if (!raw.explanation && typeof raw.e === 'string') raw.explanation = raw.e;
      return normalizeMC(raw);
    }
    if (raw.type === 'mc' || Array.isArray(raw.answers) || Array.isArray(raw.options) || Array.isArray(raw.a)) {
      if (!raw.answers && Array.isArray(raw.a)) raw.answers = raw.a;
      if (typeof raw.correctIndex !== 'number' && typeof raw.c === 'number') raw.correctIndex = raw.c;
      if (!raw.explanation && typeof raw.e === 'string') raw.explanation = raw.e;
      return normalizeMC(raw);
    }
    // open
    return {
      type: 'open',
      q: raw.q || raw.question || raw.vraag || '',
      accept: (raw.accept || []).slice(),
      caseSensitive: !!raw.caseSensitive,
      explanation: raw.explanation || raw.e || ''
    };
  }

  function shuffleMCAnswers(q) {
    if (q.type !== 'mc' || !Array.isArray(q.answers) || typeof q.correctIndex !== 'number') return q;
    var order = q.answers.map(function (_, i) { return i; });
    shuffle(order);
    var newAnswers = [], newCorrectIndex = null;
    order.forEach(function (oldIdx, newIdx) {
      newAnswers.push(q.answers[oldIdx]);
      if (oldIdx === q.correctIndex) newCorrectIndex = newIdx;
    });
    q.answers = newAnswers;
    q.correctIndex = newCorrectIndex;
    return q;
  }

  /* ========================= State/Stats ========================= */
  var QUESTION_SECONDS = 90;
  var QUESTIONS_PER_ROUND = null; // null = alles

  var SUBJECTS = null;
  var SUBJECT_META = {};
  var ALL_QUESTIONS = {};

  var state = {
    subjectId: null,
    roundQuestions: [],
    roundIndex: 0,
    score: 0, wrong: 0, skipped: 0,
    phase: 'question',
    answered: false, chosenIdx: null,
    remaining: QUESTION_SECONDS, timerId: null, paused: false,
    history: []
  };

  function storeKey(subjectId) { return 'adamus:' + subjectId + ':stats'; }
  function readStats() {
    var key = storeKey(state.subjectId);
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : { rounds: 0, correct: 0, total: 0 }; }
    catch (e) { return { rounds: 0, correct: 0, total: 0 }; }
  }
  function writeStats(s) {
    var key = storeKey(state.subjectId);
    try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) {}
  }

  /* ========================= Round builder ========================= */
  function buildRound() {
    var preferMC = !!(SUBJECT_META[state.subjectId] && SUBJECT_META[state.subjectId].preferMC);
    var schema = (SUBJECT_META[state.subjectId] && SUBJECT_META[state.subjectId].schema) || null;
    if (schema === 'quiz' && !preferMC) preferMC = true;

    var pool = (ALL_QUESTIONS[state.subjectId] || []).map(function (r) { return normalizeQuestion(r, preferMC); });
    if (schema !== 'toets') {
      // shuffle(pool); // zet aan als je random volgorde wilt
    }
    pool = pool.map(function (q) { return q.type === 'mc' ? shuffleMCAnswers(q) : q; });

    if (QUESTIONS_PER_ROUND != null) pool = pool.slice(0, QUESTIONS_PER_ROUND);

    state.roundQuestions = pool;
    state.roundIndex = 0; state.score = 0; state.wrong = 0; state.skipped = 0;
    state.phase = 'question'; state.history = [];
    resetTimer(); stopTimer(); updateMeta(); updateProgress();
  }

  /* ========================= Subject loading ========================= */
  function populateSubjectSelect() {
    var sel = $('subjectSelect');
    SUBJECT_META = {};

    if (Array.isArray(SUBJECTS) && SUBJECTS.length) {
      SUBJECTS.forEach(function (meta) {
        var id = meta && (meta.id || meta.key);
        if (!id) return;
        SUBJECT_META[id] = meta;
        if (sel) {
          var opt = document.createElement('option');
          opt.value = id;
          opt.textContent = meta.label || meta.name || id;
          sel.appendChild(opt);
        }
      });
    }

    if (sel) {
      var urlId = subjectFromURL();
      var def = (urlId && urlId) || (function(){ try {return localStorage.getItem('subjectId');}catch(e){return null;} })() || (SUBJECTS[0] && (SUBJECTS[0].id || SUBJECTS[0].key));
      if (def) sel.value = def;
      state.subjectId = sel.value;

      sel.addEventListener('change', function () {
        state.subjectId = sel.value;
        try { localStorage.setItem('subjectId', state.subjectId); } catch(e){}
        prepareSubject();
      });
    } else {
      var fromUrl = subjectFromURL();
      var def2 = (fromUrl && fromUrl) || (function(){ try {return localStorage.getItem('subjectId');}catch(e){return null;} })() || (SUBJECTS[0] && (SUBJECTS[0].id || SUBJECTS[0].key));
      if (def2) { state.subjectId = def2; }
    }
  }

  function prepareSubject() {
    if (!state.subjectId) {
      var urlId = subjectFromURL();
      if (urlId) state.subjectId = urlId;
      if (!state.subjectId && SUBJECTS && SUBJECTS.length) {
        state.subjectId = SUBJECTS[0].id || SUBJECTS[0].key;
      }
    }

    var meta = SUBJECT_META[state.subjectId];
    if (!meta && SUBJECTS && SUBJECTS.length) meta = (SUBJECTS.find(function (m) { return (m.id || m.key) === state.subjectId; }) || null);
    if (!meta) return;

    var pageTitle = $('pageTitle'); if (pageTitle) pageTitle.textContent = (meta.title || meta.label || 'Adamus – Quiz');

    if (ALL_QUESTIONS[state.subjectId]) { buildRound(); render(); return; }

    if (Array.isArray(meta.questions) && meta.questions.length) {
      ALL_QUESTIONS[state.subjectId] = meta.questions.slice();
      buildRound(); render(); return;
    }

    loadJSON(meta.file || meta.path).then(function (json) {
      var arr = extractQuestionsFlexible(json, meta.schema);
      if (!arr || !arr.length) throw new Error('Geen vragen gevonden in ' + (meta.file || meta.path || meta.id) + '.');
      ALL_QUESTIONS[state.subjectId] = arr;
      buildRound(); render();
    }).catch(function (err) {
      $('quizArea').innerHTML = '<p style="color:#7c2d12">Laden mislukt: ' + (err && err.message ? err.message : err) + '</p>';
    });
  }

  try { window.prepareSubject = prepareSubject; } catch (e) {}

  /* ========================= Timer ========================= */
  function startTimer() {
    stopTimer();
    updateCountdownUI();
    state.timerId = setInterval(function () {
      if (state.paused) return;
      state.remaining--;
      updateCountdownUI();
      if (state.remaining <= 0) { state.remaining = 0; stopTimer(); autoFailIfNoAnswer(); }
    }, 1000);
  }
  function stopTimer() { if (state.timerId) { clearInterval(state.timerId); state.timerId = null; } }
  function resetTimer() { state.remaining = QUESTION_SECONDS; updateCountdownUI(); }
  function updateCountdownUI() {
    var c = $('countdown'); if (c) c.textContent = String(state.remaining);
    var dot = $('timerDot'); if (dot) dot.style.background = state.paused ? '#eab308' : (state.remaining <= 10 ? '#ef4444' : '#22c55e');
  }
  function autoFailIfNoAnswer() {
    if (state.answered) return;
    var q = state.roundQuestions[state.roundIndex];
    var exp = $('explain'); if (exp) {
      exp.style.display = 'block';
      exp.innerHTML = '<div style="font-weight:700;color:#dc2626">⏱️ Tijd voorbij</div>' + (q.explanation ? '<div>' + q.explanation + '</div>' : '');
    }
    var s = readStats(); s.total += 1; state.wrong += 1; writeStats(s);
    state.history.push({ q: renderTitleForHistory(q), type: q.type, userAnswer: '(tijd op)', correct: false, explanation: q.explanation });
    $('nextBtn').disabled = false; $('checkBtn').disabled = true; state.answered = true;
    updateMeta(); updateProgress();
  }

  /* ========================= Rendering helpers ========================= */
  function renderTitleForHistory(q){
    if (q.type === 'mc' || q.type === 'open') return q.q || '';
    // Flumen types: maak een korte titel
    if (q.prompt_html) return htmlToText(q.prompt_html);
    if (q.prompt) return String(q.prompt);
    if (q.vraag) return String(q.vraag);
    return q.q || q.title || 'Vraag';
  }

  function setBusy(area, on){ if (!area) return; if (on) area.setAttribute('aria-busy','true'); else area.removeAttribute('aria-busy'); }

  function updateMeta() {
    var stat = $('stat');
    var total = state.roundQuestions.length;
    var idx = Math.min(state.roundIndex + 1, total);
    if (stat) stat.textContent = state.score + ' goed / ' + state.wrong + ' fout / ' + state.skipped + ' overgeslagen • vraag ' + idx + ' van ' + total;
    var progressEl = document.querySelector('.progress');
    if (progressEl) progressEl.setAttribute('data-label', 'Vraag ' + idx + ' van ' + total);
  }
  function updateProgress() {
    var total = state.roundQuestions.length;
    var done = state.roundIndex;
    var pct = total ? Math.round((done / total) * 100) : 0;
    var bar = $('progressBar'); if (bar) bar.style.width = pct + '%';
  }

  /* ========================= Renderers (UI) ========================= */
  function renderOpen(q){
    var area = $('quizArea'); setBusy(area, true);
    var html = '<div class="qtitle">' + (q.q || q.prompt || '') + '</div>';
    html += '<div class="openwrap"><textarea id="openInput" placeholder="Typ je antwoord" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Antwoord"></textarea></div>';
    html += '<div id="explain" class="expl" role="status" aria-live="polite" aria-atomic="true" style="display:none"></div>';
    area.innerHTML = html;

    $('checkBtn').disabled = true; $('nextBtn').disabled = true;
    state.answered = false; state.chosenIdx = null; state.currentComplex = null;
    resetTimer(); startTimer(); updateMeta(); updateProgress();
    var sb = $('skipBtn'); if (sb) { sb.textContent = (q._revisit ? 'Definitief overslaan' : 'Voorlopig overslaan'); }
    var tx = $('openInput'); if (tx) { tx.addEventListener('input', function () { $('checkBtn').disabled = (tx.value.trim().length === 0); }); tx.focus(); }
    setBusy(area, false);
  }

  function renderMC(q){
    var area = $('quizArea'); setBusy(area, true);
    var html = '<div class="qtitle">' + (q.q || '') + '</div>';
    html += '<div class="options" role="radiogroup" aria-label="opties">';
    (q.answers || []).forEach(function (txt, idx) {
      html += '<div class="option" data-idx="' + idx + '" role="radio" aria-checked="false" tabindex="0"><div class="opt-text">' + txt + '</div></div>';
    });
    html += '</div><div id="explain" class="expl" role="status" aria-live="polite" aria-atomic="true" style="display:none"></div>';
    area.innerHTML = html;

    var checkBtn = $('checkBtn'); if (checkBtn) { checkBtn.disabled = true; }
    Array.prototype.forEach.call(area.querySelectorAll('.option'), function (el) {
      function activate() {
        area.querySelectorAll('.option').forEach(function (o) { o.classList.remove('active'); o.setAttribute('aria-checked', 'false'); });
        el.classList.add('active'); el.setAttribute('aria-checked', 'true');
        state.chosenIdx = parseInt(el.getAttribute('data-idx'), 10);
        if (checkBtn) { checkBtn.disabled = false; }
      }
      el.addEventListener('click', activate);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    });
    $('nextBtn').disabled = true;
    state.answered = false; state.currentComplex = null;
    resetTimer(); startTimer(); updateMeta(); updateProgress();
    var first = area.querySelector('.option'); if (first) first.focus();
    setBusy(area, false);
  }

  /* ---- Flumen: short_text (één kort antwoord) ---- */
  function renderShortText(q){
    renderOpen({ q: q.prompt || htmlToText(q.prompt_html), accept: ((q.answer && q.answer.accepted) || []), explanation: (q.tags && q.tags.join(', ')) || '' });
    // stash accept list for checker
    state.currentComplex = { type: 'short_text', accept: (q.answer && q.answer.accepted) || [] };
  }

  /* ---- Flumen: grouped_short_text ---- */
  function renderGroupedShort(q){
    var area = $('quizArea'); setBusy(area, true);
    var base = q.prompt_html ? htmlToText(q.prompt_html) : (q.prompt || 'Vragen');
    var html = '<div class="qtitle">' + base + '</div>';

    html += '<div class="group">';
    function addRow(label, acc, key){
      html += '<div class="row"><label for="'+key+'">'+label+'</label><input id="'+key+'" type="text" autocomplete="off"/></div>';
    }

    var rows = [];
    if (Array.isArray(q.words)) {
      q.words.forEach(function (w, wi) {
        var label = (w.latijn || w.vraag || (base + ' ' + (wi + 1)));
        if (Array.isArray(w.subfields) && w.subfields.length) {
          w.subfields.forEach(function (sf, sfi) {
            rows.push({ key: 'w'+wi+'s'+sfi, label: label + ' · ' + (sf.label || ('deel ' + (sfi + 1))), acc: (sf.accepted || []) });
          });
        } else {
          rows.push({ key: 'w'+wi, label: label, acc: (w.accepted || []) });
        }
      });
    } else if (Array.isArray(q.items)) {
      q.items.forEach(function (it, ii) {
        var label = (it.vraag || it.latijn || (base + ' ' + (ii + 1)));
        if (Array.isArray(it.subfields) && it.subfields.length) {
          it.subfields.forEach(function (sf, sfi) {
            rows.push({ key: 'i'+ii+'s'+sfi, label: label + ' · ' + (sf.label || ('deel ' + (sfi + 1))), acc: (sf.accepted || []) });
          });
        } else {
          rows.push({ key: 'i'+ii, label: label, acc: (it.accepted || []) });
        }
      });
    }

    rows.forEach(function(r){ addRow(r.label, r.acc, r.key); });
    html += '</div>';
    html += '<div id="explain" class="expl" role="status" aria-live="polite" aria-atomic="true" style="display:none"></div>';
    area.innerHTML = html;

    $('checkBtn').disabled = false; // mag direct, maar resultaat pas na controle
    $('nextBtn').disabled = true; state.answered = false;
    state.currentComplex = { type: 'grouped_short_text', rows: rows };
    resetTimer(); startTimer(); updateMeta(); updateProgress();
    setBusy(area, false);
  }

  /* ---- Flumen: translation_open (één vertaling) ---- */
  function renderTranslationOpen(q){
    var base = q.prompt_html ? htmlToText(q.prompt_html) : (q.prompt || 'Vertaal');
    var acc = ((q.answer && q.answer.accepted_any && q.answer.accepted_any[0]) || []).slice();
    renderOpen({ q: base, accept: acc, explanation: (q.tags && q.tags.join(', ')) || '' });
    state.currentComplex = { type:'translation_open', accept: acc };
  }

  /* ---- Flumen: grouped_translation ---- */
  function renderGroupedTranslation(q){
    var area = $('quizArea'); setBusy(area, true);
    var base = q.prompt_html ? htmlToText(q.prompt_html) : (q.prompt || 'Vertaal');
    var html = '<div class="qtitle">' + base + '</div>';

    var rows = [];
    (q.items||[]).forEach(function(it, ii){
      var label = htmlToText(it.latijn_html || (base + ' ' + (ii+1)));
      rows.push({ key: 'gt'+ii, label: label, acc: (it.accepted || []) });
    });

    html += '<div class="group">';
    rows.forEach(function(r){
      html += '<div class="row"><label for="'+r.key+'">'+r.label+'</label><input id="'+r.key+'" type="text" autocomplete="off"/></div>';
    });
    html += '</div>';
    html += '<div id="explain" class="expl" role="status" aria-live="polite" aria-atomic="true" style="display:none"></div>';
    area.innerHTML = html;

    $('checkBtn').disabled = false; $('nextBtn').disabled = true; state.answered = false;
    state.currentComplex = { type:'grouped_translation', rows: rows };
    resetTimer(); startTimer(); updateMeta(); updateProgress();
    setBusy(area, false);
  }

  /* ---- Flumen: table_parse ---- */
  function renderTableParse(q){
    var area = $('quizArea'); setBusy(area, true);
    var base = q.prompt_html ? htmlToText(q.prompt_html) : (q.prompt || 'Invullen');
    var html = '<div class="qtitle">' + base + '</div>';

    var rows = [];
    if (Array.isArray(q.blocks)) {
      q.blocks.forEach(function(b, bi){
        (b.rows||[]).forEach(function(r, ri){
          if (r.invulbaar){
            rows.push({
              key: 'b'+bi+'r'+ri,
              label: ((b.lemma ? b.lemma + ' · ' : '') + (r.veld || '')), 
              acc: (r.accepted || [])
            });
          }
        });
      });
    } else if (q.table && Array.isArray(q.table.rows)) {
      q.table.rows.forEach(function(r, ri){
        rows.push({
          key: 'tr'+ri,
          label: (r.veld || ''),
          acc: (function(){
            var acc = [];
            if (r.antwoord){
              acc = (r.antwoord.accepted || []).slice();
              if (r.antwoord.aliases){
                Object.keys(r.antwoord.aliases).forEach(function(k){
                  (r.antwoord.aliases[k]||[]).forEach(function(a){ acc.push(a); });
                });
              }
            }
            return acc;
          })()
        });
      });
    }

    html += '<table class="tbl">';
    html += '<thead><tr><th style="text-align:left">Veld</th><th style="text-align:left">Antwoord</th></tr></thead><tbody>';
    rows.forEach(function(r){
      html += '<tr><td>'+r.label+'</td><td><input id="'+r.key+'" type="text" autocomplete="off"/></td></tr>';
    });
    html += '</tbody></table>';
    html += '<div id="explain" class="expl" role="status" aria-live="polite" aria-atomic="true" style="display:none"></div>';
    area.innerHTML = html;

    $('checkBtn').disabled = false; $('nextBtn').disabled = true; state.answered = false;
    state.currentComplex = { type:'table_parse', rows: rows };
    resetTimer(); startTimer(); updateMeta(); updateProgress();
    setBusy(area, false);
  }

  /* ---- Flumen: grouped_select ---- */
  var CASE_OPTIONS = ['nominativus','genitivus','dativus','accusativus','ablativus','vocativus','locativus'];
  var NUMBER_OPTIONS = ['enkelvoud','meervoud'];
  function renderGroupedSelect(q){
    var area = $('quizArea'); setBusy(area, true);
    var base = q.prompt_html ? htmlToText(q.prompt_html) : (q.prompt || 'Kies naamval/getal/verklaring');
    var html = '<div class="qtitle">' + base + '</div>';

    var items = (q.items||[]).map(function(it, ii){
      return {
        key: 'gs'+ii,
        label: htmlToText(it.latijn_html || (base + ' ' + (ii+1))),
        correct: it.correct || {}
      };
    });

    html += '<div class="group">';
    items.forEach(function(item){
      html += '<div class="row">';
      html += '<div class="label">'+item.label+'</div>';
      html += '<div class="selwrap">';
      html += '<select id="'+item.key+'-casus" aria-label="naamval"><option value="">– naamval –</option>';
      CASE_OPTIONS.forEach(function(c){ html += '<option value="'+c+'">'+c+'</option>'; });
      html += '</select>';
      html += '<select id="'+item.key+'-num" aria-label="getal"><option value="">– getal –</option>';
      NUMBER_OPTIONS.forEach(function(n){ html += '<option value="'+n+'">'+n+'</option>'; });
      html += '</select>';
      html += '<input id="'+item.key+'-why" type="text" placeholder="verklaring" autocomplete="off" aria-label="verklaring"/>';
      html += '</div></div>';
    });
    html += '</div>';
    html += '<div id="explain" class="expl" role="status" aria-live="polite" aria-atomic="true" style="display:none"></div>';
    area.innerHTML = html;

    $('checkBtn').disabled = false; $('nextBtn').disabled = true; state.answered = false;
    state.currentComplex = { type:'grouped_select', items: items };
    resetTimer(); startTimer(); updateMeta(); updateProgress();
    setBusy(area, false);
  }

  /* ========================= Render switch ========================= */
  function renderQuestion(q) {
    var area = $('quizArea');
    if (!q) { renderSummary(); return; }

    // Reset complex stash per vraag
    state.currentComplex = null;

    if (q.type === 'open') return renderOpen(q);
    if (q.type === 'mc') return renderMC(q);

    switch(q.type){
      case 'short_text': return renderShortText(q);
      case 'grouped_short_text': return renderGroupedShort(q);
      case 'translation_open': return renderTranslationOpen(q);
      case 'grouped_translation': return renderGroupedTranslation(q);
      case 'table_parse': return renderTableParse(q);
      case 'grouped_select': return renderGroupedSelect(q);
      default: // fallback: render als open
        return renderOpen(normalizeOpenSimple(q.prompt || q.q || 'Vraag', [], (q.tags && q.tags.join(', ')) || ''));
    }
  }

  function render() {
    var q = state.roundQuestions[state.roundIndex];
    if (!q) { renderSummary(); return; }
    renderQuestion(q);
    $('nextBtn').textContent = (state.roundIndex === state.roundQuestions.length - 1) ? 'Eindresultaat' : 'Volgende';
  }

  function renderSummary() {
    stopTimer();
    var s = readStats(); var area = $('quizArea');
    var html = '<div class="qtitle">Ronde klaar!</div>';
    html += '<p>Score: <strong>' + state.score + '</strong> goed, <strong>' + state.wrong + '</strong> fout, <strong>' + state.skipped + '</strong> overgeslagen (totaal ' + state.roundQuestions.length + ').</p>';
    html += '<p>Totaal (alle rondes): <strong>' + s.correct + '</strong> goed van <strong>' + s.total + '</strong>.</p>';
    if (state.history.length) {
      html += '<table class="summary-table"><thead><tr><th>#</th><th>Vraag</th><th>Jouw antwoord</th><th>Resultaat</th></tr></thead><tbody>';
      state.history.forEach(function (it, i) {
        var rightText = it.rightText || '';
        html += '<tr>';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td>' + it.q + '</td>';
        html += '<td>' + (it.userAnswer || '') + '</td>';
        html += '<td>' + (it.correct ? '<span class="badge ok">Goed</span>' : '<span class="badge no">Fout</span>') +
          (rightText ? '<div style="font-size:12px;color:#6b7280;margin-top:4px">Juiste antwoord: ' + rightText + '</div>' : '') +
          (it.explanation ? '<div style="font-size:12px;color:#6b7280;margin-top:4px">' + it.explanation + '</div>' : '') +
          (it.skipped ? '<div class="badge" style="background:#e5e7eb;color:#111827;margin-top:4px">Overgeslagen</div>' : '') +
          '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    area.innerHTML = html;
    $('checkBtn').disabled = true; $('nextBtn').disabled = true;
    var sb = $('skipBtn'); if (sb) { sb.textContent = 'Voorlopig overslaan'; }
    updateMeta(); updateProgress();
  }

  /* ========================= Checking ========================= */
  function checkOpenAcceptList(acceptList, input, caseSensitive){
    var inp = String(input || '');
    var norm = caseSensitive ? inp.trim() : inp.trim().toLowerCase();
    for (var i = 0; i < (acceptList||[]).length; i++) {
      var rxStr = acceptList[i];
      try {
        if (typeof rxStr === 'string' && rxStr.startsWith('/') && rxStr.lastIndexOf('/') > 0) {
          var last = rxStr.lastIndexOf('/');
          var body = rxStr.slice(1, last), flags = rxStr.slice(last + 1);
          var rx = new RegExp(body, flags);
          if (rx.test(inp)) return true;
        } else {
          var target = caseSensitive ? String(rxStr).trim() : String(rxStr).trim().toLowerCase();
          if (norm === target) return true;
        }
      } catch (e) {}
    }
    return false;
  }

  function checkNow() {
    if (state.answered) return;
    var q = state.roundQuestions[state.roundIndex];
    var exp = $('explain');

    // MC?
    if (q.type === 'mc') {
      if (state.chosenIdx == null) {
        var btn = $('checkBtn');
        if (btn) {
          btn.classList.add('shake');
          setTimeout(function () { btn.classList.remove('shake'); }, 500);
        }
        var opts = document.querySelector('.options');
        if (opts) {
          opts.classList.add('needs-choice');
          setTimeout(function () { opts.classList.remove('needs-choice'); }, 600);
        }
        return;
      }

      stopTimer();
      var chosenIdx = state.chosenIdx;
      var area = $('quizArea');
      var opts2 = area.querySelectorAll('.option');
      opts2.forEach(function (lab, i) {
        if (i === q.correctIndex) lab.classList.add('correct');
        if (i === chosenIdx && chosenIdx !== q.correctIndex) lab.classList.add('wrong');
        lab.setAttribute('tabindex', '-1');
      });
      var correct2 = (chosenIdx === q.correctIndex);
      if (exp) {
        exp.style.display = 'block';
        exp.innerHTML = '<div style="font-weight:700;' + (correct2 ? 'color:#16a34a' : 'color:#dc2626') + '">' +
          (correct2 ? '✅ Goed!' : '❌ Niet goed') + '</div>' +
          (q.explanation ? '<div>' + q.explanation + '</div>' : '');
      }
      var s2 = readStats(); s2.total += 1;
      if (correct2) { s2.correct += 1; state.score += 1; } else { state.wrong += 1; }
      writeStats(s2);
      state.history.push({
        q: q.q, type: 'mc', answers: q.answers, correctIndex: q.correctIndex,
        userAnswer: q.answers[chosenIdx], correct: correct2, explanation: q.explanation,
        rightText: q.answers[q.correctIndex]
      });
      $('nextBtn').disabled = false; $('checkBtn').disabled = true; state.answered = true;
      return;
    }

    // OPEN simple
    if (q.type === 'open') {
      stopTimer();
      var val = ($('openInput') && $('openInput').value) || '';
      var correct = checkOpenAcceptList(q.accept || [], val, q.caseSensitive);
      if (exp) {
        exp.style.display = 'block';
        exp.innerHTML = '<div style="font-weight:700;' + (correct ? 'color:#16a34a' : 'color:#dc2626') + '">' +
          (correct ? '✅ Goed!' : '❌ Niet goed') + '</div>' +
          (q.explanation ? '<div>' + q.explanation + '</div>' : '');
      }
      var s = readStats(); s.total += 1;
      if (correct) { s.correct += 1; state.score += 1; } else { state.wrong += 1; }
      writeStats(s);
      state.history.push({ q: q.q, type: 'open', userAnswer: val, correct: correct, explanation: q.explanation });
      $('nextBtn').disabled = false; $('checkBtn').disabled = true; state.answered = true;
      return;
    }

    // Complexe Flumen types
    var cx = state.currentComplex || {};
    var allCorrect = true;
    var detail = [];

    function showResult(correct, extraHtml){
      stopTimer();
      if (exp) {
        exp.style.display = 'block';
        exp.innerHTML = '<div style="font-weight:700;' + (correct ? 'color:#16a34a' : 'color:#dc2626') + '">' +
          (correct ? '✅ Goed!' : '❌ Niet goed') + '</div>' + (extraHtml || '');
      }
      var s = readStats(); s.total += 1;
      if (correct) { s.correct += 1; state.score += 1; } else { state.wrong += 1; }
      writeStats(s);
      state.history.push({ q: renderTitleForHistory(q), type: q.type, userAnswer: '(complexe vraag)', correct: correct, explanation: q.explanation });
      $('nextBtn').disabled = false; $('checkBtn').disabled = true; state.answered = true;
    }

    if (q.type === 'short_text' && cx.type === 'short_text') {
      var val1 = ($('openInput') && $('openInput').value) || '';
      var ok1 = checkOpenAcceptList(cx.accept || [], val1, false);
      showResult(ok1, '');
      return;
    }

    if (q.type === 'grouped_short_text' && cx.type === 'grouped_short_text') {
      var rows = cx.rows || [];
      var okCount = 0;
      var html = '<ul style="margin-top:6px">';
      rows.forEach(function(r){
        var v = (bySel('#'+r.key) && bySel('#'+r.key).value) || '';
        var ok = checkOpenAcceptList(r.acc||[], v, false);
        if (ok) okCount++;
        html += '<li>' + r.label + ': ' + (ok ? '✅' : '❌') + '</li>';
      });
      html += '</ul>';
      showResult(okCount === rows.length && rows.length>0, html);
      return;
    }

    if (q.type === 'translation_open' && cx.type === 'translation_open') {
      var val2 = ($('openInput') && $('openInput').value) || '';
      var ok2 = checkOpenAcceptList(cx.accept||[], val2, false);
      showResult(ok2, '');
      return;
    }

    if (q.type === 'grouped_translation' && cx.type === 'grouped_translation') {
      var rows2 = cx.rows || [];
      var okCount2 = 0;
      var html2 = '<ul style="margin-top:6px">';
      rows2.forEach(function(r){
        var v = (bySel('#'+r.key) && bySel('#'+r.key).value) || '';
        var ok = checkOpenAcceptList(r.acc||[], v, false);
        if (ok) okCount2++;
        html2 += '<li>' + r.label + ': ' + (ok ? '✅' : '❌') + '</li>';
      });
      html2 += '</ul>';
      showResult(okCount2 === rows2.length && rows2.length>0, html2);
      return;
    }

    if (q.type === 'table_parse' && cx.type === 'table_parse') {
      var rows3 = cx.rows || [];
      var okCount3 = 0;
      var html3 = '<ul style="margin-top:6px">';
      rows3.forEach(function(r){
        var v = (bySel('#'+r.key) && bySel('#'+r.key).value) || '';
        var ok = checkOpenAcceptList(r.acc||[], v, false);
        if (ok) okCount3++;
        html3 += '<li>' + r.label + ': ' + (ok ? '✅' : '❌') + '</li>';
      });
      html3 += '</ul>';
      showResult(okCount3 === rows3.length && rows3.length>0, html3);
      return;
    }

    if (q.type === 'grouped_select' && cx.type === 'grouped_select') {
      var items = cx.items || [];
      var okCount4 = 0;
      var html4 = '<ul style="margin-top:6px">';
      items.forEach(function(it){
        var casus = (bySel('#'+it.key+'-casus') && bySel('#'+it.key+'-casus').value) || '';
        var num = (bySel('#'+it.key+'-num') && bySel('#'+it.key+'-num').value) || '';
        var why = (bySel('#'+it.key+'-why') && bySel('#'+it.key+'-why').value) || '';
        var c = it.correct || {};
        var okC = true;
        if (c.naamval) okC = okC && (String(casus).toLowerCase() === String(c.naamval).toLowerCase());
        if (c.getal) okC = okC && (String(num).toLowerCase() === String(c.getal).toLowerCase());
        // verklaring laten we vrij, maar als c.verklaring er is en niet leeg, eisen we non-empty invoer
        if (c.verklaring) okC = okC && (why.trim().length > 0);
        if (okC) okCount4++;
        html4 += '<li>' + it.label + ': ' + (okC ? '✅' : '❌') + '</li>';
      });
      html4 += '</ul>';
      showResult(okCount4 === items.length && items.length>0, html4);
      return;
    }

    // fallback
    stopTimer();
    if (exp) { exp.style.display = 'block'; exp.textContent = 'Niet-herkende vraagvorm.'; }
    $('nextBtn').disabled = false; $('checkBtn').disabled = true; state.answered = true;
  }

  function skipQuestion() {
    var q = state.roundQuestions[state.roundIndex];
    if (!q) { renderSummary(); return; }
    stopTimer();
    state.skipped += 1;
    var def = !!q._revisit;
    state.history.push({ q: renderTitleForHistory(q), type: q.type, userAnswer: def ? '(definitief overgeslagen)' : '(overgeslagen)', skipped: true, defSkipped: def, explanation: q.explanation });

    if (!q._revisit) {
      try { var clone = JSON.parse(JSON.stringify(q)); clone._revisit = true; state.roundQuestions.push(clone); }
      catch (e) { var ref = Object.assign({}, q, { _revisit: true }); state.roundQuestions.push(ref); }
    }

    if (state.roundIndex < state.roundQuestions.length - 1) {
      state.roundIndex += 1; render();
    } else { renderSummary(); }
  }

  function nextStep() {
    if (state.roundIndex < state.roundQuestions.length - 1) {
      state.roundIndex += 1; render();
    } else {
      renderSummary();
    }
  }

  /* ========================= Pause ========================= */
  function showPause() { state.paused = true; stopTimer(); var o = $('pauseOverlay'); if (o) o.classList.add('show'); document.body.classList.add('is-paused'); var pg = document.querySelector('.page'); if (pg) { pg.classList.add('is-paused'); pg.setAttribute('aria-hidden', 'true'); } }
  function hidePause() { var o = $('pauseOverlay'); if (o) o.classList.remove('show'); document.body.classList.remove('is-paused'); var pg = document.querySelector('.page'); if (pg) { pg.classList.remove('is-paused'); pg.removeAttribute('aria-hidden'); } state.paused = false; startTimer(); }

  /* ========================= Init ========================= */
  function init() {
    var checkBtn = $('checkBtn'); if (checkBtn) checkBtn.addEventListener('click', checkNow);
    var nextBtn = $('nextBtn'); if (nextBtn) nextBtn.addEventListener('click', nextStep);
    var pauseBtn = $('pauseBtn'); if (pauseBtn) pauseBtn.addEventListener('click', showPause);
    var skipBtn = $('skipBtn'); if (skipBtn) skipBtn.addEventListener('click', skipQuestion);
    var resumeBtn = $('resumeBtn'); if (resumeBtn) resumeBtn.addEventListener('click', hidePause);
    loadJSON('subjects.json').then(function (res) {
      SUBJECTS = res.subjects || res || [];
      populateSubjectSelect();
      prepareSubject();
    }).catch(function (err) {
      $('quizArea').innerHTML = '<p style="color:#7c2d12">Kon subjects.json niet laden: ' + (err && err.message ? err.message : err) + '</p>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// Delegated restart knop
(function () {
  document.addEventListener('click', function (e) {
    var tgt = e.target;
    var btn = (tgt && (tgt.id === 'btn-restart')) ? tgt : (tgt && tgt.closest ? tgt.closest('#btn-restart') : null);
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (window.__RESTARTING__) return;
    var ok = confirm('Weet je zeker dat je opnieuw wilt beginnen? Je voortgang in deze toets gaat verloren.');
    if (!ok) return;
    window.__RESTARTING__ = true;
    try {
      if (window.prepareSubject && typeof window.prepareSubject === 'function') { window.prepareSubject(); }
    } finally {
      setTimeout(function () { window.__RESTARTING__ = false; }, 300);
    }
  }, true);
})();
