const $ = (id) => document.getElementById(id);
let authMode = "login";
let pollHandle = null;

function message(id, text, error=false) {
  const el = $(id); el.textContent = text; el.classList.toggle("error", !!error);
}
function log(text, kind="") {
  const box = $("logs"), line = document.createElement("div");
  line.className = "log-line " + kind;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  box.appendChild(line); box.scrollTop = box.scrollHeight;
  while (box.children.length > 100) box.removeChild(box.firstChild);
}
async function api(path, options={}) {
  const response = await fetch(path, {credentials:"same-origin", ...options,
    headers: { "Content-Type":"application/json", ...(options.headers||{}) }});
  const data = await response.json().catch(()=>({detail:"Unexpected server response"}));
  if (!response.ok) throw new Error(data.detail || "Request failed");
  return data;
}
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll("[data-auth]").forEach(b=>b.classList.toggle("active",b.dataset.auth===mode));
  $("authTitle").textContent = mode==="login" ? "Sign in" : "Create account";
  $("authSubmit").innerHTML = mode==="login" ? 'Sign in <span>↗</span>' : 'Create account <span>↗</span>';
  $("emailLabel").classList.toggle("hidden", mode!=="register");
  $("password").autocomplete = mode==="login" ? "current-password" : "new-password";
  message("authMessage","");
}
document.querySelectorAll("[data-auth]").forEach(b=>b.addEventListener("click",()=>setAuthMode(b.dataset.auth)));
$("authForm").addEventListener("submit", async e=>{
  e.preventDefault(); message("authMessage","Please wait…");
  try {
    const payload={username:$("username").value.trim(),password:$("password").value};
    if(authMode==="register") payload.email=$("email").value.trim();
    const result=await api(`/api/${authMode}`,{method:"POST",body:JSON.stringify(payload)});
    message("authMessage",result.message||"Success");
    await loadSession();
  } catch(err) { message("authMessage",err.message,true); }
});
$("commandEnabled").addEventListener("change",()=> $("commandFields").classList.toggle("hidden",!$("commandEnabled").checked));
$("edition").addEventListener("change",loadVersions);
async function loadVersions() {
  const edition=$("edition").value, select=$("version");
  select.innerHTML='<option value="">Loading supported versions…</option>';
  try {
    const data=await api(`/api/versions?edition=${edition}`);
    select.replaceChildren();
    data.versions.forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v;select.appendChild(o)});
    if(!data.versions.length) throw new Error("No supported versions found in the installed protocol library.");
    select.value=data.default || data.versions[0];
  } catch(err) {
    select.innerHTML='<option value="">Versions unavailable</option>';
    message("botMessage",err.message,true);
  }
}
async function loadSession() {
  try {
    const data=await api("/api/me");
    $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden"); $("userLabel").textContent=data.username;
    $("topStatus").textContent="Authenticated"; await loadStatus(); await loadVersions();
    if(pollHandle) clearInterval(pollHandle);
    pollHandle=setInterval(loadStatus,3000);
  } catch {
    $("authView").classList.remove("hidden"); $("appView").classList.add("hidden");
    $("logoutBtn").classList.add("hidden");
  }
}
async function loadStatus() {
  try {
    const data=await api("/api/status");
    const pill=$("statePill"); pill.className="state-pill "+(data.state||"idle"); pill.textContent=(data.state||"idle").toUpperCase();
    $("liveBotName").textContent=data.bot_name||"No bot running";
    $("liveAddress").textContent=data.address||"Add your server details to get started.";
    $("liveEdition").textContent=data.edition||"—"; $("liveVersion").textContent=data.version||"—";
    $("stopBtn").disabled=!data.running;
    $("startBtn").disabled=data.running;
    if(data.logs) { $("logs").replaceChildren(); data.logs.forEach(l=>{const d=document.createElement("div");d.className="log-line "+(l.includes("ERROR")?"bad":l.includes("connected")?"good":"");d.textContent=l;$("logs").appendChild(d)}); }
  } catch(e) { $("topStatus").textContent="API unavailable"; }
}
$("botForm").addEventListener("submit",async e=>{
  e.preventDefault(); $("startBtn").disabled=true; message("botMessage","Starting bot…");
  const payload={
    host:$("host").value.trim(),port:Number($("port").value),edition:$("edition").value,
    version:$("version").value,bot_name:$("botName").value.trim(),
    anti_afk:$("antiAfk").checked,command_enabled:$("commandEnabled").checked,
    join_command:$("joinCommand").value.trim()
  };
  try {
    const data=await api("/api/bot/start",{method:"POST",body:JSON.stringify(payload)});
    message("botMessage",data.message||"Bot process started."); log("Start requested.","good"); await loadStatus();
  } catch(err) { message("botMessage",err.message,true); log(err.message,"bad"); $("startBtn").disabled=false; }
});
$("stopBtn").addEventListener("click",async()=>{
  $("stopBtn").disabled=true;
  try { const data=await api("/api/bot/stop",{method:"POST",body:"{}"}); message("botMessage",data.message); log("Stop requested."); await loadStatus(); }
  catch(e){message("botMessage",e.message,true);$("stopBtn").disabled=false}
});
$("clearLogs").addEventListener("click",()=>$("logs").replaceChildren());
$("logoutBtn").addEventListener("click",async()=>{
  try{await api("/api/logout",{method:"POST",body:"{}"})}catch{}
  if(pollHandle)clearInterval(pollHandle); location.reload();
});
loadSession();
