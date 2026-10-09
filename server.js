const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mineflayer = require('mineflayer');
const mcs = require('mc-server-status');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// Serve static files directly from root directory
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));

// API check server status
app.post('/api/check-server', async (req, res) => {
    const { host, port } = req.body;
    try {
        const response = await mcs.getBedrockOrJava(host, parseInt(port) || 25565);
        res.json({
            success: true,
            online: response.online,
            players: response.players,
            version: response.version,
            icon: response.icon || null,
            motd: response.motd ? response.motd.clean : 'No description'
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'تعذر الاتصال بالسيرفر أو جلب البيانات.' });
    }
});

// WebSocket Bot Handling
wss.on('connection', (ws) => {
    let bot = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.action === 'start_bot') {
            const { host, port, username, version, initialCommand, chatMessage } = data.config;

            ws.send(JSON.stringify({ type: 'status', message: 'جاري الاتصال بالسيرفر...' }));

            const botOptions = {
                host: host,
                port: parseInt(port) || 25565,
                username: username || 'WebBot',
                auth: 'offline'
            };

            if (version && version !== 'auto') {
                botOptions.version = version;
            }

            bot = mineflayer.createBot(botOptions);

            bot.on('login', () => {
                ws.send(JSON.stringify({ type: 'status', message: 'تم دخول البوت بنجاح!' }));
                
                if (initialCommand) {
                    setTimeout(() => {
                        bot.chat(initialCommand.startsWith('/') ? initialCommand : `/${initialCommand}`);
                    }, 2000);
                }

                if (chatMessage) {
                    setTimeout(() => {
                        bot.chat(chatMessage);
                    }, 3500);
                }
            });

            bot.on('chat', (username, message) => {
                ws.send(JSON.stringify({ type: 'chat', author: username, text: message }));
            });

            bot.on('kicked', (reason) => {
                ws.send(JSON.stringify({ type: 'status', message: `تم طرد البوت: ${reason}` }));
            });

            bot.on('error', (err) => {
                ws.send(JSON.stringify({ type: 'error', message: `خطأ: ${err.message}` }));
            });

            bot.on('end', () => {
                ws.send(JSON.stringify({ type: 'status', message: 'انقطع الاتصال بالسيرفر.' }));
            });
        }

        if (data.action === 'stop_bot' && bot) {
            bot.quit();
            ws.send(JSON.stringify({ type: 'status', message: 'تم إيقاف البوت.' }));
        }
    });

    ws.on('close', () => {
        if (bot) bot.quit();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
