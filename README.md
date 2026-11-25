# Mathematics in Motion

Free animated mathematics lessons for the Zimbabwe O-Level (Forms 3 and 4), aligned to ZIMSEC Mathematics Syllabus B (2024 to 2030), by Jephias Hadzina. A static site with no build step and no framework: plain HTML, CSS and JavaScript, hosted on GitHub Pages, with the lessons stored in Supabase so the author can post new ones from a form.

## Pages

| File | Page |
| --- | --- |
| `index.html` | Home: lessons, topics, how a lesson works |
| `lessons.html` | All lessons grouped by syllabus topic; `?topic=` and `?q=` filters |
| `lesson.html?id=<slug>` | A lesson: watch, read, practise. Working (typed or a photo) is marked with feedback. 80% on the practice opens the next lesson in the topic |
| `test.html` | A short test on one topic with fresh numbers, marked with a report of lessons to revisit |
| `syllabus.html` | Where each lesson sits in Syllabus B, from `content/syllabus-b.json` |
| `about.html` | About Jephias, the project, contact |
| `admin.html` | Author sign-in and lesson editor, with AI draft generation |

Student navigation is Lessons, Tests, About. Every student page includes the floating Help chat. Progress (completed lessons, last test report) is kept in the browser's localStorage; there are no student accounts.

Shared code is in `assets/`: `style.css`, `site.js` (navigation, video embed, question checker), `data.js` (loads lessons, progress and unlock rules, the `MIM` helpers), `help.js` (Help chat), `admin.js` (the editor), `config.js` (Supabase connection).

## Data

- **Supabase** holds the lessons and questions once `assets/config.js` has the project URL and publishable key. The author edits them on `admin.html`; changes are live at once. Setup: [`supabase/SETUP.md`](supabase/SETUP.md).
- **Bundled fallback** otherwise: `content/lessons.js`, generated from `content/lessons.json`, so the site works without Supabase.
- `content/syllabus-b.json` is the Syllabus B topic list (Forms 3 and 4) that `syllabus.html` renders. Lessons carry `syllabus_topic`, `syllabus_form` and `syllabus_objective`, and are numbered `topic.n` (10.1, 10.2, ...).

## Edge Functions (`supabase/functions/`)

| Function | Who calls it | What it does |
| --- | --- | --- |
| `generate-lesson` | the signed-in author only | Drafts a complete lesson from a video link and a request |
| `student-assist` | public, rate-limited per IP | `help` (Help chat), `mark` (marks working or a photo), `test` (builds a topic test), `report` (marks a test and writes the report) |

Both need the `ANTHROPIC_API_KEY` secret set in Supabase. The key never reaches the browser. Without the functions the site still works: lessons and answer checking run in the browser; marking, Help and Tests say they are not connected.

## Build script

`tools/build.py` writes the SVG figures to `assets/figures/`, regenerates `content/lessons.js` and `supabase/seed.sql` from `content/lessons.json`, and fills `{{HERO}}` in `index.html` if present. Run it by hand after editing `content/lessons.json`:

```powershell
python -I tools/build.py .
```

## Publish on GitHub Pages

1. Push this folder to a public repository.
2. **Settings → Pages → Build and deployment**: Source "Deploy from a branch", branch `main`, folder `/ (root)`.
3. The site is live at `https://<username>.github.io/<repo>/` within a minute. Every later push updates it.

## Before the first public share

- Add the author's email on the About page and his photo at `assets/img/jephias.jpg`.
- Connect Supabase and deploy both Edge Functions (see `supabase/SETUP.md`).
- Add the video link for any lesson still marked "coming soon".
