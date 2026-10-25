/** Debug-only controls and a live annotated preview; video frames are never logged. */
function createDebugPanel({ app }) {
    const panel = document.getElementById('debug-panel');
    const canvas = document.getElementById('debug-camera');
    const ctx = canvas.getContext('2d');
    let lastDraw = -Infinity;

    function initializeDebugPanel() {
        if (!app.debug.enabled) return;
        panel.hidden = false;
        app.debug.subscribe(status => {
            const data = status.latest;
            document.getElementById('debug-summary').textContent = `${status.recording ? 'Recording' : 'Finished'} · ${status.events} events · ${status.dropped} dropped`;
            document.getElementById('debug-status').textContent =
                `${data.phase || 'Starting'} | detected ${data.detected ?? '?'} / expected ${data.expected ?? '?'}\n` +
                `${data.paused ? `PAUSED: ${data.reason}` : 'Running / preparing'}\n` +
                `Players: ${(data.statuses || []).join(', ') || 'not locked'} | inference ${data.inferenceMs ?? '?'} ms\n` +
                `Ignored candidates: ${(data.ignored || []).map(index => `C${index}`).join(', ') || 'none'}`;
            document.getElementById('debug-save-status').textContent = status.saveState;
            document.getElementById('debug-finish').disabled = !status.recording;
        });
        document.getElementById('debug-mark').addEventListener('click', () => {
            const note = document.getElementById('debug-note');
            app.debug.record('human.mark', { note: note.value.slice(0, 500), observed: app.debug.status().latest });
            note.value = '';
            app.debug.flushDebugLog();
        });
        document.getElementById('debug-finish').addEventListener('click', app.debug.finishDebugLog);
        document.getElementById('debug-download').addEventListener('click', app.debug.downloadDebugLog);
    }

    function drawDebugFrame(video, poses, report) {
        if (!app.debug.enabled || !app.debug.status().recording || performance.now() - lastDraw < 250) return;
        lastDraw = performance.now();
        canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth) || 240;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        poses.forEach((pose, index) => {
            const points = [11, 12, 23, 24].map(id => pose[id]).filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
            if (points.length !== 4) return;
            const player = (report.accepted || []).indexOf(index);
            const accepted = player >= 0;
            const x = Math.min(...points.map(point => point.x)) * canvas.width;
            const y = Math.min(...points.map(point => point.y)) * canvas.height;
            const width = (Math.max(...points.map(point => point.x)) - x / canvas.width) * canvas.width;
            const height = (Math.max(...points.map(point => point.y)) - y / canvas.height) * canvas.height;
            ctx.strokeStyle = accepted ? '#22c55e' : '#f59e0b';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, width, height);
            ctx.fillStyle = '#111827'; ctx.fillRect(x, Math.max(0, y - 16), 110, 16);
            ctx.fillStyle = accepted ? '#22c55e' : '#fbbf24'; ctx.font = '12px sans-serif';
            ctx.fillText(`C${index}${accepted ? ` → P${player + 1}` : report.ignored?.includes(index) ? ' ignored' : ' unmatched'}`, x + 2, Math.max(12, y - 3));
        });
    }

    return { initializeDebugPanel, drawDebugFrame };
}
