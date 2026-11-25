/* Mathematics in Motion - admin page: a tree of syllabus topics (branches); each lesson is a subtopic added inside its branch with the assistant. Uses supabase-js v2 (loaded from a CDN in admin.html).
 * The assistant (generate-lesson Edge Function) writes the lesson; the author sees a draft preview and posts it.
 * The full form stays in the page, hidden behind "Edit details by hand", and is the single source of truth for what gets saved.
 * Lessons are grouped by Syllabus B topic (content/syllabus-b.json) and numbered within the topic: 10.1, 10.2, ... */
(function () {
  var cfg = window.MIM_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var show = function (id, on) { $(id).classList.toggle('hidden', !on); };

  if (!(cfg.supabaseUrl && cfg.supabaseAnonKey) || !window.supabase) {
    show('not-connected', true);
    return;
  }
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  var lessons = [];
  var current = null;      // the lesson in the form (may be unsaved)
  var draftReady = false;  // true when the form holds something that "post it" in the chat may publish
  var activeTopic = 0;     // the topic whose branch holds the post panel
  var panelEl = $('post-panel'); // kept by reference: it is detached and re-attached when the tree re-renders
  var numKey = (window.MIM && window.MIM.numKey) || function (n) {
    var m = /^(\d+)\.(\d+)$/.exec(String(n || '').trim());
    return m ? parseInt(m[1], 10) * 1000 + parseInt(m[2], 10) : 999999;
  };

  function status(id, msg, ok) {
    var el = $(id);
    el.textContent = msg;
    el.classList.add('show');
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('no', !ok);
    if (ok) setTimeout(function () { el.classList.remove('show'); }, 5000);
  }

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  function videoId(s) {
    s = String(s || '').trim();
    var m = /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(s);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function lessonUrl(slug) { return 'lesson.html?id=' + encodeURIComponent(slug || ''); }

  // ---------- syllabus (content/syllabus-b.json), with the topic names as a fallback if the file cannot be fetched
  var TOPIC_NAMES = ['Real Numbers', 'Sets', 'Financial Mathematics', 'Measures and Mensuration', 'Graphs', 'Variation', 'Algebra',
    'Geometry', 'Statistics', 'Trigonometry', 'Matrices', 'Vectors', 'Transformations', 'Probability'];
  var syllabus = TOPIC_NAMES.map(function (name, i) { return { number: i + 1, name: name, subtopics: [] }; });
  var ownTopics = []; // the author's own topics from the topics table (numbers 15+)
  // Only topics the author has added appear; the syllabus list is a menu of suggestions.
  function allTopics() { return ownTopics; }
  var syllabusReady = fetch('content/syllabus-b.json').then(function (r) { return r.json(); }).then(function (j) {
    if (j && Array.isArray(j.topics) && j.topics.length) syllabus = j.topics;
  }).catch(function () { /* keep the fallback names */ }).then(function () {
    fillTopicSelect();
  });

  function topicOf(n) {
    n = parseInt(n, 10);
    return allTopics().filter(function (t) { return t.number === n; })[0] || null;
  }
  function topicName(n) { var t = topicOf(n); return t ? t.name : ''; }
  function chapterOf(n) { var t = topicOf(n); return t ? 'Topic ' + t.number + ' · ' + t.name : ''; }
  // The syllabus topic a lesson belongs to: the stored field, else the prefix of its number.
  function lessonTopic(l) {
    var t = parseInt(l.syllabus_topic, 10);
    if (t >= 1) return t;
    var m = /^(\d+)\./.exec(String(l.number || ''));
    return m ? parseInt(m[1], 10) : 0;
  }
  function nextNumber(topic, exceptId) {
    var max = 0;
    lessons.forEach(function (l) {
      if (exceptId && l.id === exceptId) return;
      var m = /^(\d+)\.(\d+)$/.exec(String(l.number || '').trim());
      if (m && parseInt(m[1], 10) === topic) max = Math.max(max, parseInt(m[2], 10));
    });
    return topic + '.' + (max + 1);
  }

  function fillTopicSelect() {
    var sel = $('f-syllabus-topic');
    var keep = sel.value;
    sel.innerHTML = '<option value="">Choose a topic…</option>' + allTopics().map(function (t) {
      return '<option value="' + t.number + '">' + t.number + ' · ' + esc(t.name) + '</option>';
    }).join('');
    sel.value = keep;
    fillSubtopics();
  }
  function fillSubtopics() {
    var t = topicOf($('f-syllabus-topic').value);
    $('subtopic-list').innerHTML = (t ? t.subtopics || [] : []).map(function (s) {
      return '<option value="' + esc(s.name) + '"></option>';
    }).join('');
  }
  $('f-syllabus-topic').addEventListener('change', function () {
    fillSubtopics();
    var t = parseInt($('f-syllabus-topic').value, 10);
    // A new lesson (or one without a number yet) takes the next free number in the chosen topic.
    if (t && (!$('f-id').value || !$('f-number').value.trim())) $('f-number').value = nextNumber(t, $('f-id').value);
    updateMeta();
  });

  // ---------- auth
  sb.auth.onAuthStateChange(function (_e, session) { route(session); });
  sb.auth.getSession().then(function (r) { route(r.data.session); });

  function route(session) {
    show('signin', !session);
    show('editor', !!session);
    if (session) {
      $('whoami').textContent = 'Signed in as ' + session.user.email;
      syllabusReady.then(loadOwnTopics).then(function () { loadLessons('first'); });
    }
  }

  $('signin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value })
      .then(function (r) {
        if (r.error) status('signin-status', r.error.message, false);
        $('password').value = '';
      });
  });
  $('signout').addEventListener('click', function () { sb.auth.signOut(); });

  // ---------- lessons list
  // select: 'first' leaves the page on the chat (nothing opened); 'keep' re-opens the current lesson after a save; 'new' clears everything.
  function loadLessons(select) {
    return sb.from('lessons').select('*, questions(*)').order('number', { ascending: true })
      .then(function (r) {
        if (r.error) { status('ai-status', 'Could not load lessons: ' + r.error.message, false); return; }
        lessons = r.data || [];
        lessons.forEach(function (l) { l.questions = (l.questions || []).sort(function (a, b) { return a.position - b.position; }); });
        lessons.sort(function (a, b) { return numKey(a.number) - numKey(b.number); });
        if (select === 'new') { newLesson(true); return; }
        if (select === 'keep' && current && current.id) {
          var l = lessons.filter(function (x) { return x.id === current.id; })[0];
          if (l) { edit(l, true); return; }
        }
        if (!current) clearForm();
        renderTree();
      });
  }

  var openTopics = null; // which branches are expanded; remembered across re-renders
  function renderTree() {
    var tree = $('tree');
    if (openTopics === null) {
      openTopics = {};
      lessons.forEach(function (l) { openTopics[lessonTopic(l)] = true; });
    } else {
      tree.querySelectorAll('details.branch').forEach(function (d) { openTopics[d.getAttribute('data-topic')] = d.open; });
    }
    if (activeTopic) openTopics[activeTopic] = true;

    var taken = {}; ownTopics.forEach(function (x) { taken[x.number] = true; });
    var menu = syllabus.filter(function (x) { return !taken[x.number]; }).map(function (x) { return '<option value="' + x.number + '">Topic ' + x.number + ' · ' + esc(x.name) + ' (syllabus)</option>'; }).join('') + '<option value="own">My own topic (not in the syllabus)</option>';
    tree.innerHTML = (allTopics().length ? '' : '<div class="branch empty-state"><div class="branch-body" style="padding-left:16px"><strong>No topics yet.</strong><p class="branch-hint">Start with step 1: add your first topic below.</p></div></div>') + allTopics().map(function (g) {
      var inTopic = lessons.filter(function (l) { return lessonTopic(l) === g.number; }).sort(function (a, b) { return numKey(a.number) - numKey(b.number); });
      var forms = (g.subtopics || []).map(function (s) { return s.name; }).join(', ');
      var rows = inTopic.map(function (l) {
        var n = l.questions.length;
        return '<div class="sub' + (current && current.id === l.id ? ' active' : '') + '"><span class="n">' + esc(l.number) + '</span>' +
          '<span class="ttl">' + esc(l.title) + '</span>' + statusPill(l.status) +
          '<span class="meta">' + n + ' question' + (n === 1 ? '' : 's') + '</span>' +
          '<a href="#" class="open" data-id="' + esc(l.id) + '">Open</a></div>';
      }).join('');
      return '<details class="branch' + (inTopic.length ? '' : ' empty') + '" data-topic="' + g.number + '"' + (openTopics[g.number] ? ' open' : '') + '>' +
        '<summary><span class="t-num">' + g.number + '</span><span class="t-name">Topic ' + g.number + ' · ' + esc(g.name) + (g.own ? ' <span class="pill pill-amber">your own topic</span>' : ' <span class="pill">syllabus</span>') + (forms ? '<small>' + esc(forms) + '</small>' : (g.description ? '<small>' + esc(g.description) + '</small>' : '')) + '</span>' +
        '<span class="t-count">' + (inTopic.length ? inTopic.length + ' subtopic' + (inTopic.length === 1 ? '' : 's') : 'no subtopics yet') + '</span></summary>' +
        '<div class="branch-body">' + (rows || '<p class="branch-hint">Nothing posted in this topic yet.' + ' <button class="linkish" type="button" data-remove-topic="' + g.number + '">Remove this topic</button>' + '</p>') +
        '<div class="add-sub"><button class="btn btn-primary btn-sm" type="button" data-add="' + g.number + '">+ Add a subtopic (' + nextNumber(g.number) + ')</button></div>' +
        '<div class="slot" data-slot="' + g.number + '"></div></div></details>';
    }).join('') +
      '<div class="branch add-topic"><div class="branch-body" style="padding-left:16px"><strong>Step 1 · Add a topic</strong><p class="branch-hint">Pick a syllabus topic (it keeps its syllabus number) or name your own (it gets number ' + nextTopicNumber() + ').</p>' +
      '<div class="with-btn"><select id="new-topic-pick" style="font:inherit;padding:9px 12px;border:1px solid var(--line);border-radius:10px;flex:1">' + menu + '</select><input type="text" id="new-topic-name" placeholder="Name of your own topic" class="hidden" style="font:inherit;padding:9px 12px;border:1px solid var(--line);border-radius:10px;flex:1"><button class="btn btn-primary btn-sm" type="button" id="add-topic">Add topic</button></div><div class="status" id="topic-status"></div></div></div>';

    $('add-topic').addEventListener('click', addOwnTopic);
    $('new-topic-pick').addEventListener('change', function () { show('new-topic-name', $('new-topic-pick').value === 'own'); if ($('new-topic-pick').value === 'own') $('new-topic-name').focus(); });
    show('new-topic-name', $('new-topic-pick').value === 'own');
    $('new-topic-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addOwnTopic(); } });
    renderSteps();

    tree.querySelectorAll('a.open').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var l = lessons.filter(function (x) { return x.id === a.getAttribute('data-id'); })[0];
        if (l) edit(l);
      });
    });
    tree.querySelectorAll('[data-remove-topic]').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = parseInt(b.getAttribute('data-remove-topic'), 10);
        if (lessons.some(function (l) { return lessonTopic(l) === n; })) return;
        if (!confirm('Remove topic ' + n + '? It has no subtopics.')) return;
        sb.from('topics').delete().eq('number', n).then(function (r) {
          if (r.error) { alert('Could not remove it: ' + r.error.message); return; }
          if (activeTopic === n) activeTopic = 0;
          loadOwnTopics().then(renderTree);
        });
      });
    });
    tree.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function () { openTopic(parseInt(b.getAttribute('data-add'), 10), null); });
    });
    mountPanel();
  }
  // The three steps, with the one Jephias is on highlighted.
  function renderSteps() {
    var el = $('steps'); if (!el) return;
    var step = !ownTopics.length ? 1 : !lessons.length ? 2 : (current && current.id ? 3 : (draftReady ? 3 : 2));
    var items = [['Add a topic', 'Pick one from the syllabus or name your own.'], ['Add a subtopic', 'Open the topic, paste your video link, tell the assistant what it covers.'], ['Check and post', 'Read the draft, check the answers, press Post as Live.']];
    if ($('cv-step')) $('cv-step').textContent = 'Step ' + Math.max(2, step) + ' · ' + items[Math.max(2, step) - 1][0];
    el.innerHTML = items.map(function (s, i) {
      var n = i + 1, cls = n < step ? 'done' : n === step ? 'now' : '';
      return '<div class="sstep ' + cls + '"><span class="s-num">' + (n < step ? '✓' : n) + '</span><div><strong>' + s[0] + '</strong><span>' + s[1] + '</span></div></div>';
    }).join('');
  }
  function nextTopicNumber() {
    var max = 14;
    ownTopics.forEach(function (t) { if (t.number > max) max = t.number; });
    lessons.forEach(function (l) { var n = lessonTopic(l); if (n > max) max = n; });
    return max + 1;
  }
  function loadOwnTopics() {
    return sb.from('topics').select('*').order('number', { ascending: true }).then(function (r) {
      if (r.error) { console.warn('topics table not available:', r.error.message); return; }
      ownTopics = (r.data || []).map(function (t) {
        var syl = syllabus.filter(function (x) { return x.number === t.number; })[0];
        return { number: t.number, name: t.name, description: t.description || '', subtopics: syl ? syl.subtopics : [], own: !syl };
      });
      fillTopicSelect();
    });
  }
  function addOwnTopic() {
    var pick = $('new-topic-pick').value, name, n;
    if (pick === 'own') {
      name = $('new-topic-name').value.trim();
      if (!name) { status('topic-status', 'Give the topic a name first.', false); return; }
      // A name that is really a syllabus topic keeps its syllabus number (Trigonometry is Topic 10, not a new one).
      var same = syllabus.filter(function (x) { return x.name.toLowerCase().replace(/[^a-z]/g, '') === name.toLowerCase().replace(/[^a-z]/g, ''); })[0];
      if (same && ownTopics.some(function (x) { return x.number === same.number; })) { status('topic-status', 'Topic ' + same.number + ' · ' + same.name + ' is already in your list.', false); return; }
      if (same) { n = same.number; name = same.name; } else { n = nextTopicNumber(); }
    } else {
      n = parseInt(pick, 10);
      var syl = syllabus.filter(function (x) { return x.number === n; })[0];
      if (!syl) { status('topic-status', 'Choose a topic first.', false); return; }
      name = syl.name;
    }
    sb.from('topics').insert({ number: n, name: name }).then(function (r) {
      if (r.error) { status('topic-status', 'Could not add the topic: ' + r.error.message, false); return; }
      return loadOwnTopics().then(function () { openTopics[n] = true; renderTree(); openTopic(n, null); });
    });
  }
  // Put the post panel inside the active branch (or hide it).
  // One view at a time: the topics tree, or the chat for the topic being worked on.
  function mountPanel() {
    var inChat = !!activeTopic;
    panelEl.classList.toggle('hidden', !inChat);
    $('topics-view').classList.toggle('hidden', inChat);
    document.querySelector('.hero').classList.toggle('hidden', inChat);
  }
  function scrollChatToEnd() {
    if (!activeTopic) return;
    window.requestAnimationFrame(function () { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); });
  }
  // Open a branch for posting: a new subtopic (lesson null) or an existing one.
  function openTopic(n, lesson) {
    activeTopic = n;
    var topic = topicOf(n);
    $('panel-topic').textContent = 'Topic ' + n + ' · ' + (topic ? topic.name : '');
    if (lesson) {
      $('panel-title').textContent = 'Subtopic ' + lesson.number + ': ' + lesson.title;
    } else {
      current = null; draftReady = false;
      fillForm({ status: 'draft', level: 'Form 3', syllabus_topic: n, number: nextNumber(n), questions: [] });
      $('f-syllabus-topic').value = String(n); fillSubtopics();
      show('lesson-form', false); show('draft-card', false);
      $('panel-title').textContent = 'New subtopic ' + nextNumber(n);
      greet(n);
    }
    renderTree();
    window.scrollTo({ top: 0 });
    if (!lesson) $('chat-input').focus();
  }
  $('panel-close').addEventListener('click', function () { activeTopic = 0; current = null; draftReady = false; renderTree(); });
  function statusPill(s) {
    var cls = { live: 'pill-green', planned: 'pill-grey', draft: 'pill-amber' }[s] || 'pill-grey';
    var label = { live: 'Live', planned: 'Planned', draft: 'Draft' }[s] || s;
    return '<span class="pill ' + cls + '">' + esc(label) + '</span>';
  }

  // ---------- form (hidden by default; the single source of truth for what is saved)
  // Lesson fields that the form edits, keyed by column name. topic and chapter are derived from syllabus_topic on save.
  var FIELDS = {
    number: 'f-number', status: 'f-status', level: 'f-level', title: 'f-title', slug: 'f-slug', duration: 'f-duration',
    syllabus_topic: 'f-syllabus-topic', syllabus_form: 'f-syllabus-form', syllabus_subtopic: 'f-syllabus-subtopic',
    syllabus_objective: 'f-syllabus-objective', textbook_ref: 'f-textbook-ref',
    hook: 'f-hook', summary: 'f-summary', outcomes: 'f-outcomes', skills: 'f-skills', theorem: 'f-theorem',
    explanation: 'f-explanation', figure: 'f-figure'
  };

  function fillForm(l) {
    $('f-id').value = l.id || '';
    Object.keys(FIELDS).forEach(function (k) { $(FIELDS[k]).value = l[k] == null ? '' : l[k]; });
    var t = lessonTopic(l);
    $('f-syllabus-topic').value = t ? String(t) : '';
    fillSubtopics();
    $('f-video').value = l.video_id ? 'https://youtu.be/' + l.video_id : '';
    $('questions').innerHTML = '';
    (l.questions || []).forEach(function (q) { addQuestion(q); });
    $('form-state').textContent = l.id ? 'Editing lesson ' + (l.number || '') : (l.title ? 'New draft' : 'New lesson');
    $('form-state').className = 'pill ' + (l.id ? '' : 'pill-grey');
    lockNumber(true);
    updateMeta();
  }

  // Open a lesson: fill the (hidden) form and show its preview card.
  function edit(l, quiet) {
    current = l;
    fillForm(l);
    draftReady = !!l.title;
    show('lesson-form', false);
    renderPreview();
    renderSteps();
    activeTopic = lessonTopic(l) || activeTopic;
    var tp = topicOf(activeTopic);
    $('panel-topic').textContent = 'Topic ' + activeTopic + ' · ' + (tp ? tp.name : '');
    $('panel-title').textContent = (l.id ? 'Subtopic ' : 'New subtopic ') + (l.number || '') + (l.title ? ': ' + l.title : '');
    renderTree();
    if (!quiet) window.scrollTo({ top: $('draft-card').offsetTop - 130, behavior: 'smooth' });
  }

  function clearForm() {
    current = null;
    draftReady = false;
    fillForm({ status: 'draft', level: 'Form 3', questions: [] });
    show('lesson-form', false);
    show('draft-card', false);
    renderTree();
  }
  function newLesson() { activeTopic = 0; clearForm(); }

  $('f-title').addEventListener('blur', function () {
    if (!$('f-slug').value) $('f-slug').value = slugify($('f-title').value);
    updateMeta();
  });

  // The lesson number is set by the syllabus topic; "Edit" unlocks it for the rare renumbering.
  function lockNumber(on) {
    $('f-number').readOnly = on;
    $('number-unlock').textContent = on ? 'Edit' : 'Lock';
    $('number-unlock').setAttribute('aria-pressed', on ? 'false' : 'true');
  }
  $('number-unlock').addEventListener('click', function () {
    var unlocked = !$('f-number').readOnly;
    lockNumber(unlocked);
    if (!unlocked) $('f-number').focus();
  });

  // One-line summaries on the collapsed sections of the form.
  function updateMeta() {
    var t = parseInt($('f-syllabus-topic').value, 10);
    var st = $('f-status').options[$('f-status').selectedIndex];
    $('meta-basics').textContent = [$('f-number').value, $('f-title').value, st ? st.text.replace(/\s*\(.*\)$/, '') : ''].filter(Boolean).join(' · ');
    $('meta-syllabus').textContent = [t ? 'Topic ' + t + ' ' + topicName(t) : 'no topic yet', $('f-syllabus-form').value, $('f-syllabus-subtopic').value].filter(Boolean).join(' · ');
    var words = $('f-explanation').value.trim() ? $('f-explanation').value.trim().split(/\s+/).length : 0;
    $('meta-content').textContent = words ? 'explanation ' + words + ' words' + ($('f-figure').value ? ' · diagram' : '') : 'empty';
    var n = $('questions').querySelectorAll('.q').length;
    var checks = 0;
    $('questions').querySelectorAll('select[data-f="kind"]').forEach(function (s) { if (s.value === 'video_check') checks++; });
    $('meta-questions').textContent = n ? n + ' question' + (n === 1 ? '' : 's') + (checks ? '' : ' · no video check') : 'none yet';
  }
  ['f-number', 'f-title', 'f-status', 'f-syllabus-form', 'f-syllabus-subtopic', 'f-explanation', 'f-figure'].forEach(function (id) {
    $(id).addEventListener('input', updateMeta);
    $(id).addEventListener('change', updateMeta);
  });

  $('toggle-form').addEventListener('click', function () {
    var open = $('lesson-form').classList.contains('hidden');
    show('lesson-form', open);
    if (open) window.scrollTo({ top: $('lesson-form').offsetTop - 130, behavior: 'smooth' });
  });
  $('close-form').addEventListener('click', function () {
    show('lesson-form', false);
    renderPreview();
    window.scrollTo({ top: $('draft-card').offsetTop - 130, behavior: 'smooth' });
  });

  // ---------- questions (inside the hidden form)
  function addQuestion(q) {
    q = q || {};
    var node = $('q-template').content.firstElementChild.cloneNode(true);
    var isFirst = $('questions').querySelectorAll('.q').length === 0;
    if (q.kind == null) q.kind = isFirst ? 'video_check' : 'calculation';
    node.querySelectorAll('[data-f]').forEach(function (el) {
      var k = el.getAttribute('data-f');
      if (q[k] != null) el.value = q[k];
    });
    node.querySelector('[data-act="remove"]').addEventListener('click', function () { node.remove(); renumber(); });
    node.querySelector('[data-act="up"]').addEventListener('click', function () {
      if (node.previousElementSibling) node.parentNode.insertBefore(node, node.previousElementSibling); renumber();
    });
    node.querySelector('[data-act="down"]').addEventListener('click', function () {
      if (node.nextElementSibling) node.parentNode.insertBefore(node.nextElementSibling, node); renumber();
    });
    node.querySelector('select[data-f="kind"]').addEventListener('change', updateMeta);
    var file = node.querySelector('[data-upload-q]');
    file.addEventListener('change', function () { upload(file.files[0], node.querySelector('[data-f="figure"]')); });
    $('questions').appendChild(node);
    renumber();
  }
  function renumber() {
    $('questions').querySelectorAll('.q').forEach(function (n, i) { n.querySelector('.q-n').textContent = i + 1; });
    updateMeta();
  }
  $('add-question').addEventListener('click', function () { addQuestion(); });

  function readQuestions() {
    return Array.prototype.map.call($('questions').querySelectorAll('.q'), function (n, i) {
      var q = { position: i + 1 };
      n.querySelectorAll('[data-f]').forEach(function (el) { q[el.getAttribute('data-f')] = el.value; });
      q.kind = q.kind === 'video_check' ? 'video_check' : 'calculation';
      q.answer = parseFloat(q.answer);
      q.tolerance = parseFloat(q.tolerance || '0.01');
      return q;
    });
  }

  // ---------- uploads
  function upload(file, target) {
    if (!file) return;
    var name = Date.now() + '-' + slugify(file.name.replace(/\.[^.]+$/, '')) + '.' + (file.name.split('.').pop() || 'png').toLowerCase();
    status('save-status', 'Uploading ' + file.name + '…', true);
    sb.storage.from('figures').upload(name, file, { upsert: false }).then(function (r) {
      if (r.error) { status('save-status', 'Upload failed: ' + r.error.message, false); return; }
      target.value = sb.storage.from('figures').getPublicUrl(name).data.publicUrl;
      status('save-status', 'Uploaded.', true);
      updateMeta();
    });
  }
  document.querySelector('[data-upload-for="f-figure"]').addEventListener('change', function (e) {
    upload(e.target.files[0], $('f-figure'));
  });

  // ---------- read the form back into a lesson object
  function collect() {
    var row = {};
    Object.keys(FIELDS).forEach(function (k) { row[k] = $(FIELDS[k]).value.trim(); });
    row.slug = slugify(row.slug || row.title);
    row.video_id = videoId($('f-video').value);
    var t = parseInt(row.syllabus_topic, 10);
    if (!(t >= 1)) { var m = /^(\d+)\./.exec(row.number); t = m ? parseInt(m[1], 10) : 0; }
    row.syllabus_topic = t >= 1 ? t : null;
    row.topic = row.syllabus_topic ? topicName(row.syllabus_topic) : '';
    row.chapter = row.syllabus_topic ? chapterOf(row.syllabus_topic) : '';
    row.questions = readQuestions();
    return row;
  }

  // ---------- draft preview card (what Jephias sees instead of the form)
  function renderPreview() {
    var l = collect();
    var id = $('f-id').value;
    if (!l.title) { show('draft-card', false); return; }
    show('draft-card', true);
    $('d-eyebrow').textContent = id ? 'Lesson ' + (l.number || '') : 'Draft preview · lesson ' + (l.number || '');
    $('d-title').textContent = l.title;
    var line = [l.syllabus_topic ? chapterOf(l.syllabus_topic) : 'no syllabus topic yet', l.syllabus_form || l.level, l.syllabus_subtopic, l.duration ? l.duration + ' video' : ''].filter(Boolean).join(' · ');
    $('d-line').textContent = line;
    $('d-status').innerHTML = statusPill(id ? l.status : 'draft') + (id ? '' : ' <span class="pill pill-grey">not saved yet</span>');
    $('d-thumb').innerHTML = l.video_id ? '<img src="https://i.ytimg.com/vi/' + esc(l.video_id) + '/hqdefault.jpg" alt="">' : '<span>no video yet</span>';
    $('d-summary').textContent = l.summary || l.hook || '';
    $('d-qs').innerHTML = l.questions.map(function (q) {
      var ans = isNaN(q.answer) ? '(no answer yet)' : q.answer + (q.unit ? ' ' + q.unit : '');
      return '<li>' + esc(q.prompt || '(empty question)') + (q.kind === 'video_check' ? '<span class="pill">From the video</span>' : '') +
        '<span class="ans">Answer: ' + esc(ans) + '</span></li>';
    }).join('') || '<li class="help" style="list-style:none;margin-left:-22px">No questions yet. Ask the assistant to add some.</li>';
    show('delete-lesson', !!id);
    show('view-lesson', !!(id && l.slug));
    $('view-lesson').href = lessonUrl(l.slug);
    $('draft-status').classList.remove('show');
  }

  // ---------- save (one path for the preview buttons, the form and "post it" in the chat)
  function save(statusOverride, where) {
    where = where || 'draft-status';
    if (statusOverride) $('f-status').value = statusOverride;
    var row = collect();
    var qs = row.questions; delete row.questions;
    var fail = function (msg, sec) { status(where, msg, false); if (sec) { show('lesson-form', true); $(sec).open = true; } return Promise.reject(new Error(msg)); };
    if (!row.title) return fail('A title is needed.', 'sec-basics');
    if (!row.syllabus_topic) return fail('Choose the syllabus topic the lesson belongs to.', 'sec-syllabus');
    if (!row.number) row.number = nextNumber(row.syllabus_topic, $('f-id').value);
    if (!/^\d+\.\d+$/.test(row.number)) return fail('The lesson number should look like 10.2 (topic, dot, position).', 'sec-basics');
    if ($('f-video').value.trim() && !row.video_id) return fail('That does not look like a YouTube link.', 'sec-basics');
    for (var i = 0; i < qs.length; i++) {
      if (!qs[i].prompt.trim() || isNaN(qs[i].answer)) return fail('Question ' + (i + 1) + ' needs a prompt and a numeric answer.', 'sec-questions');
    }
    if ($('f-id').value) row.id = $('f-id').value;
    $(where).textContent = 'Saving…'; $(where).className = 'status show ok';

    return sb.from('lessons').upsert(row, { onConflict: 'slug' }).select('id, slug').single()
      .then(function (r) {
        if (r.error) throw r.error;
        var id = r.data.id;
        return sb.from('questions').delete().eq('lesson_id', id).then(function (d) {
          if (d.error) throw d.error;
          if (!qs.length) return { data: [] };
          return sb.from('questions').insert(qs.map(function (q) { q.lesson_id = id; return q; }));
        }).then(function (ins) {
          if (ins.error) throw ins.error;
          current = { id: id, slug: r.data.slug };
          return loadLessons('keep');
        }).then(function () {
          var el = $(where);
          el.innerHTML = (row.status === 'live' ? 'Posted. The lesson is live: ' : 'Saved as ' + esc(row.status) + ': ') +
            '<a href="' + lessonUrl(r.data.slug) + '" target="_blank" rel="noopener">view ' + esc(row.number) + ' ' + esc(row.title) + '</a>.';
          el.classList.add('show', 'ok'); el.classList.remove('no');
          return { id: id, slug: r.data.slug, status: row.status, number: row.number, title: row.title };
        });
      })
      .catch(function (err) { status(where, 'Save failed: ' + (err.message || err), false); throw err; });
  }
  var swallow = function () {};
  $('post-live').addEventListener('click', function () { save('live').catch(swallow); });
  $('save-draft').addEventListener('click', function () { save('draft').catch(swallow); });
  $('ask-change').addEventListener('click', function () {
    scrollChatToEnd();
    $('chat-input').focus();
  });
  $('lesson-form').addEventListener('submit', function (e) {
    e.preventDefault();
    save(null, 'save-status').then(function () { show('lesson-form', false); renderPreview(); $('draft-status').innerHTML = $('save-status').innerHTML; $('draft-status').className = 'status show ok'; }).catch(swallow);
  });

  $('delete-lesson').addEventListener('click', function () {
    if (!current || !current.id) return;
    if (!confirm('Delete "' + ($('f-title').value || 'this lesson') + '" and its questions? This cannot be undone.')) return;
    sb.from('lessons').delete().eq('id', current.id).then(function (r) {
      if (r.error) { status('draft-status', 'Delete failed: ' + r.error.message, false); return; }
      current = null;
      activeTopic = 0;
      loadLessons('new');
    });
  });

  // ---------- chat with the assistant (generate-lesson Edge Function)
  var chat = [];
  function addMsg(role, text, html) {
    var d = document.createElement('div'); d.className = 'msg ' + role;
    if (role === 'sys' && /…$/.test(text || '')) d.className += ' thinking';
    var b = document.createElement('div'); b.className = 'bubble';
    if (html) b.innerHTML = html; else b.textContent = text;
    if (role === 'bot') { var a = document.createElement('span'); a.className = 'avatar'; a.innerHTML = '<img src="assets/img/logo.webp" alt="">'; d.appendChild(a); }
    d.appendChild(b);
    $('chat-log').appendChild(d); scrollChatToEnd(); return d;
  }
  // The box grows with the message, like a chat app.
  function growInput() {
    var box = $('chat-input'); box.style.height = 'auto'; box.style.height = Math.min(220, box.scrollHeight) + 'px';
  }
  $('chat-input').addEventListener('input', growInput);
  function greet(n) {
    $('chat-log').innerHTML = ''; chat = [];
    var tp = topicOf(n || activeTopic);
    addMsg('bot', (tp ? 'Topic ' + tp.number + ' · ' + tp.name + '. This will be subtopic ' + nextNumber(tp.number) + '. ' : '') + 'Paste the YouTube link and tell me what the video covers. I will ask if I need anything else, then show you a draft to check. When it looks right, press Post as Live or just say "post it".');
  }
  function applyDraft(lesson) {
    if (activeTopic) { lesson.syllabus_topic = activeTopic; if (!String(lesson.number || '').startsWith(activeTopic + '.')) lesson.number = current && current.id ? current.number : nextNumber(activeTopic); }
    var existing = lessons.filter(function (l) { return l.slug === lesson.slug; })[0];
    lesson.id = existing ? existing.id : ($('f-slug').value === lesson.slug ? $('f-id').value : '');
    lesson.figure = $('f-slug').value === lesson.slug ? ($('f-figure').value || '') : '';
    if (!lesson.status) lesson.status = 'draft';
    lesson.questions = (lesson.questions || []).map(function (q, i) {
      q.position = i + 1; q.figure = q.figure || ''; q.kind = q.kind === 'video_check' ? 'video_check' : 'calculation'; return q;
    });
    edit(lesson, true);
    addMsg('sys', 'Draft below. Check the answers, then Post as Live, Save as draft, or ask for a change.');
    window.requestAnimationFrame(function () { window.scrollTo({ top: $('draft-card').offsetTop - 130, behavior: 'smooth' }); });
  }
  var POST_RE = /^(please\s+)?(post|publish|go\s+live|make\s+it\s+live|put\s+it\s+(up|live|online))(\s+(it|this|that|the\s+lesson|now))?(\s+(as\s+)?live)?(\s+now)?[.!\s]*$/i;
  // Turn an .srt / .sbv / .vtt caption file (or pasted transcript) into plain words.
  function plainTranscript(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n'), out = [], last = '';
    lines.forEach(function (ln) {
      var s = ln.trim();
      if (!s || /^WEBVTT/i.test(s) || /^(Kind|Language):/i.test(s) || /^NOTE\b/.test(s)) return;
      if (/^\d+$/.test(s)) return;                                           // srt index
      if (/\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->/.test(s)) return;         // srt / vtt timing
      if (/^\d{1,2}:\d{2}(:\d{2})?[.,]\d{3},\d{1,2}:\d{2}/.test(s)) return;  // sbv timing
      s = s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim();
      if (!s || s === last) return;                                           // auto captions repeat lines
      out.push(s); last = s;
    });
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }
  function scriptState(note) {
    var words = $('ai-script').value.trim() ? $('ai-script').value.trim().split(/\s+/).length : 0;
    $('ai-script-state').textContent = words ? 'Attached' + (note ? ' (' + note + ')' : '') + ': ' + words + ' words, sent with every message' : 'Not attached';
    $('ai-script-state').style.color = words ? 'var(--ok)' : '';
  }
  $('ai-script-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { $('ai-script').value = plainTranscript(rd.result); scriptState(f.name); };
    rd.readAsText(f);
    this.value = '';
  });
  $('ai-script').addEventListener('input', function () { scriptState(''); });
  $('script-help-toggle').addEventListener('click', function () { var open = $('script-help').classList.contains('hidden'); show('script-help', open); if (open) $('ai-script').focus(); });

  function send() {
    var text = $('chat-input').value.trim();
    if (!text) return;
    $('chat-input').value = ''; growInput();
    addMsg('me', text);
    chat.push({ role: 'user', content: text });

    // "post it" is handled here, without the assistant: the draft in the form goes live.
    if (POST_RE.test(text)) {
      if (!draftReady || !$('f-title').value.trim()) {
        var r0 = 'There is no draft to post yet. Tell me about the video first, or pick a lesson from the list.';
        addMsg('bot', r0); chat.push({ role: 'assistant', content: r0 }); return;
      }
      var waiting0 = addMsg('sys', 'Posting…');
      save('live', 'draft-status').then(function (s) {
        waiting0.remove();
        var r1 = 'Posted. Lesson ' + s.number + ' "' + s.title + '" is live.';
        addMsg('bot', '', esc(r1) + ' <a href="' + lessonUrl(s.slug) + '" target="_blank" rel="noopener">View it on the site</a>.');
        chat.push({ role: 'assistant', content: r1 });
      }).catch(function (err) {
        waiting0.remove();
        var r2 = 'I could not post it: ' + ((err && err.message) || err) + ' Fix that and say "post it" again.';
        addMsg('bot', r2); chat.push({ role: 'assistant', content: r2 });
      });
      return;
    }

    var draft = $('f-title').value.trim() ? collect() : null;
    var payload = {
      messages: chat, draft: draft, script: plainTranscript($('ai-script').value).slice(0, 24000), topic_number: activeTopic || null, topic_name: activeTopic ? topicName(activeTopic) : null,
      existing: lessons.map(function (l) {
        return { number: l.number, title: l.title, chapter: l.chapter || chapterOf(lessonTopic(l)), syllabus_topic: lessonTopic(l) || null, slug: l.slug };
      })
    };
    $('chat-send').disabled = true;
    var waiting = addMsg('sys', 'Thinking… a full draft takes about a minute.');
    sb.functions.invoke('generate-lesson', { body: payload })
      .then(function (r) {
        if (r.error) {
          var p = r.error.context && r.error.context.json ? r.error.context.json() : Promise.resolve(null);
          return p.then(function (jj) { throw new Error((jj && jj.error) || r.error.message || 'Request failed'); }, function () { throw new Error(r.error.message || 'Request failed'); });
        }
        if (r.data && r.data.error) throw new Error(r.data.error);
        waiting.remove();
        addMsg('bot', r.data.reply);
        chat.push({ role: 'assistant', content: r.data.reply + (r.data.lesson ? '\n[Draft "' + r.data.lesson.title + '" with ' + r.data.lesson.questions.length + ' questions shown to the author]' : '') });
        if (r.data.lesson) applyDraft(r.data.lesson);
      })
      .catch(function (err) { waiting.remove(); addMsg('sys', 'Something went wrong: ' + ((err && err.message) || err)); chat.pop(); })
      .then(function () { $('chat-send').disabled = false; $('chat-input').focus(); });
  }
  $('chat-send').addEventListener('click', send);
  $('chat-input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('chat-reset').addEventListener('click', function () {
    $('ai-script').value = ''; scriptState(''); greet(activeTopic); $('chat-input').focus(); });
  $('chips').querySelectorAll('[data-say]').forEach(function (c) {
    c.addEventListener('click', function () {
      var box = $('chat-input'), say = c.getAttribute('data-say');
      box.value = box.value.trim() ? box.value.replace(/\s*$/, ' ') + say : say;
      box.focus();
      box.selectionStart = box.selectionEnd = box.value.length;
    });
  });
})();
