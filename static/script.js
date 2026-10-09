let currentPage = 1;

let serverData = null;


function showPage(page) {

    currentPage = page;

    document.querySelectorAll(".page").forEach(element => {
        element.classList.remove("active");
    });

    document
        .getElementById(`page${page}`)
        .classList.add("active");


    document.querySelectorAll(".step").forEach(step => {

        const number =
            Number(step.dataset.step);

        step.classList.toggle(
            "active",
            number <= page
        );

    });

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


function goStep2() {

    const host =
        document.getElementById("host").value.trim();

    const port =
        document.getElementById("port").value.trim();


    if (!host) {
        alert("اكتب IP أو Domain السيرفر");
        return;
    }

    if (!port) {
        alert("اكتب Port السيرفر");
        return;
    }

    showPage(2);
}


async function checkServer() {

    const host =
        document.getElementById("host").value.trim();

    const port =
        document.getElementById("port").value.trim();

    const username =
        document.getElementById("username").value.trim();


    if (!username) {
        alert("اكتب اسم الحساب");
        return;
    }


    showPage(3);


    const loading =
        document.getElementById("loading");

    const serverInfo =
        document.getElementById("serverInfo");

    const errorBox =
        document.getElementById("errorBox");

    const connectButton =
        document.getElementById("connectButton");


    loading.classList.remove("hidden");
    serverInfo.classList.add("hidden");
    errorBox.classList.add("hidden");

    connectButton.disabled = true;


    try {

        const response =
            await fetch("/api/status", {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    host,
                    port
                })

            });


        const data =
            await response.json();


        if (!data.success) {

            throw new Error(
                data.error ||
                "تعذر العثور على السيرفر"
            );

        }


        serverData = data;


        document.getElementById(
            "serverAddress"
        ).textContent =
            `${host}:${port}`;


        document.getElementById(
            "serverVersion"
        ).textContent =
            data.version || "Unknown";


        document.getElementById(
            "players"
        ).textContent =
            `${data.players} / ${data.max_players}`;


        document.getElementById(
            "ping"
        ).textContent =
            `${data.latency} ms`;


        document.getElementById(
            "motd"
        ).textContent =
            cleanMotd(data.motd);


        document.getElementById(
            "accountName"
        ).textContent =
            username;


        document.getElementById(
            "accountVersion"
        ).textContent =
            document.getElementById(
                "version"
            ).value;


        const icon =
            document.getElementById(
                "serverIcon"
            );


        if (data.favicon) {

            icon.src =
                data.favicon;

        } else {

            icon.src =
                createDefaultIcon();

        }


        loading.classList.add("hidden");

        serverInfo.classList.remove("hidden");

        connectButton.disabled = false;

    }

    catch (error) {

        loading.classList.add("hidden");

        errorBox.textContent =
            error.message;

        errorBox.classList.remove("hidden");

    }
}


function cleanMotd(motd) {

    if (!motd) {
        return "No MOTD";
    }

    if (typeof motd === "string") {
        return motd
            .replace(/§[0-9a-fk-or]/gi, "");
    }

    if (motd.text) {
        return motd.text;
    }

    return "Minecraft Server";
}


function createDefaultIcon() {

    return "data:image/svg+xml," +
        encodeURIComponent(`
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="128"
                height="128"
            >
                <rect
                    width="128"
                    height="128"
                    rx="20"
                    fill="#171b24"
                />

                <text
                    x="50%"
                    y="55%"
                    dominant-baseline="middle"
                    text-anchor="middle"
                    fill="white"
                    font-size="35"
                    font-family="Arial"
                >
                    MC
                </text>
            </svg>
        `);
}


async function connectBot() {

    const button =
        document.getElementById(
            "connectButton"
        );


    const host =
        document.getElementById(
            "host"
        ).value.trim();


    const port =
        document.getElementById(
            "port"
        ).value.trim();


    const username =
        document.getElementById(
            "username"
        ).value.trim();


    const version =
        document.getElementById(
            "version"
        ).value;


    const command =
        document.getElementById(
            "command"
        ).value.trim();


    const message =
        document.getElementById(
            "message"
        ).value.trim();


    button.disabled = true;

    button.textContent =
        "جاري تشغيل الحساب...";


    try {

        const response =
            await fetch("/api/connect", {

                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    host,
                    port,
                    username,
                    version,
                    command,
                    message

                })

            });


        const data =
            await response.json();


        if (!data.success) {
            throw new Error(
                data.error ||
                "حدث خطأ"
            );
        }


        button.textContent =
            "تم قبول الإعدادات ✓";


        alert(
            "تم إرسال إعدادات الحساب بنجاح."
        );

    }

    catch (error) {

        alert(error.message);

        button.disabled = false;

        button.textContent =
            "موافق ودخول";

    }
}