import { memo, useEffect } from "react";

const HOSTS = ["ws1", "ws7", "ws8"];
const DOMAIN = ".blitzortung.org:443/";
const RECONNECT_MS = 3000;
const GIVE_UP_AFTER = 4; // failed attempts before the feed is reported down

// blitzortung streams LZW-compressed JSON frames
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
    a = h > a ? String.fromCharCode(a) : e[a] || f + c;
    g.push(a);
    c = a[0];
    e[o] = f + c;
    o++;
    f = a;
  }
  return g.join("");
}

/**
 * Headless component: owns the websocket and pushes strikes upward.
 * `onDataReceived` and `onStatus` must be referentially stable, or the effect
 * tears the socket down and reconnects on every parent render.
 */
function Seeker({ onDataReceived, onStatus }) {
  useEffect(() => {
    let socket = null;
    let retry = null;
    let cancelled = false;
    let failures = 0;

    let host = null;
    const report = (phase, message) => {
      if (!cancelled) onStatus?.({ phase, message, host });
    };

    const connect = () => {
      if (cancelled) return;
      host = HOSTS[Math.floor(Math.random() * HOSTS.length)];
      report("connecting", `connecting to ${host}...`);

      const ws = new WebSocket(`wss://${host}${DOMAIN}`);
      socket = ws;

      ws.onopen = () => {
        failures = 0;
        report("live", `receiving from ${host}`);
        ws.send(JSON.stringify({ a: 111 })); // hi
      };

      ws.onmessage = (event) => {
        try {
          const { time, delay, lon, lat } = JSON.parse(decode(event.data));
          const date = new Date(time / 1000000);
          // UTC, matching the footer clock. Local time would be the viewer's,
          // which says nothing useful about a strike over Java.
          const formattedTime = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
            .map((n) => String(n).padStart(2, "0"))
            .join(":");
          onDataReceived?.({ formattedTime, delay, lon, lat });
        } catch (err) {
          console.error("Error parsing message:", err);
        }
      };

      ws.onerror = () => report("error", "link error");

      ws.onclose = () => {
        // Ignore closes from sockets we've already replaced or unmounted, so a
        // flapping connection can't stack up several reconnect timers.
        if (cancelled || socket !== ws) return;
        failures++;
        if (failures >= GIVE_UP_AFTER) {
          report("down", `no response from the network after ${failures} attempts — still trying`);
        } else {
          report("connecting", "relinking...");
        }
        retry = setTimeout(connect, RECONNECT_MS);
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      if (!socket) return;

      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;

      if (socket.readyState === WebSocket.CONNECTING) {
        // Closing mid-handshake makes the browser log a failure. Let the
        // handshake finish and drop the socket on open instead; if it never
        // opens it fails on its own and is collected either way.
        socket.onopen = () => socket.close();
      } else {
        socket.close();
      }
    };
  }, [onDataReceived, onStatus]);

  return null;
}

// Renders nothing, but sits in the tree: without this it reconciles on
// every tick of the feed for no reason at all.
export default memo(Seeker);
