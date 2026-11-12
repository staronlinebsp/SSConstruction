#!/usr/bin/env python3
"""SS Construction workspace: standard-library HTTP server and SQLite store."""
import argparse, getpass, hashlib, hmac, json, os, re, secrets, sqlite3, sys, time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

HERE = Path(__file__).resolve().parent
DB = os.environ.get('SS_DB_PATH', str(HERE / 'workspace.sqlite3'))
SECURE = os.environ.get('SS_SECURE_COOKIE', '0') == '1'
MAX_BODY = 5 * 1024 * 1024
KEYS = {'ss_inv_company_v2':dict, 'ss_inv_contracts_v2':list, 'ss_inv_history_v2':list, 'ss_inv_employees_v1':list, 'ss_inv_attendance_v1':dict, 'ss_inv_salary_hist_v1':list}
PAGES = {'/', '/invoices', '/contracts', '/employees', '/payroll', '/settings'}
ATTEMPTS = {}

def db():
    c = sqlite3.connect(DB, timeout=15)
    c.execute('PRAGMA foreign_keys=ON')
    return c

def setup():
    with db() as c:
        c.executescript('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')));
        CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_data (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL);''')

def digest_password(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def hash_token(token): return hashlib.sha256(token.encode()).hexdigest()

class Handler(BaseHTTPRequestHandler):
    server_version = 'SSWorkspace'
    sys_version = ''
    def respond(self, code, body=b'', content_type='text/plain; charset=utf-8', extra=()):
        if isinstance(body, str): body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','same-origin')
        for k,v in extra: self.send_header(k,v)
        self.end_headers()
        self.wfile.write(body)
    def json(self, code, value, extra=()): self.respond(code, json.dumps(value), 'application/json; charset=utf-8', extra)
    def redirect(self, path, extra=()): self.respond(303, '', extra=[('Location',path),*extra])
    def session(self):
        try:
            jar=cookies.SimpleCookie(); jar.load(self.headers.get('Cookie',''))
            token=jar['ss_session'].value
            if len(token)>200: return None
            with db() as c:
                row=c.execute('SELECT users.id, users.username, users.role, sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires>?', (hash_token(token), int(time.time()))).fetchone()
            if row: return {'id':row[0], 'username':row[1], 'role':row[2], 'csrf':row[3], 'token':token}
        except (KeyError, cookies.CookieError): pass
        return None
    def cookie(self, value, max_age):
        return f'ss_session={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}' + ('; Secure' if SECURE else '')
    def read_json(self):
        if not self.headers.get('Content-Type','').lower().startswith('application/json'): raise ValueError('JSON required')
        n=int(self.headers.get('Content-Length','0'))
        if n <= 0 or n > MAX_BODY: raise ValueError('Invalid request size')
        value=json.loads(self.rfile.read(n))
        if not isinstance(value,dict): raise ValueError('Object required')
        return value
    def csrf_ok(self, session):
        token=self.headers.get('X-CSRF-Token','')
        return bool(session and token and hmac.compare_digest(session['csrf'], token))
    def do_GET(self):
        path=urlparse(self.path).path
        user=self.session()
        if path=='/login':
            if user: return self.redirect('/')
            return self.respond(200, (HERE/'login.html').read_bytes(), 'text/html; charset=utf-8')
        if path in PAGES:
            if not user: return self.redirect('/login')
            with db() as c: rows=c.execute('SELECT key,value,revision FROM workspace_data').fetchall()
            data={}; revisions={}
            for key, value, rev in rows:
                try: data[key]=json.loads(value); revisions[key]=rev
                except ValueError: pass
            boot={'data':data, 'revisions':revisions, 'csrf':user['csrf'], 'user':{'username':user['username'],'role':user['role']}}
            safe=json.dumps(boot, ensure_ascii=True).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
            page=(HERE/'app.html').read_text(encoding='utf-8').replace('__BOOT_DATA__',safe,1)
            return self.respond(200, page, 'text/html; charset=utf-8')
        return self.respond(404,'Not found')
    def do_POST(self):
        path=urlparse(self.path).path
        if path=='/api/login':
            # A custom header and JSON content-type force a CORS preflight for cross-origin requests.
            if self.headers.get('X-Requested-With') != 'SSWorkspace': return self.json(403,{'error':'Invalid request'})
            try:
                payload=self.read_json(); username=payload.get('username',''); password=payload.get('password','')
                if not isinstance(username,str) or not isinstance(password,str) or len(username)>80 or len(password)>256: raise ValueError()
            except (ValueError, json.JSONDecodeError): return self.json(400,{'error':'Invalid request'})
            now=time.time(); ip=self.client_address[0]; name=username.strip().lower()
            # Bound login attempts per account AND IP. Single-process rate limit; production proxy should add its own.
            for k in list(ATTEMPTS):
                if not ATTEMPTS[k] or ATTEMPTS[k][-1]<now-900: del ATTEMPTS[k]
            tags=['ip:'+ip,'user:'+name]
            for tag in tags: ATTEMPTS[tag]=[t for t in ATTEMPTS.get(tag,[]) if t>now-900]
            if len(ATTEMPTS[tags[0]])>=30 or len(ATTEMPTS[tags[1]])>=8: return self.json(429,{'error':'Too many attempts. Try again in 15 minutes.'})
            with db() as c: row=c.execute('SELECT id,salt,password_hash FROM users WHERE username=?',(username.strip(),)).fetchone()
            # Hash even when account does not exist to reduce account enumeration by timing.
            calc=digest_password(password,row[1] if row else '00'*16)
            if not row or not hmac.compare_digest(calc,row[2]):
                for tag in tags: ATTEMPTS[tag].append(now)
                return self.json(401,{'error':'Invalid username or password.'})
            for tag in tags: ATTEMPTS.pop(tag,None)
            token=secrets.token_urlsafe(32); csrf=secrets.token_urlsafe(32)
            with db() as c:
                c.execute('DELETE FROM sessions WHERE expires<=?',(int(now),))
                c.execute('INSERT INTO sessions VALUES (?,?,?,?)',(hash_token(token),row[0],csrf,int(now)+43200))
            return self.json(200,{'ok':True}, [('Set-Cookie',self.cookie(token,43200))])
        if path=='/api/logout':
            user=self.session()
            if not self.csrf_ok(user): return self.json(403,{'error':'Invalid session'})
            with db() as c: c.execute('DELETE FROM sessions WHERE token_hash=?',(hash_token(user['token']),))
            return self.json(200,{'ok':True}, [('Set-Cookie',self.cookie('',0))])
        return self.respond(404,'Not found')
    def do_PUT(self):
        path=urlparse(self.path).path
        user=self.session()
        if not user: return self.json(401,{'error':'Sign in required'})
        if not self.csrf_ok(user): return self.json(403,{'error':'Invalid request'})
        if not path.startswith('/api/data/'): return self.respond(404,'Not found')
        key=unquote(path[len('/api/data/'):])
        if key not in KEYS: return self.json(404,{'error':'Unknown data key'})
        try:
            payload=self.read_json(); value=payload['value']; revision=payload['revision']
            if not isinstance(value,KEYS[key]) or type(revision) is not int or revision<0: raise ValueError()
            encoded=json.dumps(value,ensure_ascii=False,separators=(',',':'))
        except (ValueError, KeyError, json.JSONDecodeError): return self.json(400,{'error':'Invalid data'})
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT revision FROM workspace_data WHERE key=?',(key,)).fetchone(); current=row[0] if row else 0
            if current!=revision: return self.json(409,{'error':'Data changed in another session','revision':current})
            new=current+1
            c.execute('INSERT INTO workspace_data(key,value,revision) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, revision=excluded.revision',(key,encoded,new))
        return self.json(200,{'revision':new})

def main():
    parser=argparse.ArgumentParser(description='SS Construction workspace')
    sub=parser.add_subparsers(dest='command',required=True)
    serve=sub.add_parser('serve'); serve.add_argument('--host',default='127.0.0.1'); serve.add_argument('--port',type=int,default=int(os.environ.get('PORT','8000')))
    create=sub.add_parser('create-user'); create.add_argument('username'); create.add_argument('--role',choices=['admin','user'],required=True)
    reset=sub.add_parser('reset-password'); reset.add_argument('username')
    args=parser.parse_args(); setup()
    if args.command in ('create-user','reset-password'):
        if not re.fullmatch(r'[A-Za-z0-9_.-]{3,64}',args.username): sys.exit('Username must be 3–64 letters, numbers, dots, underscores or hyphens.')
        pw=getpass.getpass('Password (at least 12 characters): '); confirm=getpass.getpass('Confirm password: ')
        if pw!=confirm or len(pw)<12 or len(pw)>256: sys.exit('Passwords must match and be 12–256 characters.')
        salt=secrets.token_hex(16); hashed=digest_password(pw,salt)
        try:
            with db() as c:
                if args.command=='create-user': c.execute('INSERT INTO users(username,salt,password_hash,role) VALUES(?,?,?,?)',(args.username,salt,hashed,args.role))
                else:
                    cur=c.execute('UPDATE users SET salt=?, password_hash=? WHERE username=?',(salt,hashed,args.username))
                    if not cur.rowcount: sys.exit('User not found.')
                    c.execute('DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username=?)',(args.username,))
            print('Account saved.')
        except sqlite3.IntegrityError: sys.exit('Username already exists.')
    else:
        print(f'SS Workspace listening on {args.host}:{args.port}; secure cookies: {SECURE}',flush=True)
        ThreadingHTTPServer((args.host,args.port),Handler).serve_forever()
if __name__=='__main__': main()
