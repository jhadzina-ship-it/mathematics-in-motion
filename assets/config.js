/* Mathematics in Motion - site configuration.
 *
 * Paste the two values from the Supabase dashboard (Project Settings -> API):
 *   supabaseUrl      e.g. "https://abcdefghijkl.supabase.co"
 *   supabaseAnonKey  the long "anon public" key
 *
 * While both are empty, the site shows the lessons bundled in content/lessons.js
 * and the admin page explains that Supabase is not connected yet.
 * The anon key is safe to publish: row-level security in supabase/schema.sql
 * decides what it may read and write.
 */
window.MIM_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: ""
};
