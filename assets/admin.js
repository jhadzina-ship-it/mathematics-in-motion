/* Mathematics in Motion - admin page. Uses supabase-js v2 (loaded from a CDN in admin.html). */
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
  var current = null;

  function status(id, msg, ok) {
    var el = $(id);
    el.textContent = msg;
    el.classList.add('show');
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('no', !ok);
    if (ok) setTimeout(function () { el.classList.remove('show'); }, 4000);
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

  // ---------- auth
  sb.auth.onAuthStateChange(function (_e, session) { route(session); });
  sb.auth.getSession().then(function (r) { route(r.data.session); });

  function route(session) {
    show('signin', !session);
    show('editor', !!session);
    if (session) {
      $('whoami').textContent = 'Signed in as ' + session.user.email;
      loadLessons();
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
  function loadLessons() {
    return sb.from('lessons').select('*, questions(*)').order('number', { ascending: true })
      .then(function (r) {
        if (r.error) { status('save-status', 'Could not load lessons: ' + r.error.message, false); return; }
        lessons = r.data;
        lessons.forEach(function (l) { l.questions.sort(function (a, b) { return a.position - b.position; }); });
        renderList();
        if (!current && lessons.length) edit(lessons[0]);
        else if (!current) newLesson();
      });
  }

  function renderList() {
    $('lesson-list').innerHTML = lessons.map(function (l) {
      return '<a href="#" data-id="' + l.id + '" class="' + (current && current.id === l.id ? 'active' : '') + '">' +
        '<strong>' + esc(l.number) + '</strong> ' + esc(l.title) +
        '<span class="small">' + esc(l.status) + ' · ' + l.questions.length + ' question' + (l.questions.length === 1 ? '' : 's') + '</span></a>';
    }).join('') || '<p class="small muted">No lessons yet.</p>';
    $('lesson-list').querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var l = lessons.filter(function (x) { return x.id === a.getAttribute('data-id'); })[0];
        if (l) edit(l);
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- form
  var FIELDS = { number: 'f-number', status: 'f-status', level: 'f-level', title: 'f-title', slug: 'f-slug', topic: 'f-topic',
    chapter: 'f-chapter', duration: 'f-duration', hook: 'f-hook', summary: 'f-summary', outcomes: 'f-outcomes', skills: 'f-skills', theorem: 'f-theorem',
    explanation: 'f-explanation', figure: 'f-figure', us_name: 'f-us-name', textbook_envision: 'f-tb-envision',
    textbook_bigideas: 'f-tb-bigideas', textbook_hmh: 'f-tb-hmh', standard: 'f-standard' };

  function edit(l) {
    current = l;
    $('f-id').value = l.id || '';
    Object.keys(FIELDS).forEach(function (k) { $(FIELDS[k]).value = l[k] == null ? '' : l[k]; });
    $('f-video').value = l.video_id ? 'https://youtu.be/' + l.video_id : '';
    $('f-tb-confirmed').checked = !!l.textbook_confirmed;
    $('questions').innerHTML = '';
    (l.questions || []).forEach(addQuestion);
    $('preview').href = 'lesson.html?id=' + encodeURIComponent(l.slug || '');
    $('delete-lesson').classList.toggle('hidden', !l.id);
    renderList();
    window.scrollTo({ top: $('editor').offsetTop - 70, behavior: 'smooth' });
  }

  function newLesson() {
    edit({ status: 'draft', level: 'Forms 3 and 4', questions: [] });
  }
  $('new-lesson').addEventListener('click', newLesson);

  $('f-title').addEventListener('blur', function () {
    if (!$('f-slug').value) $('f-slug').value = slugify($('f-title').value);
  });

  // ---------- questions
  function addQuestion(q) {
    q = q || {};
    var node = $('q-template').content.firstElementChild.cloneNode(true);
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
    var file = node.querySelector('[data-upload-q]');
    file.addEventListener('change', function () { upload(file.files[0], node.querySelector('[data-f="figure"]')); });
    $('questions').appendChild(node);
    renumber();
  }
  function renumber() {
    $('questions').querySelectorAll('.q').forEach(function (n, i) { n.querySelector('.q-n').textContent = i + 1; });
  }
  $('add-question').addEventListener('click', function () { addQuestion(); });

  function readQuestions() {
    return Array.prototype.map.call($('questions').querySelectorAll('.q'), function (n, i) {
      var q = { position: i + 1 };
      n.querySelectorAll('[data-f]').forEach(function (el) { q[el.getAttribute('data-f')] = el.value; });
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
    row.textbook_confirmed = $('f-tb-confirmed').checked;
    row.questions = readQuestions();
    return row;
  }

  // ---------- chat with the assistant (generate-lesson Edge Function)
  var chat = [];
  function addMsg(role, text) {
    var d = document.createElement('div'); d.className = 'msg ' + role; d.textContent = text;
    $('chat-log').appendChild(d); $('chat-log').scrollTop = 1e9; return d;
  }
  function greet() {
    $('chat-log').innerHTML = ''; chat = [];
    addMsg('bot', 'Hi Jephias. Tell me about the lesson you want to post and paste the YouTube link. I will ask if I need anything else, then put a draft in the form below for you to check.');
  }
  function applyDraft(lesson) {
    var existing = lessons.filter(function (l) { return l.slug === lesson.slug; })[0];
    lesson.id = existing ? existing.id : ($('f-slug').value === lesson.slug ? $('f-id').value : '');
    lesson.figure = $('f-slug').value === lesson.slug ? ($('f-figure').value || '') : '';
    lesson.textbook_confirmed = false;
    lesson.questions = (lesson.questions || []).map(function (q, i) { q.position = i + 1; q.figure = q.figure || ''; return q; });
    edit(lesson);
    status('ai-status', 'Draft is in the form. Check every answer, then Save lesson.', true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function send() {
    var text = $('chat-input').value.trim();
    if (!text) return;
    $('chat-input').value = '';
    addMsg('me', text);
    chat.push({ role: 'user', content: text });
    var draft = $('f-title').value.trim() ? collect() : null;
    var payload = { messages: chat, draft: draft, script: $('ai-script').value.trim(),
      existing: lessons.map(function (l) { return { number: l.number, title: l.title, chapter: l.chapter }; }) };
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
        chat.push({ role: 'assistant', content: r.data.reply + (r.data.lesson ? '
[Draft "' + r.data.lesson.title + '" with ' + r.data.lesson.questions.length + ' questions placed in the form]' : '') });
        if (r.data.lesson) applyDraft(r.data.lesson);
      })
      .catch(function (err) { waiting.remove(); addMsg('sys', 'Something went wrong: ' + ((err && err.message) || err)); chat.pop(); })
      .then(function () { $('chat-send').disabled = false; $('chat-input').focus(); });
  }
  $('chat-send').addEventListener('click', send);
  $('chat-input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('chat-reset').addEventListener('click', greet);
  greet();

  // ---------- save / delete
  $('lesson-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var row = collect();
    var qs = row.questions; delete row.questions;
    if (!row.title) { status('save-status', 'A title is needed.', false); return; }
    if ($('f-video').value.trim() && !row.video_id) { status('save-status', 'That does not look like a YouTube link.', false); return; }
    for (var i = 0; i < qs.length; i++) {
      if (!qs[i].prompt.trim() || isNaN(qs[i].answer)) { status('save-status', 'Question ' + (i + 1) + ' needs a prompt and a numeric answer.', false); return; }
    }
    if ($('f-id').value) row.id = $('f-id').value;

    sb.from('lessons').upsert(row, { onConflict: 'slug' }).select('id, slug').single()
      .then(function (r) {
        if (r.error) throw r.error;
        var id = r.data.id;
        return sb.from('questions').delete().eq('lesson_id', id).then(function (d) {
          if (d.error) throw d.error;
          if (!qs.length) return { data: [] };
          return sb.from('questions').insert(qs.map(function (q) { q.lesson_id = id; return q; }));
        }).then(function (ins) {
          if (ins.error) throw ins.error;
          status('save-status', 'Saved. ' + (row.status === 'live' ? 'The lesson is live.' : 'Status: ' + row.status + '.'), true);
          current = { id: id, slug: r.data.slug };
          return loadLessons();
        });
      })
      .catch(function (err) { status('save-status', 'Save failed: ' + (err.message || err), false); });
  });

  $('delete-lesson').addEventListener('click', function () {
    if (!current || !current.id) return;
    if (!confirm('Delete "' + ($('f-title').value || 'this lesson') + '" and its questions? This cannot be undone.')) return;
    sb.from('lessons').delete().eq('id', current.id).then(function (r) {
      if (r.error) { status('save-status', 'Delete failed: ' + r.error.message, false); return; }
      current = null;
      loadLessons();
    });
  });
})();
