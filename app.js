let currentStep = 1;
let socket = null;

function goToStep(step) {
    document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.step-badge').forEach(el => el.classList.remove('active'));

    document.getElementById(`step-${step}`).classList.add('active');
    document.getElementById(`badge-${step}`).classList.add('active');
    currentStep = step;
}

async function fetchServerInfo() {
    const host = document.getElementById('server-ip').value.trim();
    const port = document.getElementById('server-port').value.trim();

    if (!host) {
        alert('يرجى كتابة عنوان السيرفر أولاً.');
        return;
    }

    goToStep(3);
    const card = document.getElementById('server-info-card');
    const connectBtn = document.getElementById('btn-connect');
    
    card.innerHTML = `<div class="loading">جاري الاتصال بالسيرفر وفحصه...</div>`;
    connectBtn.disabled = true;

    try {
        const res = await fetch('/api/check-server', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port })
        });
        const data = await res.json();

        if (data.success && data.online) {
            const iconSrc = data.icon || 'https://via.placeholder.com/64?text=Server';
            card.innerHTML = `
                <img src="${iconSrc}" alt="Server Icon">
                <div>
                    <h4 style="color:#38bdf8">${host}</h4>
                    <p style="font-size:0.85rem; color:#94a3b8">${data.motd}</p>
                    <p style="font-size:0.8rem; color:#4ade80">اللاعبين: ${data.players.online}/${data.players.max} | الإصدار: ${data.version.name || 'Auto'}</p>
                </div>
            `;
            connectBtn.disabled = false;
        } else {
            card.innerHTML = `<p style="color:#ef4444">السيرفر مغلق أو غير موجود.</p>`;
        }
    } catch (err) {
        card.innerHTML = `<p style="color:#ef4444">حدث خطأ أثناء جلب البيانات.</p>`;
    }
}

function connectBot() {
    const host = document.getElementById('server-ip').value.trim();
    const port = document.getElementById('server-port').value.trim();
    const username = document.getElementById('bot-username').value.trim();
    const version = document.getElementById('bot-version').value;
    const initialCommand = document.getElementById('bot-cmd').value.trim();
    const chatMessage = document.getElementById('bot-msg').value.trim();

    const consoleBox = document.getElementById('chat-console');
    consoleBox.innerHTML = '<div class="console-line text-subtle">جاري إنشاء الاتصال عبر WebSocket...</div>';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.onopen = () => {
        socket.send(JSON.stringify({
            action: 'start_bot',
            config: { host, port, username, version, initialCommand, chatMessage }
        }));
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const line = document.createElement('div');
        line.className = 'console-line';

        if (data.type === 'status') {
            line.style.color = '#38bdf8';
            line.textContent = `[نظام]: ${data.message}`;
        } else if (data.type === 'chat') {
            line.textContent = `<${data.author}> ${data.text}`;
        } else if (data.type === 'error') {
            line.style.color = '#ef4444';
            line.textContent = `[خطأ]: ${data.message}`;
        }

        consoleBox.appendChild(line);
        consoleBox.scrollTop = consoleBox.scrollHeight;
    };
}