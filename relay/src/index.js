// The strike feed, borrowed onto our own origin.
//
// Blitzortung asks that a project using their data retrieve it from its own
// server rather than from theirs. Every open tab used to hold its own socket to
// `ws1.blitzortung.org`, so a hundred readers was a hundred connections to
// hardware that volunteers pay for; this holds exactly one, whatever the
// audience, and hands the frames on unchanged.
//
// A Durable Object because it is the only thing on this platform that is a
// singleton with a long-lived connection. A Worker is request-scoped and cannot
// hold a socket open between requests; a Pages Function cannot either, and
// cannot define one of these at all. So this deploys on its own, beside the
// site rather than inside it, and the page connects to it by hostname.
//
// One object for the whole world: `idFromName("world")`. That means every
// reader is served from wherever this object happens to live, which adds a
// hop's latency to the far side of the planet, against a feed whose own median
// delay from strike to browser is several seconds, and which is the figure the
// panel reports. It is not a cost worth splitting the object for.

// Reached across the project rather than copied in. The relay is deployed on
// its own, but the wire format and the decoder are the same two files the
// browser uses, and a format written out twice is a format that drifts.
import { decode } from "../../src/lib/lzw.js";
import { pack, unpack } from "../../src/lib/backfill.js";
import { createFilter } from "../../src/lib/repeat.js";

const HOSTS = ["ws1", "ws7", "ws8"];
const HELLO = JSON.stringify({ a: 111 }); // the subscription the feed expects

const RECONNECT_MS = 3000; // first retry; doubles from here
const MAX_RECONNECT_MS = 30000;

// Outbound sockets are the one thing the hibernation API does not cover: they
// keep this object in memory rather than letting it sleep, and they only do so
// for about fifteen minutes at a stretch. After that the object can be evicted
// and its upstream goes with it, silently, in the middle of the night. So it
// wakes itself to check on its own link.
const KEEPALIVE_MS = 10 * 60 * 1000;

// What a visitor is handed on arrival. Thirty minutes is what the instrument
// needs to be running rather than accumulating: see `backfill.js`.
const HISTORY_MS = 30 * 60 * 1000;
// A ceiling, for the nights the sky is busy. At the eight strikes a second this
// feed usually runs, half an hour is about fourteen thousand; this is room for
// four times that before the oldest are dropped early.
const MAX_HISTORY = 60000;
// Trimming is a filter over the whole window, so it is done on a slack rather
// than on every strike.
const TRIM_EVERY = 256;

// The half hour, written down.
//
// Memory alone survives a great deal and not a deploy: the object is replaced,
// its ring goes with it, and every visitor for the next half hour is handed a
// window that is shorter than the one before it. Storage outlives that, because
// it belongs to the object's name rather than to the instance holding it.
//
// Written in five-minute buckets rather than as one blob, and only the two the
// strikes are currently landing in. Rewriting the whole window every ten
// seconds would be four times the bytes for the same information, and a bucket
// is small enough to sit well inside a value's size limit however busy the sky
// is. Two of them, because the feed reports a strike up to twelve seconds late
// and one arriving just after a bucket rolls over belongs to the one before it.
const KEY = "h:";
const SAVE_EVERY_MS = 10000;
const BUCKET_MS = 5 * 60 * 1000;
// Buckets kept: the window, the one being filled, and one of slack.
const BUCKETS = Math.ceil(HISTORY_MS / BUCKET_MS) + 2;

export class Feed {
  constructor(state) {
    this.state = state;
    this.up = null;
    this.node = null;
    this.turn = Math.floor(Math.random() * HOSTS.length);
    this.failures = 0;
    this.history = [];
    this.since = 0;
    this.saved = 0;
    this.fresh = createFilter();
    // Before anything can be served from it. A reader arriving in the first
    // moments of a new instance is exactly the reader this is for, and handing
    // them an empty window while the read was still in flight would waste the
    // whole of it.
    this.state.blockConcurrencyWhile(() => this.restore());
  }

