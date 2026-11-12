# Deploy with GitHub and Render

This project uses a Python server for sign-in and shared data. GitHub stores the code; Render runs the server. **Do not use GitHub Pages** for this version: it cannot run the Python server.

## Important before you start

- The provided `render.yaml` creates a **paid** Render web service and a 1 GB persistent disk. Review current Render pricing before confirming. The free web service cannot attach a persistent disk or use Render Shell, and its SQLite data can disappear on restart or redeploy.
- Your database, accounts, records and backups must not be committed to GitHub. `.gitignore` excludes SQLite database files, but inspect files before uploading. A private repository is recommended, particularly because the original app includes prefilled example business records.
- This is a starter app, not an independently security-audited production system. Before using real payroll, identity or bank information, arrange an appropriate security review, production-grade rate limiting, access controls, encrypted backups, and compliance review. Both admin and user roles currently have the same access. There is no MFA, audit log, or in-app user administration.
- Run **one instance only**. SQLite is stored on the attached disk and is not designed here for multi-instance use. There can be downtime during deploys.

## 1. Upload the code to GitHub

1. Download and unzip the GitHub-ready archive.
2. In GitHub, create a new **private** repository. For easiest upload, leave it empty (do not initialize a README or `.gitignore`).
3. Open the new repository, choose **Add file → Upload files**, and upload the contents of the unzipped folder (not an extra enclosing folder). Make sure `render.yaml`, `server.py`, `app.html`, and `login.html` are in the repository root. Some file pickers hide `.gitignore`: if so, add it separately using **Add file → Create new file**, or use Git locally.
4. Commit the files. Never upload the preview database or passwords.

Alternatively, from the unzipped folder using Git:

```sh
git init
git add .
git commit -m "Initial workspace"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Replace the URL with your own repository URL. GitHub may ask you to authenticate.

## 2. Deploy on Render

1. Sign in to Render. Select **New → Blueprint**, connect GitHub if asked, and choose your repository.
2. Render should detect `render.yaml`. Inspect the web service, paid compute plan, and disk before approving the Blueprint. Deploy it.
3. Wait until the web service reports that it is live. Render gives it an HTTPS `onrender.com` URL. The login page will appear, but you must create accounts before anyone can sign in.
4. The configuration uses `/var/data/workspace.sqlite3` on the persistent disk and secure HTTPS cookies. Do not remove the disk or change its mount path without migrating the data first.

## 3. Create admin and user accounts

1. Open the Render service dashboard and select **Shell**. The paid service supports shell access.
2. Run:

```sh
python server.py create-user admin --role admin
python server.py create-user staff --role user
```

3. Enter a different strong password for each account when prompted (at least 12 characters). Password entry is not shown. These are examples: choose your own usernames. **Do not put passwords in GitHub or commands.**
4. Open the HTTPS URL and sign in. The preview passwords are not included in the repository or deployment.

To reset a password and sign out that account's existing sessions, run `python server.py reset-password USERNAME` in the same Render Shell. Account creation and resets must run on the deployed service with `SS_DB_PATH=/var/data/workspace.sqlite3`, which the Blueprint sets automatically. Local commands create local accounts, not Render accounts.

## 4. Import data and maintain the app

- The app begins with the original file's bundled defaults. Review or replace the sample data. To migrate existing data, first export JSON using **Backup / Restore** in the original site, then import that backup in the hosted site. Verify it carefully.
- Keep regular protected backups of both workspace data and the database. Backup files contain sensitive data. Test restores; persistent disks are not a substitute for backups.
- Wait for the **Saved** indicator before leaving. If someone else changes the same data category concurrently, a conflict warning appears: reload and re-enter unsaved changes. Multi-category operations can be partially saved if an error occurs; verify and restore from backup if needed.
- A new commit to the linked branch can trigger a redeploy. The disk survives redeploys, but deleting the disk/service may delete the stored data; check Render's current policies before making changes.
- The simple in-memory login limiter is not a substitute for platform-level or external rate limiting. Arrange a production security review and add suitable protections before publishing sensitive information.

## Troubleshooting

- **Cannot sign in:** Confirm that you created the account in the deployed service's Shell, that `SS_DB_PATH` points to the persistent disk, and that you are using the HTTPS URL.
- **Data disappeared:** Confirm that the paid disk is mounted at `/var/data` and `SS_DB_PATH` is `/var/data/workspace.sqlite3`. Restore from a known-good backup if needed.
- **Build cannot find files:** `render.yaml` and `server.py` must be at the repository root, or configure Render's root directory to the folder containing them.
- **Deployment fails on port:** The server listens on `0.0.0.0` and reads Render's `PORT` environment variable automatically.
