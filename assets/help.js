/* Mathematics in Motion - floating Help chat for students (student-assist Edge Function, "help" mode).
 * Include after data.js. Set window.MIM_LESSON_CONTEXT = { number, title, theorem, explanation, questions:[{prompt}] } on a lesson page. */
(function () {
  if (!window.MIM) return;
  var css = '.help-fab{position:fixed;right:18px;bottom:18px;z-index:40;background:var(--blue);color:#fff;border:0;border-radius:24px;padding:12px 18px;font:inherit;font-weight:600;box-shadow:var(--shadow-lg);cursor:pointer;display:flex;gap:8px;align-items:center}' +
    '.help-panel{position:fixed;right:18px;bottom:76px;width:min(360px,92vw);max-height:70vh;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow-lg);display:none;flex-direction:column;z-index:40;overflow:hidden}' +
    '.help-panel.open{display:flex}.help-head{padding:12px 14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;font-weight:600}' +
    '.help-log{padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;flex:1;min-height:160px}' +
    '.help-log .msg{padding:9px 12px;border-radius:12px;max-width:90%;font-size:.92rem;line-height:1.4;white-space:pre-wrap}.help-log .me{align-self:flex-end;background:var(--blue);color:#fff}.help-log .bot{align-self:flex-start;background:var(--blue-soft)}.help-log .sys{align-self:center;color:var(--ink-2);font-size:.8rem}' +
    '.help-row{display:flex;gap:6px;padding:10px;border-top:1px solid var(--line)}.help-row input{flex:1;font:inherit;padding:9px 12px;border:1px solid var(--ink-3);border-radius:8px}' +
    '@media (max-width:600px){.help-fab{right:12px;bottom:12px}.help-panel{right:8px;left:8px;width:auto;bottom:70px}}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var fab = document.createElement('button'); fab.className = 'help-fab'; fab.type = 'button';
  fab.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/></svg> Help';
  var panel = document.createElement('div'); panel.className = 'help-panel';
  panel.innerHTML = '<div class="help-head"><span>Help</span><button type="button" class="btn btn-ghost btn-sm" data-close>Close</button></div>' +
    '<div class="help-log"></div><div class="help-row"><input type="text" placeholder="Ask how the site works, or for a hint" aria-label="Your question"><button class="btn btn-primary btn-sm" type="button">Send</button></div>';
  document.body.appendChild(fab); document.body.appendChild(panel);

  var log = panel.querySelector('.help-log'), input = panel.querySelector('input'), send = panel.querySelector('.help-row button');
  var history = [];
  function add(cls, text) { var d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text; log.appendChild(d); log.scrollTop = 1e9; return d; }
  var greeted = false;
  function open() {
    panel.classList.add('open');
    if (!greeted) { greeted = true; add('bot', window.MIM_LESSON_CONTEXT ? 'Hi! Ask me how this page works, or for a hint on a question. I will not give you the answer, but I will point you the right way.' : 'Hi! Ask me how to use the site: lessons, practice, tests and progress.'); }
    input.focus();
  }
  fab.addEventListener('click', function () { panel.classList.contains('open') ? panel.classList.remove('open') : open(); });
  panel.querySelector('[data-close]').addEventListener('click', function () { panel.classList.remove('open'); });
  function ask() {
    var text = input.value.trim(); if (!text) return;
    input.value = ''; add('me', text); history.push({ role: 'user', content: text });
    var wait = add('sys', 'Thinking…'); send.disabled = true;
    MIM.assist({ mode: 'help', messages: history, lesson: window.MIM_LESSON_CONTEXT || null })
      .then(function (r) { wait.remove(); add('bot', r.reply); history.push({ role: 'assistant', content: r.reply }); })
      .catch(function (e) { wait.remove(); add('sys', e.message || 'Something went wrong.'); history.pop(); })
      .then(function () { send.disabled = false; input.focus(); });
  }
  send.addEventListener('click', ask);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ask(); } });
})();
