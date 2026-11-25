/* Mathematics in Motion - site configuration.
 *
 * Paste the two values from the Supabase dashboard (Project Settings -> API):
 *   supabaseUrl      e.g. "https://abcdefghijkl.supabase.co"
 *   supabaseAnonKey  the "publishable" key (sb_publishable_...), or the legacy "anon public" key
 *
 * While both are empty, the site shows the lessons bundled in content/lessons.js
 * and the admin page explains that Supabase is not connected yet.
 * The publishable/anon key is safe to publish: row-level security in supabase/schema.sql
 * decides what it may read and write.
 */
window.MIM_CONFIG = {
  supabaseUrl: "https://qvadtbzocfhinklurbpz.supabase.co",
  supabaseAnonKey: "sb_publishable_g7re468QSAPSVO10qn_hTQ___CO4AyE"
};
