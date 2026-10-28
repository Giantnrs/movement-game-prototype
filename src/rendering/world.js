/** world: see docs/architecture.md for ownership and compatibility rules. */
function createWorld({ state, app }) {
    const { ctx } = app.viewport;

    const horizonY = state.viewport.gameHeight * 0.3;

    function getScreenPos(laneIdx, depth, canvasW) {
        const laneWidthBottom = canvasW / 3;
        const laneWidthTop = canvasW / 8;
        const currentY = horizonY + (state.viewport.gameHeight - horizonY) * depth;
        const totalWidthAtDepth = laneWidthTop + (laneWidthBottom * 3 - laneWidthTop) * depth;
        const laneW = totalWidthAtDepth / 3;
        const centerX = canvasW / 2;
        return { x: centerX + (laneIdx * laneW), y: currentY, w: laneW * 0.8 };
    }

    function drawBackground(canvasW) {
        const isDark = document.documentElement.classList.contains('dark');
        ctx.fillStyle = isDark ? '#0f172a' : '#bae6fd'; ctx.fillRect(0, 0, canvasW, horizonY);
        ctx.fillStyle = isDark ? '#1e293b' : '#bbf7d0'; ctx.fillRect(0, horizonY, canvasW, state.viewport.gameHeight - horizonY);

        // ── Sky visual effects (active from game start, style upgrades every 100 pts) ──
        if (state.game.skyEffectsEnabled) {
            // Style 1+: Flowing aurora bands
            if (state.game.skyStyle >= 1) {
                const aurCols = isDark
                    ? ['rgba(42,157,143,', 'rgba(99,102,241,', 'rgba(139,92,246,']
                    : ['rgba(80,200,170,',  'rgba(130,160,255,', 'rgba(190,140,255,'];
                const bandCount = state.game.skyStyle >= 3 ? 4 : 3;
                for (let b = 0; b < bandCount; b++) {
                    const baseY = horizonY * (0.15 + b * 0.18);
                    const t2 = state.game.frameCount * 0.012 + b * 1.8;
                    const opacity = (0.12 + Math.sin(state.game.frameCount * 0.018 + b) * 0.07) * (state.game.skyStyle >= 3 ? 1.5 : 1);
                    ctx.beginPath();
                    for (let x = 0; x <= canvasW; x += 20) {
                        const y = baseY + Math.sin(x * 0.007 + t2) * 14 + Math.sin(x * 0.014 + t2 * 1.4) * 7;
                        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                    }
                    ctx.strokeStyle = aurCols[b % aurCols.length] + opacity + ')';
                    ctx.lineWidth = 10 + state.game.skyStyle * 2;
                    ctx.stroke();
                }
            }

            // Twinkling stars — colorful from style 2+
            state.game.skyStarBase.forEach(s => {
                s.twinkle += 0.055;
                const alpha = 0.55 + Math.sin(s.twinkle) * 0.45; // 0.1–1.0
                const sx = s.x * canvasW / state.viewport.gameWidth;
                const radius = s.r * 1.8 * (state.game.skyStyle >= 3 ? 1.5 : 1);
                const hueVal = (s.hue + state.game.frameCount * 0.3) % 360;
                const col = state.game.skyStyle >= 2
                    ? `hsla(${hueVal},100%,${isDark ? 92 : 97}%,${Math.max(0, alpha)})`
                    : isDark ? `rgba(255,255,220,${Math.max(0, alpha)})` : `rgba(255,255,255,${Math.max(0, alpha)})`;
                // Fake glow: outer soft halo (no shadowBlur — much cheaper)
                ctx.beginPath();
                ctx.arc(sx, s.y, radius * 3, 0, Math.PI * 2);
                ctx.fillStyle = state.game.skyStyle >= 2
                    ? `hsla(${hueVal},100%,80%,${Math.max(0, alpha * 0.18)})`
                    : isDark ? `rgba(200,230,255,${Math.max(0, alpha * 0.18)})` : `rgba(255,255,255,${Math.max(0, alpha * 0.15)})`;
                ctx.fill();
                // Core star
                ctx.beginPath();
                ctx.arc(sx, s.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = col;
                ctx.fill();
            });

            // Shooting stars — rate and colour change with style
            const spawnRate = state.game.skyStyle >= 3 ? 0.04 : state.game.skyStyle >= 1 ? 0.025 : 0.015;
            if (Math.random() < spawnRate) {
                const hue = state.game.skyStyle >= 2 ? Math.floor(Math.random() * 360) : null;
                state.game.skyParticles.push({
                    x:    Math.random() * canvasW * 0.65,
                    y:    Math.random() * horizonY * 0.5,
                    vx:   9 + Math.random() * 8,
                    vy:   2 + Math.random() * 3,
                    life: 1.0,
                    len:  90 + Math.random() * 80,   // longer tail (was 55–120)
                    lw:   state.game.skyStyle >= 3 ? 4 : 3,
                    color: hue !== null
                        ? `hsla(${hue},100%,${isDark ? 90 : 97}%,`
                        : (isDark ? 'rgba(220,235,255,' : 'rgba(255,255,255,')
                });
            }

            state.game.skyParticles = state.game.skyParticles.filter(p => p.life > 0);
            state.game.skyParticles.forEach(p => {
                ctx.save();
                ctx.globalAlpha = p.life;
                const tailLen = p.len * p.life;
                const mag = Math.hypot(p.vx, p.vy);
                // Bright core dot at head (no shadowBlur — use double circle fake glow)
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.lw * 2.5, 0, Math.PI * 2);
                ctx.fillStyle = p.color + '0.25)';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.lw * 1.2, 0, Math.PI * 2);
                ctx.fillStyle = p.color + '1)';
                ctx.fill();
                // Fading tail
                const grad = ctx.createLinearGradient(
                    p.x, p.y,
                    p.x - p.vx / mag * tailLen, p.y - p.vy / mag * tailLen
                );
                grad.addColorStop(0, p.color + '1)');
                grad.addColorStop(1, p.color + '0)');
                ctx.strokeStyle = grad;
                ctx.lineWidth = p.lw;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x - p.vx / mag * tailLen, p.y - p.vy / mag * tailLen);
                ctx.stroke();
                ctx.restore();
                p.x += p.vx; p.y += p.vy;
                p.life -= 0.016;
            });
        }

        ctx.strokeStyle = isDark ? '#334155' : '#ffffff'; ctx.lineWidth = 6;

        const pFarLeft = getScreenPos(-1.5, 0, canvasW), pFarRight = getScreenPos(1.5, 0, canvasW);
        const pNearLeft = getScreenPos(-1.5, 1, canvasW), pNearRight = getScreenPos(1.5, 1, canvasW);
        const pFarL1 = getScreenPos(-0.5, 0, canvasW), pNearL1 = getScreenPos(-0.5, 1, canvasW);
        const pFarR1 = getScreenPos(0.5, 0, canvasW), pNearR1 = getScreenPos(0.5, 1, canvasW);

        ctx.beginPath();
        ctx.moveTo(pNearLeft.x, pNearLeft.y); ctx.lineTo(pFarLeft.x, pFarLeft.y);
        ctx.moveTo(pNearL1.x, pNearL1.y); ctx.lineTo(pFarL1.x, pFarL1.y);
        ctx.moveTo(pNearR1.x, pNearR1.y); ctx.lineTo(pFarR1.x, pFarR1.y);
        ctx.moveTo(pNearRight.x, pNearRight.y); ctx.lineTo(pFarRight.x, pFarRight.y);
        ctx.stroke();
    }

    function drawStaticBackground() {
        ctx.clearRect(0, 0, state.viewport.gameWidth, state.viewport.gameHeight);
        // bg-canvas provides the animated background during non-game states
    }

    return { horizonY, getScreenPos, drawBackground, drawStaticBackground };
}
