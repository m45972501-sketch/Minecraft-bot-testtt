import os, sys, json, time, secrets, sqlite3, hashlib, hmac, re, asyncio, subprocess
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("RAZENBOTS_DB", str(BASE / "razenbots.sqlite3")))
COOKIE_NAME = "razen_session"
SESSION_TTL = 60 * 60 * 24 * 14
# Set this environment variable to a long random secret in production.
SESSION_SECRET = os.environ.get("RAZENBOTS_SECRET", "")
if not SESSION_SECRET:
    SESSION_SECRET = secrets.token_urlsafe(48)
    print("WARNING: RAZENBOTS_SECRET is not set; sessions will be invalidated when the process restarts.", flush=True)

app = FastAPI(title="Razenbots API", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=[], allow_credentials=True, allow_methods=["GET","POST"], allow_headers=["Content-Type"])
bot_processes = {}  # one managed process per authenticated user; use a persistent process supervisor for production
bot_meta = {}
bot_logs = {}

def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            email TEXT,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS sessions(
            token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )""")
init_db()

def hash_password(password: str, salt: Optional[bytes] = None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return salt.hex() + "$" + digest.hex()

def verify_password(password: str, stored: str):
    try:
        salt_hex, digest_hex = stored.split("$", 1)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 310_000)
        return hmac.compare_digest(actual.hex(), digest_hex)
    except (ValueError, TypeError):
        return False

def token_hash(token: str):
    return hashlib.sha256((SESSION_SECRET + token).encode()).hexdigest()

def current_user(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Please sign in first.")
    now = int(time.time())
    with db() as con:
        row = con.execute("""SELECT users.id, users.username, users.email
            FROM sessions JOIN users ON users.id=sessions.user_id
            WHERE sessions.token_hash=? AND sessions.expires_at>?""", (token_hash(token), now)).fetchone()
        if not row:
            raise HTTPException(401, "Session expired. Please sign in again.")
        return dict(row)

class AuthBody(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_]+$")
    password: str = Field(min_length=8, max_length=128)
    email: Optional[str] = Field(default=None, max_length=254)

class BotBody(BaseModel):
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    edition: str
    version: str = Field(min_length=1, max_length=32)
    bot_name: str = Field(min_length=3, max_length=16, pattern=r"^[A-Za-z0-9_]+$")
    anti_afk: bool = True
    command_enabled: bool = False
    join_command: str = Field(default="", max_length=160)

def add_log(uid, text):
    logs = bot_logs.setdefault(uid, [])
    stamp = datetime.now().strftime("%H:%M:%S")
    logs.append(f"[{stamp}] {text}")
    bot_logs[uid] = logs[-100:]

def get_proc(uid):
    p = bot_processes.get(uid)
    return p if p and p.poll() is None else None

@app.get("/")
def home():
    return FileResponse(BASE / "index.html")

@app.get("/style.css")
def style():
    return FileResponse(BASE / "style.css", media_type="text/css")

@app.get("/script.js")
def script():
    return FileResponse(BASE / "script.js", media_type="application/javascript")

@app.post("/api/register")
def register(body: AuthBody, response: Response):
    email = (body.email or "").strip() or None
    if email and (len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
        raise HTTPException(400, "Please enter a valid email address or leave it blank.")
    with db() as con:
        if con.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE", (body.username,)).fetchone():
            raise HTTPException(409, "That username is already registered.")
        if email and con.execute("SELECT 1 FROM users WHERE email=? COLLATE NOCASE", (email,)).fetchone():
            raise HTTPException(409, "That email is already registered.")
        cur = con.execute("INSERT INTO users(username,email,password_hash,created_at) VALUES(?,?,?,?)",
                          (body.username, email, hash_password(body.password), int(time.time())))
        uid = cur.lastrowid
    issue_session(uid, response)
    return {"message":"Account created successfully."}

@app.post("/api/login")
def login(body: AuthBody, response: Response):
    with db() as con:
        row = con.execute("SELECT id,password_hash FROM users WHERE username=? COLLATE NOCASE", (body.username,)).fetchone()
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "Incorrect username or password.")
    issue_session(row["id"], response)
    return {"message":"Signed in successfully."}

def issue_session(uid, response):
    token = secrets.token_urlsafe(40)
    with db() as con:
        con.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
                    (token_hash(token), uid, int(time.time()) + SESSION_TTL))
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=os.environ.get("RAZEN_HTTPS","0")=="1",
                        samesite="lax", max_age=SESSION_TTL, path="/")

@app.post("/api/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        with db() as con:
            con.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(token),))
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"message":"Signed out."}

@app.get("/api/me")
def me(user=Depends(current_user)):
    return {"username":user["username"], "email":user["email"]}

@app.get("/api/versions")
def versions(edition: str, user=Depends(current_user)):
    # Lists are queried from installed protocol libraries, not hard-coded UI lists.
    js = r"""
