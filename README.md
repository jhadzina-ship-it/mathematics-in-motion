# Mathematics in Motion

Animated mathematics lessons by Jephias Hadzina, each with a YouTube video and practice questions checked in the browser. A static site on GitHub Pages, with lessons stored in Supabase so the author can post new ones from a form without touching code.

## Pages

| File | Page |
| --- | --- |
| `index.html` | Home: how a lesson works, live lessons |
| `lessons.html` | Lesson library by chapter |
| `lesson.html?id=<slug>` | A lesson: video, the idea, practice questions, textbook placement |
| `textbooks.html` | Alignment with enVision, Big Ideas and HMH Into Geometry |
| `approach.html` | Teaching approach and mastery-learning roadmap |
| `about.html` | About Jephias, the project, contact |
| `admin.html` | Author sign-in and lesson editor (linked from the footer) |

No build step and no framework. Shared code is in `assets/`: `style.css`, `site.js` (navigation, video embed, question checker), `data.js` (loads lessons), `admin.js` (the editor), `config.js` (Supabase connection).

## Where the lessons come from

1. **Supabase**, once `assets/config.js` holds the project URL and anon key. The author signs in on `admin.html` and edits lessons there; changes are live at once. Setup: [`supabase/SETUP.md`](supabase/SETUP.md).
2. **Bundled fallback** otherwise: `content/lessons.js`, generated from `content/lessons.json`. The site works without Supabase, and keeps working if the free project is paused.

To change the bundled lessons or regenerate the diagrams, edit `content/lessons.json` and run the generator (it also writes `supabase/seed.sql`):

```powershell
python -I tools/build.py .
```

## Publish on GitHub Pages

1. Push this folder to a public repository.
2. **Settings → Pages → Build and deployment**: Source "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
3. The site is live at `https://<username>.github.io/<repo>/` within a minute. Every later push updates it.

## Before the first public share

- Fill in the About page (three comments marked `Jephias:` show where).
- Connect Supabase so Jephias can post from the Admin page (15 minutes, see `supabase/SETUP.md`).
- Confirm the textbook section numbers against physical copies and tick "checked" in the Admin page.
- Add the video link for the alternate segment theorem lesson.
