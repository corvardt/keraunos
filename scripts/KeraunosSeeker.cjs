const WebSocket = require('ws');

// private decoding function for blitzortung
function decode(b) {
    let e = {};
    let d = Array.from(b);
    let c = d[0];
    let f = c;
    let g = [c];
    let h = 256;
    let o = h;
    for (let i = 1; i < d.length; i++) {
        let a = d[i].charCodeAt ? d[i].charCodeAt(0) : d[i];
        a = h > a ? String.fromCharCode(a) : (e[a] || (f + c));
        g.push(a);
        c = a[0];
        e[o] = f + c;
        o++;
        f = a;
    }
    return g.join('');
}


const RECONNECT_MS = 5000;

function connect() {
    const hosts = ["ws1", "ws7", "ws8"];
    const host = hosts[Math.floor(Math.random() * hosts.length)];
    const wsUrl = `wss://${host}.blitzortung.org:443/`;

    return new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };

        try {
            console.log(`connecting to ${wsUrl}...`);
            const ws = new WebSocket(wsUrl);

            ws.on('open', () => {
                console.log('connected');
                ws.send(JSON.stringify({ a: 111 }));
            });

            ws.on('message', (data) => {
                try {
                    const decoded = decode(data.toString());
                    const message = JSON.parse(decoded);

                    const time = message.time
                    const delay = message.delay;
                    const lon = message.lon
                    const lat = message.lat
                    const date = new Date(time / 1000000);                   
                    const hours = date.getHours();   
                    const minutes = date.getMinutes();
                    const seconds = date.getSeconds(); 
                    const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

                    console.log(formattedTime,delay, "Long:", lon, "Lat:", lat);
                    
                } catch (err) {
                    console.error('error parsing message:', err);
                }
            });

            ws.on('close', () => {
                console.log('connection closed');
                finish();
            });

            ws.on('error', (err) => {
                console.error('connection error:', err.message);
                finish();
            });
        } catch (err) {
            console.error('connection error:', err);
            finish();
        }
    });
}

async function main() {
    // Reconnect forever: each connect() settles once the socket closes or errors.
    for (;;) {
        await connect();
        console.log(`reconnecting in ${RECONNECT_MS / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
    }
}

main().catch(console.error);
