
const $ = id => document.getElementById(id);

let currentStep = 1;
let serverData = null;
let busy = false;

function showResult(message) {
  $("result").textContent = message;
  $("result").classList.remove("hidden");
}

function hideResult() {
  $("result").classList.add("hidden");
}

function goTo(step) {
  currentStep = step;

  for (let i = 1; i <= 3; i++) {
    $("page" + i).classList.toggle("hidden", i !== step);
    document.querySelector(`[data-step="${i}"]`)
      .classList.toggle("active", i === step);
  }

  hideResult();
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) throw new Error(data.error || "حدث خطأ.");
  return data;
}

$("checkBtn").onclick = async () => {
  const host = $("host").value.trim();
  const port = Number($("port").value);

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return showResult("أدخل عنوانًا صحيحًا ومنفذًا بين 1 و65535.");
  }

  $("checkBtn").disabled = true;
  $("checkBtn").textContent = "جارٍ فحص السيرفر...";
  hideResult();

  try {
    serverData = await api("/api/status", { host, port });

    $("serverAddress").textContent = `${host}:${port}`;
    $("serverMotd").textContent = serverData.motd || "لا توجد رسالة";
    $("playerCount").textContent =
      `اللاعبون: ${serverData.playersOnline ?? "?"} / ${serverData.playersMax ?? "?"}`;

    const icon = $("serverInfo").querySelector(".server-icon");
    icon.replaceChildren();

    if (serverData.favicon) {
      const img = document.createElement("img");
      img.src = serverData.favicon;
      img.alt = "Server icon";
      img.width = 56;
      img.height = 56;
      img.style.borderRadius = "10px";
      icon.appendChild(img);
    } else {
      icon.textContent = "⛏";
    }

    goTo(2);
  } catch (error) {
    showResult(error.message);
  } finally {
    $("checkBtn").disabled = false;
    $("checkBtn").textContent = "فحص السيرفر ←";
  }
};

$("reviewBtn").onclick = () => {
  const username = $("username").value.trim();
  const command = $("command").value.trim();
  const message = $("message").value.trim();

  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    return showResult("اسم الحساب يجب أن يكون من 3 إلى 16 حرفًا أو رقمًا أو _.");
  }

  $("sumUser").textContent = username;
  $("sumVersion").textContent = $("version").value;
  $("sumCommand").textContent = command || "لا يوجد";
  $("sumMessage").textContent = message || "لا توجد";

  goTo(3);
};

document.querySelectorAll("[data-back]").forEach(button => {
  button.onclick = () => goTo(Number(button.dataset.back));
});

$("startBtn").onclick = async () => {
  if (busy || !serverData) return;

  busy = true;
  $("startBtn").disabled = true;
  $("startBtn").textContent = "جارٍ الاتصال...";

  try {
    const data = await api("/api/start", {
      host: $("host").value.trim(),
      port: Number($("port").value),
      username: $("username").value.trim(),
      version: $("version").value,
      command: $("command").value.trim(),
      message: $("message").value.trim()
    });

    showResult(data.message);
    $("botInfo").textContent = data.message;
    $("statusText").textContent = "متصل أو جارٍ الاتصال";
    $("stopBtn").disabled = false;
  } catch (error) {
    showResult(error.message);
    $("botInfo").textContent = error.message;
  } finally {
    busy = false;
    $("startBtn").disabled = false;
    $("startBtn").textContent = "موافق — ابدأ البوت";
  }
};

$("stopBtn").onclick = async () => {
  $("stopBtn").disabled = true;

  try {
    const data = await api("/api/stop", {});
    $("botInfo").textContent = data.message;
    $("statusText").textContent = "جاهز";
    showResult(data.message);
  } catch (error) {
    showResult(error.message);
    $("stopBtn").disabled = false;
  }
};
