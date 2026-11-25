/* Mathematics in Motion - data layer.
 * Reads lessons from Supabase when assets/config.js is filled in,
 * otherwise from the bundled content/lessons.js snapshot.
 * Exposes window.MIM.loadLessons() -> Promise<lesson[]> and a few helpers. */
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

  function statusPill(status) {
    var map = { live: 'pill-green', planned: 'pill-grey', draft: 'pill-amber' };
    var label = { live: 'Live', planned: 'Planned', draft: 'Draft' }[status] || status;
    return '<span class="pill ' + (map[status] || 'pill-grey') + '">' + esc(label) + '</span>';
  }

  var THUMB = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<circle cx="50" cy="44" r="30" fill="none" stroke="var(--accent)" stroke-width="3"/>' +
    '<line x1="8" y1="74" x2="92" y2="74" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="50" y1="74" x2="76" y2="29" stroke="var(--spark)" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="50" y1="74" x2="22" y2="31" stroke="var(--spark)" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="22" y1="31" x2="76" y2="29" stroke="var(--spark)" stroke-width="3" stroke-linecap="round"/></svg>';
  var THUMB_TRIG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M14 78 L86 78 L86 24 Z" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M78 78 L78 70 L86 70" fill="none" stroke="var(--accent)" stroke-width="2.5"/>' +
    '<path d="M34 78 A20 20 0 0 0 30 66" fill="none" stroke="var(--spark)" stroke-width="3"/></svg>';

  function lessonCard(l) {
    var live = l.status === 'live';
    var title = live ? '<a href="lesson.html?id=' + encodeURIComponent(l.slug) + '">' + esc(l.title) + '</a>' : esc(l.title);
    var thumb = /trig/i.test(l.topic || '') ? THUMB_TRIG : THUMB;
    return '<div class="card lesson-card' + (live ? '' : ' coming') + '">' +
      '<div class="lesson-thumb">' + thumb + '</div><div>' +
      '<span class="pill">' + esc(l.number) + '</span> ' + statusPill(l.status) +
      '<h3 style="margin-top:.6em">' + title + '</h3>' +
      '<p class="muted">' + esc(l.summary) + (live && l.duration ? ' <span class="small">(' + esc(l.duration) + ')</span>' : '') + '</p>' +
      (live ? '<a class="btn btn-primary" href="lesson.html?id=' + encodeURIComponent(l.slug) + '">Open the lesson</a>' : '') +
      '</div></div>';
  }

  window.MIM = { loadLessons: loadLessons, esc: esc, param: param, statusPill: statusPill, lessonCard: lessonCard, connected: connected };
})();
