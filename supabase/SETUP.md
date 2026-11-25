# Connecting the site to Supabase

About 20 minutes, all on Supabase's free plan. Until this is done the site shows the lessons bundled in `content/lessons.js`, and the Help chat, marking and Tests say they are not connected.

## 1. Create the project

1. Go to https://supabase.com and sign in. Jephias should own this account, since he owns the content.
2. **New project**. Name it `mathematics-in-motion`, set a strong database password (keep it in a password manager; the site never needs it), pick the region closest to most students, and create it.

## 2. Create the tables

1. **SQL Editor** → **New query**. Paste the whole of `supabase/schema.sql` and **Run**. It creates the `lessons` and `questions` tables, the row-level security rules, and a public `figures` bucket for diagrams.
2. New query. Paste `supabase/seed.sql` and **Run**. This loads the starting lessons (regenerate it with `python -I tools/build.py .` after editing `content/lessons.json`).

## 3. Create the one author account and close sign-ups

1. **Authentication** → **Users** → **Add user** → **Create new user**. Enter the author's email and a password, tick **Auto confirm user**. This account signs in on `admin.html`.
2. **Authentication** → **Sign In / Providers** → **Email**: leave Email on, turn **off** "Allow new users to sign up". Save.

## 4. Tell the site where the project is

1. **Project Settings** → **API Keys**. Copy the **publishable** key (`sb_publishable_...`). The Project URL is on the project home page, `https://<ref>.supabase.co`. Never put the **secret** key in the site.
2. Paste both into `assets/config.js`:

```js
window.MIM_CONFIG = {
  supabaseUrl: "https://xxxxxxxxxxxx.supabase.co",
  supabaseAnonKey: "sb_publishable_..."
};
```

3. Commit. The publishable key is meant to be public; the security rules in `schema.sql` make visitors read-only and let only the signed-in author write.

## 5. Deploy the two Edge Functions

Both call the Claude API with a key kept in the function's secrets, so it never reaches the browser.

| Function | Source | Who may call it |
| --- | --- | --- |
| `generate-lesson` | `supabase/functions/generate-lesson/index.ts` | the signed-in author only (drafts a lesson from a video link) |
| `student-assist` | `supabase/functions/student-assist/index.ts` | anyone on the site, rate-limited per IP: Help chat, marking of working or a photo, topic tests and their reports |

1. Get an API key from the Claude Console (https://platform.claude.com) under API Keys. It is billed per use; a generated lesson or a marked test costs a few cents.
2. **Edge Functions** → **Secrets** → add `ANTHROPIC_API_KEY` with that key. One secret serves both functions.
3. **Edge Functions** → **Deploy a new function** → **Via Editor**. Name it `generate-lesson`, paste the contents of its `index.ts`, deploy. Repeat for `student-assist`.

To change the tone or the marking style, edit the system prompts in the respective `index.ts` and redeploy.

## 6. Try it

- Open `admin.html`, sign in, change a lesson summary. Reload the lesson: the change is live. Try **Generate draft** with a video link.
- Open a lesson as a student, answer a question with some working and submit it for marking. Open the Help button and ask how the site works. Open `test.html` and take a topic test.

## What lives where

| Thing | Where | Who changes it |
| --- | --- | --- |
| Lessons, questions, video ids | Supabase tables | Jephias, through `admin.html` |
| Diagrams Jephias uploads | Supabase `figures` bucket | Jephias, through `admin.html` |
| Generated diagrams for the first lessons | `assets/figures/` | the developer, via `tools/build.py` |
| Syllabus topic list | `content/syllabus-b.json` | the developer |
| Page layout, styles, Edge Function code, this guide | the GitHub repo | the developer |
| Fallback copy of the lessons | `content/lessons.js` | regenerated from `content/lessons.json` by `tools/build.py` |
| Student progress and last test report | the student's browser (localStorage) | the student |

## Free-plan limits worth knowing

- A free project is **paused after 7 days without any request**. Page views count, so a visited site stays awake. If paused, the dashboard has a one-click Restore, and the site shows the bundled lessons meanwhile.
- 500 MB database and 1 GB file storage: thousands of lessons' worth. Videos stay on YouTube.
- Edge Functions have a generous free invocation quota; the Claude API key is billed separately by Anthropic.
