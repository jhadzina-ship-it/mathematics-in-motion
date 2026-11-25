/* Mathematics in Motion - data layer.
 * Reads lessons from Supabase when assets/config.js is filled in,
 * otherwise from the bundled content/lessons.js snapshot.
 * Exposes window.MIM: loadLessons() -> Promise<lesson[]>, progress helpers, the public assistant call, and rendering helpers. */
(function () {
  var cfg = window.MIM_CONFIG || {};
  var connected = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

  function fromSupabase() {
    var url = cfg.supabaseUrl.replace(/\/$/, '') +
      '/rest/v1/lessons?select=*,questions(*)&order=number.asc&questions.order=position.asc';
    return fetch(url, {
      headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey }
    }).then(function (r) {
      if (!r.ok) throw new Error('Supabase ' + r.status);
      return r.json();
    });
  }

  function bundled() {
    return Promise.resolve((window.MIM_LESSONS || []).map(function (l) {
      return JSON.parse(JSON.stringify(l));
    }));
  }

  function numKey(n) {
    var m = /^(\d+)\.(\d+)$/.exec(String(n || '').trim());
    return m ? parseInt(m[1], 10) * 1000 + parseInt(m[2], 10) : 999999;
  }

  var cache = null;
  function loadLessons() {
    if (cache) return cache;
    cache = (connected ? fromSupabase().catch(function (e) {
      console.warn('Falling back to bundled lessons:', e.message);
      return bundled();
    }) : bundled()).then(function (list) {
      list.forEach(function (l) {
        l.questions = (l.questions || []).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
        if (!l.syllabus_topic) { var m = /^(\d+)\./.exec(String(l.number || '')); l.syllabus_topic = m ? parseInt(m[1], 10) : 0; }
        if (!l.chapter) l.chapter = (l.syllabus_topic ? 'Topic ' + l.syllabus_topic + ' · ' : '') + (l.topic || '');
      });
      list.sort(function (a, b) { return numKey(a.number) - numKey(b.number); });
      return list;
    });
    return cache;
  }

  // ---- progress, per browser (a convenience, not an account)
  function loadProgress() { try { return JSON.parse(localStorage.getItem('mim-progress') || '{}'); } catch (e) { return {}; } }
  function saveProgress(p) { try { localStorage.setItem('mim-progress', JSON.stringify(p)); } catch (e) {} }
  function isDone(slug, item) { var p = loadProgress(); return !!(p[slug] && p[slug][item]); }
  function markDone(slug, item) { var p = loadProgress(); p[slug] = p[slug] || {}; p[slug][item] = true; saveProgress(p); }
  function lessonDone(l) { return (l.questions && l.questions.length) ? isDone(l.slug, 'practice') : isDone(l.slug, 'reading'); }
  // A lesson opens when it is live and the live lesson before it in the same topic is done.
  function previousLesson(l, all) {
    var same = all.filter(function (x) { return x.syllabus_topic === l.syllabus_topic && x.status === 'live' && numKey(x.number) < numKey(l.number); });
    return same.length ? same[same.length - 1] : null;
  }
  function isUnlocked(l, all) {
    if (l.status !== 'live') return false;
    var prev = previousLesson(l, all);
    return !prev || lessonDone(prev);
  }

  // ---- the public assistant (student-assist Edge Function). No account; rate-limited on the server.
  function assist(payload) {
    if (!connected) return Promise.reject(new Error('The assistant is not connected yet.'));
    return fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/student-assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || ('Request failed (' + r.status + ')')); return j; }); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }
  function lines(s) { return String(s || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function csv(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function hasVideo(l) { return /^[A-Za-z0-9_-]{11}$/.test(l.video_id || ''); }
  function thumb(l) { return hasVideo(l) ? 'https://i.ytimg.com/vi/' + l.video_id + '/hqdefault.jpg' : ''; }

  function statusPill(status) {
    var map = { live: 'pill-green', planned: 'pill-grey', draft: 'pill-amber' };
    var label = { live: 'Available now', planned: 'Coming soon', draft: 'Draft' }[status] || status;
    return '<span class="pill ' + (map[status] || 'pill-grey') + '">' + esc(label) + '</span>';
  }

  var MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="14" r="10" fill="none" stroke="currentColor" stroke-width="2.4"/><line x1="2" y1="24" x2="30" y2="24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="16" y1="24" x2="24" y2="8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  var THUMB_CIRCLE = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="44" r="30" fill="none" stroke="#0056d2" stroke-width="3"/><line x1="8" y1="74" x2="92" y2="74" stroke="#0056d2" stroke-width="3" stroke-linecap="round"/><line x1="50" y1="74" x2="76" y2="29" stroke="#f1b434" stroke-width="3" stroke-linecap="round"/><line x1="50" y1="74" x2="22" y2="31" stroke="#f1b434" stroke-width="3" stroke-linecap="round"/><line x1="22" y1="31" x2="76" y2="29" stroke="#f1b434" stroke-width="3" stroke-linecap="round"/></svg>';
  var THUMB_TRIG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M14 78 L86 78 L86 24 Z" fill="none" stroke="#0056d2" stroke-width="3" stroke-linejoin="round"/><path d="M78 78 L78 70 L86 70" fill="none" stroke="#0056d2" stroke-width="2.5"/><path d="M34 78 A20 20 0 0 0 30 66" fill="none" stroke="#f1b434" stroke-width="3"/></svg>';
  var LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  function lessonCard(l, all) {
    var live = l.status === 'live';
    var open = all ? isUnlocked(l, all) : live;
    var done = live && lessonDone(l);
    var href = 'lesson.html?id=' + encodeURIComponent(l.slug);
    var t = thumb(l);
    var art = t ? '<img src="' + esc(t) + '" alt="" loading="lazy">' : (/trig/i.test(l.topic || '') ? THUMB_TRIG : THUMB_CIRCLE);
    var meta = [l.syllabus_form || l.level, live && l.duration ? l.duration + ' video' : '', l.questions && l.questions.length ? l.questions.length + ' questions' : ''].filter(Boolean).map(esc).join(' · ');
    var state = done ? '<span class="pill pill-green">Completed</span>' : !live ? statusPill(l.status) : open ? '<span class="pill pill-green">Available now</span>' : '<span class="pill pill-grey">' + LOCK + ' Finish lesson ' + esc((previousLesson(l, all || []) || {}).number || '') + ' first</span>';
    return '<article class="course-card' + (live && open ? '' : ' coming') + '">' +
      '<div class="course-thumb">' + art + '</div>' +
      '<div class="course-body">' +
      '<div class="provider">' + MARK + ' Mathematics in Motion</div>' +
      '<h3>' + (live && open ? '<a href="' + href + '">' + esc(l.title) + '</a>' : esc(l.title)) + '</h3>' +
      '<p class="muted small" style="margin:0">' + esc(l.summary) + '</p>' +
      '<div class="course-meta"><span>Lesson ' + esc(l.number) + '</span><span>·</span><span>' + meta + '</span></div>' +
      '<div>' + state + '</div>' +
      '</div></article>';
  }

  window.MIM = { loadLessons: loadLessons, esc: esc, param: param, lines: lines, csv: csv, hasVideo: hasVideo, thumb: thumb,
    statusPill: statusPill, lessonCard: lessonCard, mark: MARK, connected: connected, numKey: numKey,
    isDone: isDone, markDone: markDone, lessonDone: lessonDone, isUnlocked: isUnlocked, previousLesson: previousLesson, assist: assist, config: cfg };
})();
