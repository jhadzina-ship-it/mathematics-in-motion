# Connecting the site to Supabase

Takes about 15 minutes. Costs nothing: everything below is on Supabase's free plan. Until this is done the site shows the lessons bundled in `content/lessons.js`, so nothing is broken in the meantime.

## 1. Create the project

1. Go to https://supabase.com and sign in (GitHub sign-in is fine). Jephias should own this account, since he owns the content.
2. **New project**. Name it `mathematics-in-motion`, choose a strong database password (store it in a password manager; the site never needs it), pick the region closest to most students, and create it. Wait a minute for it to start.

## 2. Create the tables

1. In the left bar open **SQL Editor** → **New query**.
2. Paste the whole of `supabase/schema.sql` and click **Run**. It creates the `lessons` and `questions` tables, the security rules, and a public `figures` bucket for diagrams.
3. New query again. Paste `supabase/seed.sql` and **Run**. This loads the starting lessons (Angle of elevation, Alternate segment theorem and the planned ones).

## 3. Create the one author account and close sign-ups

1. **Authentication** → **Users** → **Add user** → **Create new user**. Enter Jephias's email and a password, tick **Auto confirm user**. This is the account that signs in on the site's Admin page.
2. **Authentication** → **Sign In / Providers** → **Email**: leave Email enabled, but turn **off** "Allow new users to sign up". Save. Now nobody else can create an account.

## 4. Tell the site where the project is

1. **Project Settings** (gear icon) → **API Keys**. Copy the **publishable** key (starts with `sb_publishable_`). The Project URL is on the project home page, `https://<ref>.supabase.co`. Never use the **secret** key in the site.
2. Open `assets/config.js` in the site and paste them in:

```js
window.MIM_CONFIG = {
  supabaseUrl: "https://xxxxxxxxxxxx.supabase.co",
  supabaseAnonKey: "sb_publishable_..."
};
```

3. Commit the change. The publishable key is designed to be public: the row-level security rules in `schema.sql` are what decide that visitors can only read, and only the signed-in author can write.

## 5. Try it

Open `admin.html` on the site, sign in with the author account, and change something small, such as a lesson's summary. Reload the lesson page: the change is live. No commit needed.

## What lives where

| Thing | Where | Who changes it |
| --- | --- | --- |
| Lessons, questions, video ids | Supabase tables | Jephias, through the Admin page |
| Diagrams Jephias uploads | Supabase `figures` bucket | Jephias, through the Admin page |
| Diagrams generated for the first lessons | `assets/figures/` in the repo | the developer |
| Page layout, styles, this guide | the GitHub repo | the developer |
| Fallback copy of the lessons | `content/lessons.js` | regenerated from `content/lessons.json` by the developer |

## Free-plan limits worth knowing

- A free project is **paused after 7 days without any request**. The site's own page views count as requests, so a site that gets visitors stays awake. If it is paused, the dashboard has a one-click Restore, and the site shows the bundled fallback lessons meanwhile.
- 500 MB database and 1 GB file storage: thousands of lessons' worth. Videos stay on YouTube, not in Supabase.
- Supabase does not bill the free plan; it stops at the limits instead.
