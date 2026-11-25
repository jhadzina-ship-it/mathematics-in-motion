/* Mathematics in Motion - shared behaviour. No dependencies. */
(function () {
  // Mobile navigation toggle
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Mark the current page in the navigation
  var here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(function (a) {
    var target = a.getAttribute('href').split('/').pop().split('?')[0];
    if (target === here) a.setAttribute('aria-current', 'page');
  });

  // YouTube embed. Any .video-frame with data-video-id gets a player when the ID looks real.
  window.MIM_mountVideos = function () {
    document.querySelectorAll('.video-frame[data-video-id]').forEach(function (frame) {
      if (frame.querySelector('iframe')) return;
      var id = (frame.getAttribute('data-video-id') || '').trim();
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
      var iframe = document.createElement('iframe');
      iframe.src = 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&modestbranding=1';
      iframe.title = frame.getAttribute('data-video-title') || 'Lesson video';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.loading = 'lazy';
      frame.innerHTML = '';
      frame.appendChild(iframe);
    });
  };
  window.MIM_mountVideos();

  // Numeric questions. Each .question has data-answer and optional data-tolerance / data-hint.
  // onScore(correct, total, answered) is called after every check; when omitted a default message is shown.
  window.MIM_mountQuestions = function (onScore) {
    var questions = document.querySelectorAll('.question[data-answer]');
    var scoreBox = document.querySelector('[data-score]');
    var answered = {};

    function updateScore() {
      var correct = 0, done = 0;
      Object.keys(answered).forEach(function (k) { done++; if (answered[k]) correct++; });
      if (scoreBox) {
        var c = scoreBox.querySelector('[data-score-correct]'); if (c) c.textContent = correct;
        var t = scoreBox.querySelector('[data-score-total]'); if (t) t.textContent = questions.length;
      }
      if (onScore) { onScore(correct, questions.length, done); return; }
      var msg = scoreBox && scoreBox.querySelector('[data-score-message]');
      if (!msg) return;
      if (done < questions.length) msg.textContent = 'Answer every question to finish the lesson.';
      else if (correct === questions.length) msg.textContent = 'All correct. Lesson complete.';
      else msg.textContent = 'Open the worked solutions for the ones you missed and try again.';
    }

    questions.forEach(function (q, i) {
      var input = q.querySelector('input');
      var button = q.querySelector('button');
      var feedback = q.querySelector('.feedback');
      var expected = parseFloat(q.getAttribute('data-answer'));
      var tol = parseFloat(q.getAttribute('data-tolerance') || '0.01');
      var attempts = 0;

      function check() {
        var raw = (input.value || '').replace(/[^0-9.+-]/g, '');
        if (raw === '') { input.focus(); return; }
        var value = parseFloat(raw);
        var ok = Math.abs(value - expected) <= tol;
        attempts++;
        feedback.classList.add('show');
        feedback.classList.toggle('ok', ok);
        feedback.classList.toggle('no', !ok);
        if (ok) {
          feedback.textContent = attempts === 1 ? 'Correct, first time.' : 'Correct.';
          input.disabled = true; button.disabled = true;
          answered[i] = true;
        } else {
          var hint = q.getAttribute('data-hint');
          feedback.textContent = 'Not yet. ' + (hint ? hint : 'Try again.');
          answered[i] = false;
          if (attempts >= 2) {
            var sol = q.querySelector('details');
            if (sol) sol.open = true;
          }
        }
        updateScore();
      }
      button.addEventListener('click', check);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); check(); } });
      q._setCorrect = function () {
        feedback.classList.add('show', 'ok'); feedback.classList.remove('no');
        feedback.textContent = 'Correct (working marked).';
        input.disabled = true; button.disabled = true; answered[i] = true; updateScore();
      };
    });
    if (questions.length) updateScore();
    // Lets the marking step count a question as correct.
    return { setCorrect: function (index) { var q = questions[index]; if (q && q._setCorrect) q._setCorrect(); } };
  };
  window.MIM_mountQuestions();
})();
