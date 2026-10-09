
const express = require("express");
const mineflayer = require("mineflayer");
const mc = require("minecraft-protocol");
const dns = require("node:dns").promises;
const net = require("node:net");

const app = express();
app.use(express.json({ limit: "10kb" }));
app.use(express.static(__dirname, { index: "index.html" }));

let bot = null;
let botState = "idle";

function validateHost(host) {
  if (typeof host !== "string" || host.length > 253) {
    throw new Error("عنوان السيرفر غير صالح.");
  }

  host = host.trim();

  if (
    !host ||
    /[\s/\\]/.test(host) ||
    host.startsWith(".") ||
    host.endsWith(".")
  ) {
    throw new Error("أدخل IP أو Domain صحيحًا.");
  }

  if (net.isIP(host)) {
    const parts = host.split(".").map(Number);
    const isPrivateIPv4 = net.isIPv4(host) && (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0
    );

    if (isPrivateIPv4 || net.isIPv6(host)) {
      throw new Error("هذا العنوان غير مسموح به في هذه النسخة.");
    }
  } else if (!/^(?=.{1,253}$)[a-zA-Z0-9.-]+$/.test(host)) {
    throw new Error("اسم النطاق غير صالح.");
  }

  return host;
}

async function publicHost(host) {
  host = validateHost(host);

  if (net.isIP(host)) return host;

  const records = await dns.lookup(host, { all: true });

  if (!records.length) throw new Error("تعذر العثور على عنوان السيرفر.");

  for (const record of records) {
    const address = record.address;

    if (net.isIPv4(address)) {
      const p = address.split(".").map(Number);

      if (
        p[0] === 10 || p[0] === 127 ||
        (p[0] === 192 && p[1] === 168) ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
        (p[0] === 169 && p[1] === 254) ||
        p[0] === 0
      ) throw new Error("عنوان السيرفر يشير إلى شبكة خاصة.");
    } else {
      const normalized = address.toLowerCase();

      if (
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80:")
      ) throw new Error("عنوان السيرفر يشير إلى شبكة خاصة.");
    }
  }

  return host;
}

function validatePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("المنفذ غير صالح.");
  }

  return port;
}

app.post("/api/status", async (req, res) => {
  try {
    const host = await publicHost(req.body.host);
    const port = validatePort(Number(req.body.port));

    mc.ping({ host, port, closeTimeout: 3000 }, (err, result) => {
      if (err || !result) {
        return res.status(502).json({
          error: "تعذر الوصول إلى السيرفر. تحقق من العنوان والمنفذ."
        });
      }

      const players = result.players || {};
      const description = result.description;

      let motd = "";

      if (typeof description === "string") {
        motd = description;
      } else if (description && typeof description.text === "string") {
        motd = description.text;
      } else if (description && Array.isArray(description.extra)) {
        motd = description.extra.map(x => x.text || "").join("");
      }

      res.json({
        motd,
        version: result.version?.name || "غير معروف",
        playersOnline: players.online,
        playersMax: players.max,
        favicon: typeof result.favicon === "string" &&
          result.favicon.startsWith("data:image/")
          ? result.favicon
          : null
      });
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/start", async (req, res) => {
  try {
    if (bot && botState !== "ended") {
      return res.status(409).json({
        error: "يوجد بوت يعمل بالفعل. أوقفه قبل بدء بوت جديد."
      });
    }

    const host = await publicHost(req.body.host);
    const port = validatePort(Number(req.body.port));
    const username = String(req.body.username || "");

    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      throw new Error("اسم الحساب غير صالح.");
    }

    const command = String(req.body.command || "").trim();
    const message = String(req.body.message || "").trim();
    let version = req.body.version;

    if (version === "auto") version = false;

    if (version && !/^1\.21(?:\.\d+)?$/.test(version)) {
      throw new Error("الإصدار غير مدعوم في هذه النسخة.");
    }

    if (command.length > 256 || message.length > 256) {
      throw new Error("الأمر أو الرسالة أطول من المسموح.");
    }

    botState = "connecting";

    bot = mineflayer.createBot({
      host,
      port,
      username,
      auth: "offline",
      version: version || false,
      hideErrors: false
    });

    const thisBot = bot;

    thisBot.once("spawn", () => {
      if (bot !== thisBot) return;

      botState = "online";

      setTimeout(() => {
        if (bot !== thisBot || botState !== "online") return;

        if (command) {
          thisBot.chat(command.startsWith("/")
            ? command.slice(1)
            : command);
        }

        if (message) {
          thisBot.chat(message);
        }
      }, 1200);
    });

    thisBot.on("end", () => {
      if (bot === thisBot) {
        botState = "ended";
        bot = null;
      }
    });

    thisBot.on("error", error => {
      console.error("Minecraft bot error:", error.message);

      if (bot === thisBot) {
        botState = "ended";
      }
    });

    res.json({
      message: "تم بدء الاتصال. انتظر حتى يدخل البوت إلى السيرفر."
    });
  } catch (error) {
    botState = "ended";
    bot = null;
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/stop", (req, res) => {
  if (bot) {
    const oldBot = bot;
    bot = null;
    botState = "ended";

    try {
      oldBot.quit("Bot stopped from control panel");
    } catch (_) {}
  }

  res.json({ message: "تم طلب إيقاف البوت." });
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CraftBot panel running on port ${PORT}`);
});
