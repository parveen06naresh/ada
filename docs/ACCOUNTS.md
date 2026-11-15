# Turning on accounts and email (about 15 minutes, all free)

Ada's code handles sign-up, log in, password reset, the welcome email and the weekly matches email.
What is left needs the owner's accounts, so it is done by hand once. Never paste a secret key into a
chat or a file in this repo. Secret keys go only into GitHub's Secrets page or Supabase's settings.

Why this matters: Supabase's built-in email only delivers to the project's own team. Until step 2 is
done, a student who signs up never receives the confirmation email.

## 1. Supabase: database function and sign-in settings
In the Ada project on supabase.com:
1. **SQL Editor**: paste `supabase/migrations/20261115_accounts.sql` and click **Run**. It adds "Delete my account".
2. **Authentication → URL Configuration**: Site URL `https://parveen06naresh.github.io/ada/`, and the same address under Redirect URLs.
3. **Authentication → Sign In / Providers → Email**: Email provider on, **Confirm email** on, minimum password length **8**.

## 2. Send Supabase's emails through Brevo
1. Sign up at brevo.com and verify the address the emails will come from (**Senders, domains & IPs → Senders**).
2. **SMTP & API → SMTP → Generate a new SMTP key**.
3. In Supabase, **Authentication → Emails → SMTP Settings**, turn on **Enable custom SMTP**: Sender email = the verified address, Sender name `Ada`, Host `smtp-relay.brevo.com`, Port `587`, Username = the login on Brevo's SMTP page, Password = the SMTP key. Save.
4. **Authentication → Rate Limits**: set emails per hour to 100.

## 3. Ada's email designs
In Supabase, **Authentication → Emails → Templates**. For each template, set the subject and paste the HTML file:

| Template | Subject | File |
|---|---|---|
| Confirm signup | Confirm your email for Ada | `supabase/templates/confirm_signup.html` |
| Magic Link | Your Ada sign-in link | `supabase/templates/magic_link.html` |
| Reset Password | Reset your Ada password | `supabase/templates/reset_password.html` |
| Change Email Address | Confirm your new email for Ada | `supabase/templates/change_email.html` |

The files are built from `pipeline/email_layout.html` by `python -m pipeline.emails`.

## 4. GitHub secrets (welcome email and weekly matches)
At Settings → Secrets and variables → Actions, add: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (the `sb_secret_...` key),
`SMTP_HOST` (`smtp-relay.brevo.com`), `SMTP_PORT` (`587`), `SMTP_USER`, `SMTP_PASS`, `ALERT_FROM` (`Ada <your-verified-email>`).
Then run the **account-emails** workflow once from the Actions tab to check it.

## 5. Lock the extras behind an account
Set `EMAIL_READY = true` in `site/config.js`. Until then every feature stays open, so nobody is asked
to sign up with an email that can't arrive.

## Test it
Sign up on the live site with a second email address you own. You should get, in order: the
confirmation email, then (within the hour) the welcome email. Try "Forgot password?" too.
