from flask import Flask, render_template, request, jsonify
from mcstatus import JavaServer
import base64
import re

app = Flask(__name__)


def valid_host(host):
    if not host or len(host) > 253:
        return False

    # Domain / IPv4 / localhost
    pattern = r"^[a-zA-Z0-9.-]+$"
    return re.match(pattern, host) is not None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status", methods=["POST"])
def status():
    data = request.get_json(silent=True) or {}

    host = str(data.get("host", "")).strip()
    port = data.get("port", 25565)

    try:
        port = int(port)
    except:
        return jsonify({
            "success": False,
            "error": "البورت غير صحيح"
        }), 400

    if not valid_host(host):
        return jsonify({
            "success": False,
            "error": "IP أو Domain غير صحيح"
        }), 400

    if port < 1 or port > 65535:
        return jsonify({
            "success": False,
            "error": "البورت يجب أن يكون بين 1 و 65535"
        }), 400

    try:
        server = JavaServer.lookup(f"{host}:{port}")

        status = server.status()

        icon = None

        if status.icon:
            if status.icon.startswith("data:image"):
                icon = status.icon
            else:
                icon = status.icon

        players = status.players

        return jsonify({
            "success": True,
            "host": host,
            "port": port,
            "online": True,
            "motd": status.description,
            "version": status.version.name,
            "protocol": status.version.protocol,
            "players": players.online,
            "max_players": players.max,
            "latency": round(status.latency),
            "favicon": icon
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "online": False,
            "error": "تعذر الاتصال بالسيرفر"
        })


@app.route("/api/connect", methods=["POST"])
def connect():
    data = request.get_json(silent=True) or {}

    host = str(data.get("host", "")).strip()
    port = data.get("port")
    username = str(data.get("username", "")).strip()
    version = str(data.get("version", "")).strip()
    command = str(data.get("command", "")).strip()
    message = str(data.get("message", "")).strip()

    if not host or not port or not username:
        return jsonify({
            "success": False,
            "error": "يرجى تعبئة البيانات المطلوبة"
        }), 400

    # هنا يتم ربط Minecraft Bot لاحقًا.
    # Python لا يستطيع وحده محاكاة جميع إصدارات Minecraft الحديثة
    # بشكل موثوق باستخدام Flask فقط.

    return jsonify({
        "success": True,
        "message": "تم قبول إعدادات الحساب",
        "bot": {
            "host": host,
            "port": port,
            "username": username,
            "version": version,
            "command": command,
            "message": message
        }
    })


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )