# Free setup: GitHub Pages + Supabase

This version is a static website that uses Supabase Auth and a shared Postgres database. It works with GitHub project URLs such as `https://NAME.github.io/REPOSITORY/`. Its page sections use URL fragments such as `app.html#payroll` so direct links and refreshes work on GitHub Pages.

## Before you begin

- You need a GitHub account and a Supabase account. The plans below may have limits or change; check current terms before deploying. Supabase free projects can pause after inactivity, and free plans don't include automatic backups. GitHub Pages is public, even if your source repository is private.
- **Never upload real company, contract, employee, payroll, bank details, backups, passwords, or secret/service-role keys to GitHub.** The app files contain empty defaults so that the original file's business records aren't published. Existing data must be imported privately through the signed-in site, after setup.
- This code has not been tested against your Supabase project or independently security-audited. Arrange a security review and appropriate backups and controls before real confidential or financial use. Both admin and user roles can read and change **all** workspace data; the role is a label, not a granular permission system.
- This is one shared workspace, not separate data for each account. Restrict Supabase dashboard access to trusted administrators. The publishable key is public by design; database Row Level Security, approved profiles, and Auth provide access control.

## 1. Create a Supabase project

1. Create a **new, dedicated project** at https://supabase.com/dashboard. Select the free plan and set a strong database password. Keep that password private; it is not needed in the website files.
2. Open **SQL Editor**, create a new query, copy all of `supabase-setup.sql`, and run it. This creates the two tables, RLS policies, and the revision-checked write function. Use a new project so these objects do not conflict with other applications.
3. Open **Authentication → Settings / General** and turn off **Allow new users to sign up**. Keep email/password sign-in enabled. Users must be created manually by a trusted project administrator. The profile allowlist blocks access even if signups are accidentally enabled, but disabling public signups is still important.
4. In **Authentication → Users**, choose **Add user → Create new user** (the dashboard label can change). Create the admin email and password, and confirm the email if prompted. Create a second user email and password the same way. Give each a strong, unique password securely; never add passwords to GitHub. Sign-in uses email addresses, not the preview's username/password accounts. The invitation flow and password-reset flow are not implemented in this version; use manually created password accounts.
5. Creating the Supabase Auth user alone does **not** grant workspace access. Copy the admin user's **UUID** from the Users list, then run this in the SQL Editor, replacing the UUID:

```sql
insert into public.workspace_profiles (user_id, role)
values ('REPLACE-WITH-ADMIN-USER-UUID', 'admin')
on conflict (user_id) do update set role = excluded.role;
```

Repeat for the other account with its own UUID and role `'user'`. A role is an access label only; both can use all features. To remove access, delete that user's row in `workspace_profiles` using the Supabase Table Editor. Their next protected database request will be denied; also disable or delete their Auth account to revoke sign-in.

## 2. Connect the website to your project

1. In the Supabase project **Connect** dialog (or Project Settings → API Keys), copy the **Project URL** and **publishable key** (`sb_publishable_...`). Do not use `sb_secret_...`, `service_role`, database passwords, or any other secret.
2. Edit `config.js` in the extracted folder. Replace the two placeholders, keeping the quotes:

```js
window.SS_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseKey: 'sb_publishable_YOUR_PUBLIC_KEY'
};
```

These two values are public; security relies on Auth, the approved-user table and RLS. Do not change `supabase-setup.sql` to grant anonymous access. The app accepts Supabase-hosted `*.supabase.co` URLs and publishable keys only.

## 3. Publish with GitHub Pages

1. Create a **public** GitHub repository (GitHub Free normally requires a public repository for Pages). Remember that all files on the site are publicly downloadable; do not put sensitive records in them.
2. Upload **the contents** of this folder to the repository root, including `index.html`, `app.html`, `app.js`, `auth.js`, `boot.js`, `defaults.js`, `config.js`, and `supabase.min.js`. `supabase-setup.sql` and this guide can be uploaded too; neither should contain personal data. Do not upload old HTML files or backups containing business data.
3. In the repository, open **Settings → Pages**. Under **Build and deployment**, select **Deploy from a branch**, choose `main` and `/ (root)`, then save. Wait for deployment.
4. Open the URL shown on the Pages settings screen using HTTPS. Sign in with the email and password of a user created and approved above. The dashboard should open. The first deployment has no contracts or employees until you add or import them.
5. Test a second approved user, and verify an unapproved user cannot access data. Test signing out and refreshing links such as `app.html#contracts`. Check Supabase RLS and Auth settings independently before entering real data.

## 4. Restore and operate

- If you have a JSON backup exported using **Backup / Restore** in the original app, use the hosted app's **Backup / Restore** to import it privately, after signing in. Verify contracts, invoices, employee records and payroll. A restore saves categories separately; it can partially succeed if an error or concurrent edit occurs. Do not upload backups to GitHub.
- Wait for **Saved** before leaving. A revision check prevents a stale session from silently overwriting a newer version of the same data category. On a conflict, reload and re-enter unsaved changes. Avoid editing the same category concurrently.
- Export protected backups regularly and test restoring them. Backups can contain sensitive information. The free Supabase tier doesn't provide automatic backups, and pausing, limits, or service outages can make the app unavailable.
- Accounts are managed in Supabase, not inside the app. To change a password, use Supabase's administrative tools; no password reset screen is included. Never share privileged Supabase project access or keys.

## Troubleshooting

- **“Setup required”**: Check `config.js` was edited and uploaded, and the key begins `sb_publishable_`. Wait for the GitHub Pages deployment to finish and refresh.
- **“Could not sign in”**: Check the email and password, email confirmation, Auth provider configuration and that the project isn't paused.
- **“Not approved”**: Create the profile row using the correct Auth user UUID; creating the Auth account is a separate step. Then sign in again.
- **“Could not load workspace data”**: Verify `supabase-setup.sql` ran successfully, RLS is enabled and the project URL/key are from the same project.
- **Page not found**: Ensure the files are at the published repository root and open the Pages URL from repository settings. Don't use absolute `/app.html` paths for project sites.

Documentation: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages · https://supabase.com/docs/guides/getting-started/api-keys · https://supabase.com/docs/guides/auth/users · https://supabase.com/pricing
