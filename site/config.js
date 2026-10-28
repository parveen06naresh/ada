// Optional cloud sync. Leave empty to run Ada with no accounts (everything stays in the browser).
// To turn on sign-in, create a free Supabase project, run supabase/schema.sql, then paste the
// project URL and its publishable (anon) key here. Both are safe to publish: row-level security
// lets each signed-in person read and write only their own row.
export const SUPABASE_URL = "https://wcergjmwunejgfmhxczk.supabase.co";
export const SUPABASE_KEY = "sb_publishable_Ld2z0pZDYIkscU0QQ-Yi5w_lBbJyOU7";
// Set to true after enabling the GitHub provider in Supabase (Authentication > Providers).
export const GITHUB_LOGIN = false;
// Set to true after enabling the Google provider in Supabase (needs a Google Cloud OAuth client).
export const GOOGLE_LOGIN = false;
