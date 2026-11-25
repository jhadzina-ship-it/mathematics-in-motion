/* Mathematics in Motion - data layer.
 * Reads lessons from Supabase when assets/config.js is filled in,
 * otherwise from the bundled content/lessons.js snapshot.
 * Exposes window.MIM: loadLessons() -> Promise<lesson[]> plus rendering helpers. */
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

  var cache = null;
  function loadLessons() {
    if (cache) return cache;
    cache = (connected ? fromSupabase().catch(function (e) {
      console.warn('Falling back to bundled lessons:', e.message);
      return bundled();
    }) : bundled()).then(function (list) {
      list.forEach(function (l) {
        l.questions = (l.questions || []).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
      });
      return list;
    });
    return cache;
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

  function lines(s) {
    return String(s || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function csv(s) {
    return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function hasVideo(l) { return /^[A-Za-z0-9_-]{11}$/.test(l.video_id || ''); }
  function thumb(l) { return hasVideo(l) ? 'https://i.ytimg.com/vi/' + l.video_id + '/hqdefault.jpg' : ''; }

  function statusPill(status) {
    var map = { live: 'pill-green', planned: 'pill-grey', draft: 'pill-amber' };
    var label = { live: 'Available now', planned: 'Coming soon', draft: 'Draft' }[status] || status;
    return '<span class="pill ' + (map[status] || 'pill-grey') + '">' + esc(label) + '</span>';
  }

  var MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="14" r="10" fill="none" stroke="currentColor" stroke-width="2.4"/><line x1="2" y1="24" x2="30" y2="24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="16" y1="24" x2="24" y2="8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  var THUMB_CIRCLE = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<circle cx="50" cy="44" r="30" fill="none" stroke="#0056d2" stroke-width="3"/>' +
    '<line x1="8" y1="74" x2="92" y2="74" stroke="#0056d2" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="50" y1="74" x2="76" y2="29" stroke="#f1b434" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="50" y1="74" x2="22" y2="31" stroke="#f1b434" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="22" y1="31" x2="76" y2="29" stroke="#f1b434" stroke-width="3" stroke-linecap="round"/></svg>';
  var THUMB_TRIG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M14 78 L86 78 L86 24 Z" fill="none" stroke="#0056d2" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M78 78 L78 70 L86 70" fill="none" stroke="#0056d2" stroke-width="2.5"/>' +
    '<path d="M34 78 A20 20 0 0 0 30 66" fill="none" stroke="#f1b434" stroke-width="3"/></svg>';

  function lessonCard(l) {
    var live = l.status === 'live';
    var href = 'lesson.html?id=' + encodeURIComponent(l.slug);
    var t = thumb(l);
    var art = t ? '<img src="' + esc(t) + '" alt="" loading="lazy">' : (/trig/i.test(l.topic || '') ? THUMB_TRIG : THUMB_CIRCLE);
    var meta = [l.topic, l.level, live && l.duration ? l.duration + ' video' : ''].filter(Boolean).map(esc).join(' · ');
    return '<article class="course-card' + (live ? '' : ' coming') + '">' +
      '<div class="course-thumb">' + art + '</div>' +
      '<div class="course-body">' +
      '<div class="provider">' + MARK + ' Mathematics in Motion</div>' +
      '<h3>' + (live ? '<a href="' + href + '">' + esc(l.title) + '</a>' : esc(l.title)) + '</h3>' +
      '<p class="muted small" style="margin:0">' + esc(l.summary) + '</p>' +
      '<div class="course-meta"><span>Lesson ' + esc(l.number) + '</span><span>·</span><span>' + meta + '</span></div>' +
      '<div>' + statusPill(l.status) + '</div>' +
      '</div></article>';
  }

  window.MIM = { loadLessons: loadLessons, esc: esc, param: param, lines: lines, csv: csv, hasVideo: hasVideo,
    thumb: thumb, statusPill: statusPill, lessonCard: lessonCard, mark: MARK, connected: connected };
})();
