/** Calibration-only camera annotations; input owns selection and readiness. */
function createCalibrationPreview({ app }) {
    function drawCalibrationOverlay(ctx, width, height) {
        const view = app.calibration.calibrationView();
        const copy = app.localization.translations[document.getElementById('lang-select').value].calibration;
        const fontSize = Math.max(18, Math.round(width / 32));
        ctx.save();
        // The image canvas is mirrored by CSS. Counter-mirror annotations so
        // player labels read normally while their boxes follow the raw poses.
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.lineWidth = Math.max(2, width / 240);
        function label(text, x, y, color) {
            const textWidth = ctx.measureText(text).width;
            x = Math.max(4, Math.min(x, width - textWidth - 16));
            y = Math.max(4, Math.min(y, height - fontSize - 12));
            ctx.fillStyle = '#111827';
            ctx.fillRect(x, y, textWidth + 12, fontSize + 8);
            ctx.fillStyle = color;
            ctx.fillText(text, x + 6, y + 4);
        }
        view.zones.forEach((zone, index) => {
            const x = (1 - zone[1]) * width;
            const player = view.players[index];
            const color = player?.reason ? '#fbbf24' : player?.phase === 'ready' ? '#4ade80' : '#67e8f9';
            ctx.strokeStyle = color;
            ctx.setLineDash([8, 6]);
            ctx.strokeRect(x, height * 0.12, (zone[1] - zone[0]) * width, height * 0.8);
            label(copy.player.replace('{number}', index + 1), x, height * 0.02, color);
            if (!player?.bounds) return;
            const box = player.bounds;
            const left = Math.max(0, (1 - box.right - 0.025) * width);
            const top = Math.max(0, (box.y - 0.025) * height);
            ctx.setLineDash([]);
            ctx.strokeRect(left, top, (box.right - box.x + 0.05) * width, (box.bottom - box.y + 0.05) * height);
            label(copy.selection[player.reason ? 'paused' : player.phase === 'ready' ? 'ready' : 'selected'],
                left, (box.bottom + 0.035) * height, color);
        });
        ctx.restore();
    }
    return { drawCalibrationOverlay };
}