  async fetch(request) {
    if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
      return new Response("this endpoint is a websocket", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    // The hibernation API rather than `server.accept()`: readers are mostly
    // silent, and this is what lets the object sleep through a quiet upstream
    // without dropping everyone attached to it.
    this.state.acceptWebSocket(server);
    await this.ensure();
    this.tell(server);
    this.catchUp(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Brings the single upstream link up, if it is not already. */
  async ensure() {
    if (this.up) return true;

    const host = HOSTS[this.turn++ % HOSTS.length];
    let socket;
    try {
      // Not `new WebSocket()`: in this runtime an outbound socket comes back on
      // the response to an upgrade request, and there is no constructor for it.
      const answer = await fetch(`https://${host}.blitzortung.org:443/`, {
        headers: { Upgrade: "websocket" },
      });
      socket = answer.webSocket;
      if (!socket) throw new Error(`no socket on the upgrade (HTTP ${answer.status})`);
    } catch {
      await this.retry();
      return false;
    }

    socket.accept();
    socket.send(HELLO);
    this.up = socket;
    this.node = host;
    this.failures = 0;
    this.announce();

    // Passed on verbatim, and deliberately: the frames are compressed, the
    // browser already knows how to read them, and unpacking them to send them
    // on would multiply the bytes leaving here for work being done at the other
    // end anyway. The copy kept for the backfill is read rather than rewritten,
    // and what goes out to a live reader is still the frame that came in.
    socket.addEventListener("message", (event) => {
      this.keep(event.data);
      this.broadcast(event.data);
    });

    const gone = () => {
      if (this.up !== socket) return; // a link already replaced is not news
      this.up = null;
      this.node = null;
      this.announce();
      this.retry();
    };
    socket.addEventListener("close", gone);
    socket.addEventListener("error", gone);

    await this.state.storage.setAlarm(Date.now() + KEEPALIVE_MS);
    return true;
  }

  /**
   * Backoff, jittered, exactly as every tab used to do for itself.
   *
   * It matters more here than it did there. This is one client rather than one
   * per reader, so an outage no longer brings a retry from every open tab in
   * the world at once. But it is also the only client, and a tight loop from it
   * would be a tight loop against a volunteer's server with nothing else to
   * average it out.
   */
  retry() {
    this.failures++;
    const wait = Math.min(MAX_RECONNECT_MS, RECONNECT_MS * 2 ** (this.failures - 1));
    return this.state.storage.setAlarm(Date.now() + wait * (0.8 + Math.random() * 0.4));
  }

  async alarm() {
    // Nobody is listening: let the link go rather than hold a volunteer's
    // socket open for an empty room. The next reader brings it back, one
    // connection later.
    if (this.state.getWebSockets().length === 0) {
      this.drop();
      return;
    }
    if (await this.ensure()) {
      await this.state.storage.setAlarm(Date.now() + KEEPALIVE_MS);
    }
  }

  /**
   * One frame, filed for the visitor who has not arrived yet.
   *
   * Three fields of it. Which stations heard a strike is most of the frame and
   * none of the value here: it is a fact about the network at that second, the
   * browser reads it into a registry as the strike goes past, and a strike
   * being handed over half an hour late has nothing to add to it. Position and
   * time are what draw a map.
   */
  keep(frame) {
    if (typeof frame !== "string") return;
    let strike;
    try {
      strike = JSON.parse(decode(frame));
    } catch {
      return; // a frame we cannot read is not a strike we can keep
    }
    if (!Number.isFinite(strike.lat) || !Number.isFinite(strike.lon)) return;
    // The feed reports a strike more than once. A live reader filters its own
    // copy; without this the backfill would hand every visitor the repeats as
    // well, and they would arrive too close together for that filter's window
    // to be the thing that caught them.
    // Whole milliseconds, which is the resolution the wire format carries and
    // therefore the resolution the browser will key its own copy on. Two
    // strikes in the same millisecond at the same six decimals are one strike.
    const at = Math.round(strike.time / 1e6);
    if (!this.fresh(at, strike.lon, strike.lat)) return;
    this.history.push({ at, lon: strike.lon, lat: strike.lat });
    const now = Date.now();
    if (now - this.saved >= SAVE_EVERY_MS) this.save(now);
    if (++this.since < TRIM_EVERY) return;
    this.since = 0;
    this.trim();
  }

  /**
   * The window, as the last instance of this object left it.
   *
   * Order is not assumed: the buckets come back in key order, which is time
   * order, but the strikes inside one are in the order they arrived, and the
   * feed does not deliver them in the order they happened. Sorted once here so
   * that everything downstream can take the run as it finds it.
   */
  async restore() {
    try {
      const stored = await this.state.storage.list({ prefix: KEY });
      for (const value of stored.values()) {
        const part = unpack(value);
        if (part) for (const strike of part) this.history.push(strike);
      }
      this.history.sort((a, b) => a.at - b.at);
      // Re-seeded, so a strike restored from storage and then reported again by
      // the feed is still only handed over once.
      for (const strike of this.history) this.fresh(strike.at, strike.lon, strike.lat);
      this.trim();
    } catch {
      // A window that cannot be read is a window this instance does not have.
      // It refills in half an hour, which is the same place a deploy left it
      // before any of this existed.
      this.history = [];
    }
  }

  /**
   * The buckets the strikes are currently landing in, written down.
   *
   * Fire and forget: a write that fails costs this instance nothing it still
   * needs, and holding a frame up to wait for one would put storage latency in
   * front of the feed for every reader.
   */
  save(now) {
    this.saved = now;
    const bucket = Math.floor(now / BUCKET_MS);
    const from = (bucket - 1) * BUCKET_MS;
    const recent = this.history.filter((strike) => strike.at >= from);
    const entries = {};
    entries[KEY + (bucket - 1)] = pack(recent.filter((strike) => strike.at < bucket * BUCKET_MS));
    entries[KEY + bucket] = pack(recent.filter((strike) => strike.at >= bucket * BUCKET_MS));
    this.state.storage.put(entries).catch(() => {});
    // One bucket beyond the window, dropped as it falls out. Cheaper than
    // listing the store to find what has expired, and there is only ever one.
    this.state.storage.delete(KEY + (bucket - BUCKETS)).catch(() => {});
  }

  /** Drops what has fallen out of the window, and the excess of a busy night. */
  trim() {
    const cutoff = Date.now() - HISTORY_MS;
    // Strikes are filed in arrival order, so the window is a suffix and the
    // filter is only ever walking to the first one that is still inside it.
    if (this.history.length && this.history[0].at < cutoff) {
      this.history = this.history.filter((strike) => strike.at >= cutoff);
    }
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
  }

  /**
   * The half hour, to one reader who has just arrived.
   *
   * Sent as bytes, which is also how this object talks about itself, and told
   * apart from that by the four bytes it starts with rather than by its shape.
   * Sent before anything live, so the browser has somewhere to put the first
   * strike off the wire.
   */
  catchUp(reader) {
    this.trim();
    if (!this.history.length) return;
    try {
      // Sorted, because the ring is in the order the frames turned up and that
      // is not the order the strikes happened in: the feed reports a strike
      // anything from two to twelve seconds late, so arrivals overtake each
      // other by seconds. Everything at the other end reads this as a run in
      // time order, and the format has no room for an offset before its own
      // anchor. Nearly-sorted already, and done once per visitor.
      reader.send(pack([...this.history].sort((a, b) => a.at - b.at)));
    } catch {
      /* gone before it could be caught up */
    }
  }

  broadcast(frame) {
    for (const reader of this.state.getWebSockets()) {
      // A reader going away mid-send is the ordinary way a tab closes, not a
      // fault worth failing the broadcast to everybody else over.
      try {
        reader.send(frame);
      } catch {
        /* gone */
      }
    }
  }

  /**
   * Which upstream node is being heard, and whether it is up.
   *
   * Binary, where the strike frames are text, because that is the one way to
   * tell them apart that cannot be confused by their contents: a compressed
   * frame is arbitrary text and any marker inside one could in principle occur
   * in the other. The reader checks the type of the message, not its shape.
   */
  tell(reader) {
    const state = JSON.stringify({ node: this.node, live: Boolean(this.up) });
    try {
      reader.send(new TextEncoder().encode(state));
    } catch {
      /* gone */
    }
  }

  announce() {
    for (const reader of this.state.getWebSockets()) this.tell(reader);
  }

  drop() {
    if (!this.up) return;
    const socket = this.up;
    this.up = null;
    this.node = null;
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }

  webSocketClose(reader) {
    // The closing socket may still be listed, so it is excluded by identity
    // rather than by reading a ready state off it.
    if (this.state.getWebSockets().every((other) => other === reader)) this.drop();
  }

  webSocketError(reader) {
    this.webSocketClose(reader);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/feed") return new Response("not here", { status: 404 });

    // Who may hold this open. Unset, it answers anyone, which is what a local
    // `wrangler dev` wants and what a public deployment does not: this exists
    // to keep one connection on a volunteer's server, and an open relay in
    // front of it would hand that property back to whoever found the hostname.
    const allowed = (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (allowed.length) {
      const origin = request.headers.get("Origin");
      if (!origin || !allowed.includes(origin)) {
        return new Response("not an origin this relay carries", { status: 403 });
      }
    }

    // One object, named, for everybody: the whole point is a single upstream.
    return env.FEED.get(env.FEED.idFromName("world")).fetch(request);
  },
};
