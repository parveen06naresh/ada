// Free accounts: sign-in unlocks the full match list, saving and tracking applications, and weekly
// email, and syncs them across devices. Off unless site/config.js sets a Supabase project; if the
// sign-in service can't load, Ada stays fully open instead of locking anyone out.
// Your API key and AI plans never leave the device. Schema and row-level security: supabase/schema.sql.
import * as config from "../config.js";

const { SUPABASE_URL, SUPABASE_KEY, GITHUB_LOGIN, GOOGLE_LOGIN, EMAIL_READY } = config;

const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
export const SYNCED = ["saved", "profile", "progress", "streak", "resume", "tracker"];
export const enabled = Boolean(SUPABASE_URL && SUPABASE_KEY);
export const github = Boolean(GITHUB_LOGIN);
export const google = Boolean(GOOGLE_LOGIN);
// Features lock behind an account only when people can actually get in.
export const gate = enabled && Boolean(EMAIL_READY || GITHUB_LOGIN || GOOGLE_LOGIN);

// Combine two copies of a visitor's state without losing work: saved roles and finished
// roadmap steps are unions (minus roles unsaved later); each tracked application keeps its latest status; profile, resume and
// streak come from whichever copy changed last.
export function mergeState(local, remote) {
  if (!remote) return local;
  const newer = (remote.updated || 0) > (local.updated || 0) ? remote : local;
  const progress = { ...(remote.progress || {}) };
  for (const [track, done] of Object.entries(local.progress || {})) progress[track] = [...new Set([...(progress[track] || []), ...done])];
  const streaks = [local.streak || {}, remote.streak || {}];
  const tracker = { ...(remote.tracker || {}) };
  for (const [id, t] of Object.entries(local.tracker || {})) if (!tracker[id] || (t.t || 0) >= (tracker[id].t || 0)) tracker[id] = t;
  return {
    // An unsave on one device leaves a dated "removed" marker, so the other copy can't bring the role back.
    saved: [...new Set([...(local.saved || []), ...(remote.saved || [])])].filter((id) => tracker[id]?.s !== "removed"),
    profile: newer.profile ?? local.profile ?? remote.profile,
    resume: newer.resume ?? local.resume ?? remote.resume,
    progress,
    tracker,
    streak: { ...newer.streak, best: Math.max(...streaks.map((s) => s.best || 0)) },
    updated: Math.max(local.updated || 0, remote.updated || 0),
  };
}

let client = null;
let user = null;
let pushTimer = null;
let status = enabled ? "pending" : "off";

async function getClient() {
  if (!client) {
    const { createClient } = await import(SDK_URL);
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  }
  return client;
}

export function currentUser() { return user; }
// "pending" until the first answer from the sign-in service, then "ok"; "off" when it is not set up or failed to load.
export function authStatus() { return status; }

// read(): the local state object; write(state): apply a merged state; onChange(user): refresh the UI.
export async function initSync({ read, write, onChange }) {
  if (!enabled) return;
  let sb;
  try { sb = await getClient(); } catch (e) { status = "off"; onChange(null, "OFF"); throw e; }
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
    status = "ok";
    onChange(user, event);
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

const here = () => location.origin + location.pathname;

// Turn Supabase's error text into a sentence a student can act on. `code` tells the UI what to offer next.
export function authMessage(e) {
  const m = String(e?.message || e || "");
  const code = e?.code || "";
  if (/invalid login credentials/i.test(m) || code === "invalid_credentials") return { code: "bad_login", text: "That email and password don't match. Try again, or reset your password." };
  if (/email not confirmed/i.test(m) || code === "email_not_confirmed") return { code: "unconfirmed", text: "Confirm your email first. We can send the confirmation link again." };
  if (/already registered|already been registered|user_already_exists/i.test(m + code)) return { code: "exists", text: "That email already has an account. Log in instead." };
  if (/password/i.test(m) && /(at least|characters|weak|short)/i.test(m)) return { code: "weak", text: "Use a password of at least 8 characters." };
  if (/same.*password|different from the old/i.test(m)) return { code: "same", text: "Pick a password you haven't used here before." };
  if (/rate|limit|429|too many|security purposes/i.test(m)) return { code: "rate", text: "Too many tries in a short time. Wait a minute and try again." };
  if (/not authorized|sending.*email|error sending|smtp/i.test(m)) return { code: "email", text: "We couldn't send the email just now. Please try again in a few minutes." };
  if (/expired|invalid.*(link|token)|otp/i.test(m)) return { code: "expired", text: "That link has expired or was already used. Ask for a new one." };
  if (/fetch|network|load failed/i.test(m)) return { code: "network", text: "Can't reach the sign-in service. Check your connection and try again." };
  return { code: "other", text: m || "Something went wrong. Please try again." };
}

// Errors Supabase puts in the address after a sign-in or reset link (for example an expired link).
// Read once at start-up, before the router or the SDK touch the address.
export function linkError(href = location.href) {
  const frag = new URLSearchParams((href.split("#")[1] || "").replace(/^\//, ""));
  const query = new URL(href).searchParams;
  const get = (k) => frag.get(k) || query.get(k);
  if (!get("error") && !get("error_code")) return null;
  return { code: get("error_code") || get("error"), text: (get("error_description") || "").replace(/\+/g, " ") };
}

// Email and password. Returns "in" when the account is ready now, or "confirm" when Supabase
// emailed a confirmation link first (the default). Supabase hides whether an email is taken by
// returning a user with no identities, so that case is reported as an error the UI can explain.
export async function signUp(email, password) {
  const sb = await getClient();
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: here() } });
  if (error) throw error;
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    const e = new Error("User already registered"); e.code = "user_already_exists"; throw e;
  }
  return data.session ? "in" : "confirm";
}

export async function signInWithPassword(email, password) {
  const { error } = await (await getClient()).auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signInWithEmail(email) {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: here() } });
  if (error) throw error;
}

export async function resendConfirmation(email) {
  const { error } = await (await getClient()).auth.resend({ type: "signup", email, options: { emailRedirectTo: here() } });
  if (error) throw error;
}

export async function sendPasswordReset(email) {
  const { error } = await (await getClient()).auth.resetPasswordForEmail(email, { redirectTo: here() });
  if (error) throw error;
}

export async function updatePassword(password) {
  const { error } = await (await getClient()).auth.updateUser({ password });
  if (error) throw error;
}

export async function signInWith(provider) {
  const sb = await getClient();
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: here() } });
  if (error) throw error;
}

// One-click unsubscribe from the link in a weekly email; works without signing in.
export async function unsubscribe(token) {
  const { data, error } = await (await getClient()).rpc("ada_unsubscribe", { token });
  if (error) throw error;
  return data === true;
}

export async function signOut() { await (await getClient()).auth.signOut(); }

// Deletes the sign-in itself and, through the database cascade, every synced row.
// Falls back to deleting the data row if the delete function has not been installed yet.
export async function deleteAccount() {
  const sb = await getClient();
  if (!user) return;
  const { error } = await sb.rpc("ada_delete_account");
  if (error) {
    const { error: e2 } = await sb.from("user_state").delete().eq("user_id", user.id);
    if (e2) throw e2;
  }
  await sb.auth.signOut().catch(() => {});
  return !error;
}
