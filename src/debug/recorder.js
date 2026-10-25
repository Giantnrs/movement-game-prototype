/** Opt-in, bounded diagnostic records. No camera images or audio are stored. */
function createDebugRecorder({ state }) {
    const enabled = new URLSearchParams(window.location.search).get('debug') === '1';
    const MAX_EVENTS = 2000, MAX_SIZE = 800000;
    const entries = [], sampledAt = new Map(), transitions = new Map(), listeners = new Set();
    let recording = enabled, bytes = 0, dropped = 0, sequence = 0, revision = 0, savedRevision = -1;
    let lastStatus = -Infinity;
    let latest = {}, saveState = 'Not saved yet', inFlight = null, timer;
    const sessionId = enabled ? crypto.randomUUID() : null;
    const startedAt = enabled ? new Date().toISOString() : null;
    const startedMs = enabled ? performance.now() : 0;
    const localServer = enabled && ['http:', 'https:'].includes(window.location.protocol) &&
        ['127.0.0.1', 'localhost'].includes(window.location.hostname);

    function status() { return { enabled, recording, sessionId, events: entries.length, dropped, saveState, latest }; }
    function notify() { for (const listener of listeners) listener(status()); }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }

    function record(type, data = {}) {
        if (!recording) return;
        const event = { seq: ++sequence, ms: Math.round(performance.now() - startedMs),
            at: new Date().toISOString(), type, data: JSON.parse(JSON.stringify(data)) };
        const size = JSON.stringify(event).length * 2;
        if (size > MAX_SIZE) { dropped++; return; }
        entries.push({ event, size });
        bytes += size;
        while (entries.length > MAX_EVENTS || bytes > MAX_SIZE) { bytes -= entries.shift().size; dropped++; }
        revision++;
        notify();
    }

    function sample(type, data, interval = 250) {
        if (!recording) return;
        const now = performance.now();
        if (sampledAt.has(type) && now - sampledAt.get(type) < interval) return;
        sampledAt.set(type, now);
        record(type, data);
    }

    function transition(type, signature, data) {
        if (!recording || transitions.get(type) === signature) return;
        transitions.set(type, signature);
        record(type, data);
    }

    function setDebugStatus(value) {
        if (!recording) return;
        if (performance.now() - lastStatus < 250 && value.reason === latest.reason && value.phase === latest.phase && value.detected === latest.detected) return;
        lastStatus = performance.now();
        latest = JSON.parse(JSON.stringify(value));
        notify();
    }

    function debugSnapshot() {
        return { schemaVersion: 1, app: 'active-runner', sessionId, startedAt,
            buildId: typeof GAME_BUILD_ID === 'string' ? GAME_BUILD_ID : 'unbundled',
            environment: { userAgent: navigator.userAgent, origin: window.location.origin,
                path: window.location.pathname, width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
            limits: { maxEvents: MAX_EVENTS, maxApproxBytes: MAX_SIZE, telemetryIntervalMs: 250 },
            droppedEvents: dropped, latest, events: entries.map(entry => entry.event) };
    }

    function remember(text) {
        try { localStorage.setItem('active_runner_debug_last_session', text); }
        catch { saveState = 'Browser storage unavailable; use Download log.'; }
    }

    function flushDebugLog() {
        if (!enabled) return Promise.resolve();
        const text = JSON.stringify(debugSnapshot());
        remember(text);
        if (inFlight) return inFlight;
        if (!localServer) { saveState = 'Browser copy saved; use Download log.'; notify(); return Promise.resolve(); }
        if (savedRevision === revision) return Promise.resolve();
        const savingRevision = revision;
        inFlight = fetch('/__debug/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })
            .then(async response => {
                if (!response.ok) throw Error(`HTTP ${response.status}`);
                const result = await response.json();
                savedRevision = savingRevision;
                saveState = `Saved: ${result.file}`;
            }).catch(error => { saveState = `Auto-save failed (${error.message}); use Download log.`; })
            .finally(() => { inFlight = null; notify(); });
        return inFlight;
    }

    async function finishDebugLog() {
        if (!enabled) return;
        record('human.finish', { phase: state.game.gameState });
        recording = false;
        clearInterval(timer);
        if (inFlight) await inFlight;
        await flushDebugLog();
        notify();
    }

    function downloadDebugLog() {
        if (!enabled) return;
        const text = JSON.stringify(debugSnapshot(), null, 2);
        remember(text);
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `active-runner-debug-${sessionId}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function initializeDebug() {
        if (!enabled) return;
        record('debug.start', { detectionLimit: 4, data: 'landmarks and events; no video/audio' });
        timer = setInterval(flushDebugLog, 2000);
        window.addEventListener('pagehide', () => remember(JSON.stringify(debugSnapshot())));
        window.addEventListener('error', event => record('runtime.error', { message: event.message, file: event.filename, line: event.lineno }));
        window.addEventListener('unhandledrejection', event => record('runtime.rejection', { message: String(event.reason) }));
    }

    return { enabled, record, sample, transition, setDebugStatus, status, subscribe, debugSnapshot,
        flushDebugLog, finishDebugLog, downloadDebugLog, initializeDebug };
}
