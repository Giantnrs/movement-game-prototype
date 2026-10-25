/** Frozen result photo presentation; camera inference and game rules stay elsewhere. */
function createFinishPhoto({ state, app }) {
    const layout = document.getElementById('game-over-layout');
    const stats = document.getElementById('game-over-screen');
    const single = document.getElementById('finish-photo-single');
    const dialog = document.getElementById('finish-photo-dialog');
    const closeButton = document.getElementById('finish-photo-close');
    const canvases = [document.getElementById('finish-photo-single-canvas'), document.getElementById('finish-photo-dual-canvas')];
    const exposureGain = 2 ** 0.7;
    // Apply photographic exposure in linear light, then return to sRGB.
    const exposureLut = Uint8ClampedArray.from({ length: 256 }, (_, value) => {
        const srgb = value / 255;
        const linear = (srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4) * exposureGain;
        const exposed = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, exposed) * 255);
    });
    let anchors = [];

    function exposeCameraFrame(ctx, width, height) {
        const frame = ctx.getImageData(0, 0, width, height);
        for (let index = 0; index < frame.data.length; index += 4) {
            frame.data[index] = exposureLut[frame.data[index]];
            frame.data[index + 1] = exposureLut[frame.data[index + 1]];
            frame.data[index + 2] = exposureLut[frame.data[index + 2]];
        }
        ctx.putImageData(frame, 0, 0);
    }

    function observeFinishPlayers(poses) {
        if (state.game.gameState !== 'playing') return;
        anchors = poses.map(pose => {
            const valid = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
                && (point.visibility ?? 1) >= 0.6 && (point.presence ?? 1) >= 0.6;
            if (!pose || ![11, 12, 23, 24].every(id => valid(pose[id]))) return null;
            const shoulderX = (pose[11].x + pose[12].x) / 2;
            const shoulderY = (pose[11].y + pose[12].y) / 2;
            const torso = Math.abs((pose[23].y + pose[24].y) / 2 - shoulderY);
            const face = [0, 2, 5].map(id => pose[id]).filter(valid);
            return { x: face.length ? face.reduce((sum, p) => sum + p.x, 0) / face.length : shoulderX,
                y: face.length ? Math.min(...face.map(p => p.y)) - torso * 0.18 : shoulderY - torso * 0.5,
                width: Math.max(0.06, Math.min(0.2, Math.abs(pose[11].x - pose[12].x) * 0.75)), at: performance.now() };
        });
    }

    function drawCrown(ctx, anchor, width, height) {
        const size = width * anchor.width;
        const x = Math.max(size / 2, Math.min(width - size / 2, (1 - anchor.x) * width));
        const y = Math.max(size * 0.65, Math.min(height - 8, anchor.y * height));
        ctx.save();
        ctx.translate(x - size / 2, y - size * 0.6);
        ctx.scale(size, size);
        ctx.shadowColor = '#422006'; ctx.shadowBlur = 5;
        ctx.fillStyle = '#facc15'; ctx.strokeStyle = '#854d0e'; ctx.lineWidth = 0.035;
        ctx.beginPath(); ctx.moveTo(0.1, 0.55); ctx.lineTo(0, 0.06); ctx.lineTo(0.28, 0.28);
        ctx.lineTo(0.5, 0); ctx.lineTo(0.72, 0.28); ctx.lineTo(1, 0.06); ctx.lineTo(0.9, 0.55);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0; ctx.fillStyle = '#f59e0b'; ctx.fillRect(0.1, 0.45, 0.8, 0.12);
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(0.5, 0.38, 0.06, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    function closeFinishPhoto() {
        if (!dialog.open) return;
        dialog.close();
        if (state.game.gameState === 'gameover') {
            stats.classList.remove('hidden');
            document.getElementById('restart-btn').focus({ preventScroll: true });
        }
        canvases[1].width = canvases[1].height = 0;
    }

    function resetFinishPhoto() {
        if (dialog.open) dialog.close();
        single.hidden = true;
        layout.classList.remove('has-finish-photo');
        anchors = [];
        for (const canvas of canvases) canvas.width = canvas.height = 0;
    }

    function showFinishPhoto(winnerIndex = null) {
        if (state.game.gameState !== 'gameover') return false;
        layout.classList.remove('hidden');
        const video = app.camera.videoElement;
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight || video.ended) return false;
        const dual = state.session.numPlayers === 2;
        const canvas = canvases[dual ? 1 : 0];
        // Bound memory while keeping the full camera frame and its aspect ratio.
        const scale = Math.min(1, 1280 / video.videoWidth, 1280 / video.videoHeight);
        const width = Math.round(video.videoWidth * scale);
        const height = Math.round(width * video.videoHeight / video.videoWidth);
        const footer = Math.max(140, Math.round(width * 0.24));
        const finishedAt = new Date();
        const dateStamp = [String(finishedAt.getDate()).padStart(2, '0'),
            String(finishedAt.getMonth() + 1).padStart(2, '0'), finishedAt.getFullYear()].join('/');
        canvas.width = width; canvas.height = height + footer;
        const ctx = canvas.getContext('2d');
        try {
            ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, width, height); ctx.restore();
            exposeCameraFrame(ctx, width, height);
            const anchor = anchors[winnerIndex];
            if (dual && anchor && performance.now() - anchor.at <= 500) drawCrown(ctx, anchor, width, height);
            ctx.fillStyle = '#172554'; ctx.fillRect(0, height, width, footer);
            ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
            ctx.font = `900 ${Math.max(24, width * 0.065)}px system-ui, sans-serif`;
            ctx.fillText('ACTIVE RUNNER', width / 2, height + footer * 0.3, width - 24);
            const dict = app.localization.translations[document.getElementById('lang-select').value];
            const names = [state.session.currentPlayerName, state.session.currentPlayer2Name];
            const score = dual ? state.game.players[winnerIndex]?.score || 0 : state.game.score;
            const caption = dual ? `🏆 ${names[winnerIndex]} · ${dict.score} ${Math.floor(score)}` : `${names[0]} · ${dict.score} ${Math.floor(score)}`;
            ctx.font = `700 ${Math.max(22, width * 0.06)}px system-ui, sans-serif`;
            ctx.fillText(caption, width / 2, height + footer * 0.61, width - 24);
            ctx.fillStyle = '#c7d2fe';
            ctx.font = `700 ${Math.max(20, width * 0.045)}px system-ui, sans-serif`;
            ctx.fillText(dateStamp, width / 2, height + footer * 0.88, width - 24);
            canvas.setAttribute('aria-label', `Active Runner — ${caption} — ${dateStamp}`);
            closeButton.setAttribute('aria-label', dict.finishPhotoClose);
            document.getElementById('finish-photo-title').textContent = dict.finishPhotoTitle;
        } catch (error) {
            canvas.width = canvas.height = 0;
            app.debug.record('finish_photo.error', { message: String(error) });
            return false;
        }
        if (dual) {
            stats.classList.add('hidden');
            dialog.showModal();
            closeButton.focus();
        } else {
            single.hidden = false;
            layout.classList.add('has-finish-photo');
        }
        return true;
    }

    closeButton.addEventListener('click', closeFinishPhoto);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeFinishPhoto(); });
    return { observeFinishPlayers, showFinishPhoto, closeFinishPhoto, resetFinishPhoto };
}