const ed=process.argv[1];
try {
 if(ed==='java'){
  const md=require('minecraft-data');
  const versions=(md.versions.pc||[]).filter(v=>v.minecraftVersion && /^1\.(2[1-9]|[3-9]\d)(\.|$)/.test(v.minecraftVersion)).map(v=>v.minecraftVersion);
  console.log(JSON.stringify([...new Set(versions)].reverse()));
 } else {
  const bedrock=require('bedrock-protocol');
  const versions=(bedrock.supportedVersions||[]).filter(v=>/^1\.(2[1-9]|[3-9]\d)(\.|$)/.test(v));
  console.log(JSON.stringify([...new Set(versions)].reverse()));
 }
} catch(e) { console.error(e.message); process.exit(2); }
"""
    if edition not in ("java","bedrock"):
        raise HTTPException(400,"Edition must be java or bedrock.")
    try:
        result = subprocess.run(["node","-e",js,edition], cwd=BASE, capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Protocol library not installed")
        values = json.loads(result.stdout.strip().splitlines()[-1])
        return {"versions":values, "default":values[0] if values else ""}
    except Exception as exc:
        raise HTTPException(503, f"Could not load versions. Install the Node protocol packages. ({str(exc)[:180]})")

@app.get("/api/status")
def status(user=Depends(current_user)):
    uid = user["id"]; proc = get_proc(uid); meta = bot_meta.get(uid, {})
    state = "online" if proc and meta.get("connected") else ("connecting" if proc else "idle")
    if proc and proc.poll() is not None:
        state = "error"
    return {"running":bool(proc),"state":state,"bot_name":meta.get("bot_name"),"address":meta.get("address"),
            "edition":meta.get("edition"),"version":meta.get("version"),"logs":bot_logs.get(uid,[])[-30:]}

@app.post("/api/bot/start")
def start_bot(body: BotBody, user=Depends(current_user)):
    uid=user["id"]
    if get_proc(uid):
        raise HTTPException(409,"You already have a bot running. Stop it before starting another.")
    # Prevent command injection / malformed hosts. Hostnames, IPv4 and IPv6 are allowed.
    host=body.host.strip()
    if any(c in host for c in (" ", "/", "\\", ";", "'", '"', "`")) or host.startswith("-"):
        raise HTTPException(400,"Enter a valid server hostname or IP address.")
    if body.edition not in ("java","bedrock"):
        raise HTTPException(400,"Choose Java or Bedrock.")
    if body.command_enabled and body.join_command:
        if not body.join_command.startswith("/") or "\n" in body.join_command or "\r" in body.join_command:
            raise HTTPException(400,"The optional join command must begin with / and fit on one line.")
    if body.edition=="java":
        code = r"""
const mineflayer=require('mineflayer');
const options={host:process.env.RZ_HOST,port:Number(process.env.RZ_PORT),username:process.env.RZ_NAME,version:process.env.RZ_VERSION,auth:'offline'};
let bot, moveTimer=null, commandTimer=null, phase=0;
try{
 bot=mineflayer.createBot(options);
 bot.once('spawn',()=>{
  console.log('connected: Java bot spawned');
  if(process.env.RZ_COMMAND) commandTimer=setTimeout(()=>{try{bot.chat(process.env.RZ_COMMAND)}catch(e){console.log('ERROR command '+e.message)}},2500);
  if(process.env.RZ_ANTIAFK==='1') moveTimer=setInterval(()=>{
   if(!bot||!bot.entity)return;
   phase++;
   const states=[
    {forward:true,back:false,left:false,right:false,jump:false,sprint:false},
    {forward:false,back:false,left:true,right:false,jump:false,sprint:false},
    {forward:false,back:true,left:false,right:false,jump:false,sprint:false},
    {forward:false,back:false,left:false,right:true,jump:false,sprint:false},
    {forward:false,back:false,left:false,right:false,jump:false,sprint:false}
   ];
   try{bot.clearControlStates();for(const [k,v] of Object.entries(states[phase%states.length]))bot.setControlState(k,v);bot.look((phase*1.13)%(Math.PI*2),0,true);console.log('anti-afk: movement cycle '+phase)}catch(e){console.log('ERROR movement '+e.message)}
  },6500+Math.floor(Math.random()*3500));
 });
 bot.on('kicked',r=>console.log('ERROR kicked: '+JSON.stringify(r).slice(0,250)));
 bot.on('error',e=>console.log('ERROR '+e.message));
 bot.on('end',()=>{console.log('disconnected');process.exit(0)});
 process.on('SIGTERM',()=>{if(moveTimer)clearInterval(moveTimer);if(commandTimer)clearTimeout(commandTimer);try{bot.quit('Stopped from Razenbots')}catch{}process.exit(0)});
}catch(e){console.log('ERROR '+e.message);process.exit(2)}
"""
    else:
        code = r"""
