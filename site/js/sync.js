// Optional sign-in that syncs your saved roles, profile, progress and streak across devices.
// Off unless site/config.js sets a Supabase project. Ada works fully without it.
// Your API key and AI plans never leave the device. Schema and row-level security: supabase/schema.sql.
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";

const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
export const SYNCED = ["saved", "profile", "progress", "streak", "resume"];
export const enabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

// Combine two copies of a visitor's state without losing work: saved roles and finished
// roadmap steps are unions; profile, resume and streak come from whichever copy changed last.
export function mergeState(local, remote) {
  if (!remote) return local;
  const newer = (remote.updated || 0) > (local.updated || 0) ? remote : local;
  const progress = { ...(remote.progress || {}) };
  for (const [track, done] of Object.entries(local.progress || {})) progress[track] = [...new Set([...(progress[track] || []), ...done])];
  const streaks = [local.streak || {}, remote.streak || {}];
  return {
    saved: [...new Set([...(local.saved || []), ...(remote.saved || [])])],
    profile: newer.profile ?? local.profile ?? remote.profile,
    resume: newer.resume ?? local.resume ?? remote.resume,
    progress,
    streak: { ...newer.streak, best: Math.max(...streaks.map((s) => s.best || 0)) },
    updated: Math.max(local.updated || 0, remote.updated || 0),
  };
}

let client = null;
let user = null;
let pushTimer = null;

async function getClient() {
  if (!client) {
    const { createClient } = await import(SDK_URL);
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  }
  return client;
}

export function currentUser() { return user; }

// read(): the local state object; write(state): apply a merged state; onChange(user): refresh the UI.
export async function initSync({ read, write, onChange }) {
  if (!enabled) return;
  const sb = await getClient();
  const pull = async () => {
    const { data, error } = await sb.from("user_state").select("data").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    const merged = mergeState(read(), data?.data);
    write(merged);
    await push(true);
  };
  sb.auth.onAuthStateChange((event, session) => {
    const was = user?.id;
    user = session?.user || null;
    onChange(user);
    if (user && user.id !== was) pull().catch((e) => console.warn("Ada sync:", e.message));
  });
  async function push(now) {
    if (!user) return;
    clearTimeout(pushTimer);
    const send = () => sb.from("user_state").upsert({ user_id: user.id, data: read(), updated_at: new Date().toISOString() })
      .then(({ error }) => error && console.warn("Ada sync:", error.message));
    if (now) return send();
    pushTimer = setTimeout(send, 1500);
  }
  initSync.push = push;
}

export function pushSoon() { initSync.push?.(false); }

export async function signInWithEmail(email) {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}

export async function signInWithGitHub() {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithOAuth({ provider: "github", options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
}

// One-click unsubscribe from the link in a weekly email; works without signing in.
export async function unsubscribe(token) {
  const { data, error } = await (await getClient()).rpc("ada_unsubscribe", { token });
  if (error) throw error;
  return data === true;
}

export async function signOut() { await (await getClient()).auth.signOut(); }

export async function deleteMyData() {
  const sb = await getClient();
  if (user) await sb.from("user_state").delete().eq("user_id", user.id);
  await sb.auth.signOut();
}
