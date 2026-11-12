# SS Construction workspace

A multi-page invoice, contract, employee and payroll workspace with a dashboard and server-side admin/user sign-in. Both roles currently have the same access to all workspace data and tools. Accounts are provisioned by the server operator; there is no public registration.

## Run locally

Requires Python 3.10+; no third-party dependencies.

```sh
python server.py create-user admin --role admin
python server.py create-user staff --role user
python server.py serve
```

Open http://127.0.0.1:8000 and sign in with the username and password you created. Passwords are prompted for privately and must be at least 12 characters. To reset one and invalidate its sessions:

```sh
python server.py reset-password staff
```

Data is shared between all accounts and stored in `workspace.sqlite3` beside the server. Set `SS_DB_PATH` to a path on persistent storage to change this. The original app's bundled company, contract and employee records are sample defaults; review or replace them before real use. To bring data from your old offline app, export a JSON backup there and use **Backup / Restore** here. Do not import unknown files.

## Online deployment

Run behind a properly configured HTTPS reverse proxy and set `SS_SECURE_COOKIE=1`. Set `SS_DB_PATH` to a persistent disk, not ephemeral container storage. Restrict direct access to the backend so traffic reaches it only through the proxy. The proxy should limit request sizes, enforce HTTPS, set a suitable Content Security Policy and frame policy for your domain, and add production-grade rate limiting. The bundled process has only basic in-memory sign-in throttling; use a single server process, since its throttle is not shared across processes. Protect and regularly back up the SQLite database, including its account and sensitive payroll/bank records. Do not expose the database file or server source through a static file server.

Create accounts before starting the server; there are no default passwords. There is no password reset email, MFA, audit log, encrypted-at-rest database, granular per-role permissions or built-in user-management screen. Arrange these and a security review appropriate to your requirements before handling sensitive production data. Sessions expire after 12 hours. Changes save to the server; a revision check warns when another session edits the same data category, instead of overwriting it. Resolve conflicts by reloading and re-entering changes; do not work on the same record in multiple sessions simultaneously. Keep backups and wait for the “Saved” indicator before closing or navigating away.

Example (behind an HTTPS proxy on the same machine):

```sh
export SS_DB_PATH=/var/lib/ss-workspace/workspace.sqlite3
export SS_SECURE_COOKIE=1
python server.py serve --host 127.0.0.1 --port 8000
```
