import assert from "node:assert/strict";
import { test } from "node:test";

const { mergeState, authMessage, linkError } = await import("../site/js/sync.js");

test("an unsave on one device is not undone by an older copy on another", () => {
  const phone = { saved: ["a", "b"], tracker: { a: { s: "applied", t: 5 }, b: { s: "saved", t: 5 } }, updated: 5 };
  const laptop = { saved: ["a"], tracker: { a: { s: "applied", t: 5 }, b: { s: "removed", t: 9 } }, updated: 9 };
  assert.deepEqual(mergeState(phone, laptop).saved, ["a"]);
  // Saving it again later wins over the old marker.
  const again = { saved: ["a", "b"], tracker: { a: { s: "applied", t: 5 }, b: { s: "saved", t: 12 } }, updated: 12 };
  assert.deepEqual(mergeState(again, laptop).saved.sort(), ["a", "b"]);
});

test("sign-in errors become plain sentences with a next step", () => {
  assert.equal(authMessage({ message: "Invalid login credentials" }).code, "bad_login");
  assert.equal(authMessage({ message: "Email not confirmed" }).code, "unconfirmed");
  assert.equal(authMessage({ message: "User already registered" }).code, "exists");
  assert.equal(authMessage({ message: "x", code: "user_already_exists" }).code, "exists");
  assert.equal(authMessage({ message: "Password should be at least 8 characters." }).code, "weak");
  assert.equal(authMessage({ message: "For security purposes, you can only request this after 42 seconds." }).code, "rate");
  assert.equal(authMessage({ message: "Error sending confirmation email" }).code, "email");
  assert.equal(authMessage({ message: "Failed to fetch" }).code, "network");
});

test("an expired email link is detected from the address", () => {
  const e = linkError("https://x.io/ada/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.equal(e.code, "otp_expired");
  assert.match(e.text, /invalid or has expired/);
  assert.equal(linkError("https://x.io/ada/#explore"), null);
  assert.equal(linkError("https://x.io/ada/?error=server_error&error_description=boom").code, "server_error");
});