const bedrock=require('bedrock-protocol');
const host=process.env.RZ_HOST, port=Number(process.env.RZ_PORT), username=process.env.RZ_NAME, version=process.env.RZ_VERSION;
const anti=process.env.RZ_ANTIAFK==='1', command=process.env.RZ_COMMAND||'';
let client, phase=0, timer=null, commandTimer=null;
try{
 client=bedrock.createClient({host,port,username,offline:true,version});
 client.on('join',()=>{console.log('connected: Bedrock join successful');if(command)commandTimer=setTimeout(()=>{try{client.queue('command_request',{command,origin:{type:'player',uuid:'',request_id:'00000000-0000-0000-0000-000000000000'},internal:false,version:0})}catch(e){console.log('ERROR command '+e.message)}},2500)});
 client.on('spawn',()=>console.log('connected: Bedrock spawned'));
 client.on('error',e=>console.log('ERROR '+e.message));
 client.on('close',()=>{console.log('disconnected');process.exit(0)});
 if(anti)timer=setInterval(()=>{phase++;try{client.queue('player_auth_input',{pitch:0,yaw:(phase*67)%360,position:{x:0,y:0,z:0},move_vector:{x:phase%2?0.25:-0.25,y:0},head_yaw:(phase*67)%360,input_data:{_value:0},input_mode:1,play_mode:0,interaction_model:0,tick:BigInt(phase),delta:{x:0,y:0,z:0},analogue_move_vector:{x:0.25,y:0}});console.log('anti-afk: movement cycle '+phase)}catch(e){console.log('ERROR movement '+e.message)}},9000);
 process.on('SIGTERM',()=>{if(timer)clearInterval(timer);if(commandTimer)clearTimeout(commandTimer);try{client.close()}catch{}process.exit(0)});
}catch(e){console.log('ERROR '+e.message);process.exit(2)}
"""
    env=os.environ.copy()
    env.update({"RZ_HOST":host,"RZ_PORT":str(body.port),"RZ_NAME":body.bot_name,"RZ_VERSION":body.version,
                "RZ_ANTIAFK":"1" if body.anti_afk else "0",
                "RZ_COMMAND":body.join_command.strip() if body.command_enabled else ""})
    try:
        proc=subprocess.Popen(["node","-e",code],cwd=BASE,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                              text=True,bufsize=1)
    except FileNotFoundError:
        raise HTTPException(503,"Node.js is required for Minecraft protocol libraries on this hosting service.")
    bot_processes[uid]=proc
    bot_meta[uid]={"bot_name":body.bot_name,"address":f"{host}:{body.port}","edition":body.edition.upper(),"version":body.version,"connected":False}
    bot_logs[uid]=[]
    add_log(uid,f"Starting {body.edition.upper()} bot {body.bot_name} → {host}:{body.port}")
    # Background reader captures output and updates status without blocking API calls.
    import threading
    def read_output():
        try:
            for line in proc.stdout:
                line=line.strip()
                if not line: continue
                add_log(uid,line[:500])
                if "connected:" in line:
                    bot_meta.get(uid, {})["connected"]=True
                if "ERROR" in line:
                    bot_meta.get(uid, {})["connected"]=False
        except Exception as e:
            add_log(uid,"ERROR log reader: "+str(e)[:120])
    threading.Thread(target=read_output,daemon=True).start()
    return {"message":"Bot process launched. Check Connection and Console logs for the handshake result."}

@app.post("/api/bot/stop")
def stop_bot(user=Depends(current_user)):
    uid=user["id"]; proc=get_proc(uid)
    if not proc:
        bot_processes.pop(uid,None)
        raise HTTPException(409,"No bot is currently running.")
    proc.terminate()
    try: proc.wait(timeout=4)
    except subprocess.TimeoutExpired: proc.kill()
    bot_processes.pop(uid,None)
    if uid in bot_meta: bot_meta[uid]["connected"]=False
    add_log(uid,"Bot stopped from dashboard.")
    return {"message":"Bot stopped."}

@app.on_event("shutdown")
def shutdown():
    for proc in list(bot_processes.values()):
        try: proc.terminate()
        except Exception: pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT","8000")))
