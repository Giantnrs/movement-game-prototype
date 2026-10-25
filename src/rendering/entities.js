/** entities: see docs/architecture.md for ownership and compatibility rules. */
function createEntities({ state, app }) {
    const { ctx } = app.viewport;

    function drawOrb(orb, subW) {
        const oPos = app.world.getScreenPos(orb.lane, orb.depth, subW);
        const scale = 0.2 + (orb.depth * 0.8);
        const radius = 42 * scale;   // was 22 — now much bigger
        const bobY = Math.sin(state.game.frameCount * 0.08 + orb.bobOffset) * 10 * scale;
        const pulse = 1 + Math.sin(state.game.frameCount * 0.12 + orb.bobOffset) * 0.12; // gentle pulse

        ctx.save();
        ctx.shadowBlur = 45 * scale;  // stronger glow

        if (orb.type === 'shield') {
            ctx.shadowColor = '#06b6d4';

            // Outer pulse ring
            ctx.beginPath();
            ctx.arc(oPos.x, oPos.y + bobY, radius * 1.5 * pulse, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(6,182,212,0.25)';
            ctx.lineWidth = 5 * scale;
            ctx.stroke();

            // Main orb
            const grad = ctx.createRadialGradient(oPos.x, oPos.y + bobY - radius * 0.3, radius * 0.1, oPos.x, oPos.y + bobY, radius);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.4, '#67e8f9');
            grad.addColorStop(1, '#0891b2');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(oPos.x, oPos.y + bobY, radius, 0, Math.PI * 2);
            ctx.fill();

            // Shield icon — much larger
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 0;
            ctx.font = `bold ${Math.floor(radius * 1.3)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🛡️', oPos.x, oPos.y + bobY);

        } else {
            ctx.shadowColor = '#ec4899';

            // Outer pulse ring
            ctx.beginPath();
            ctx.arc(oPos.x, oPos.y + bobY, radius * 1.5 * pulse, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(236,72,153,0.25)';
            ctx.lineWidth = 5 * scale;
            ctx.stroke();

            // Main orb
            const grad = ctx.createRadialGradient(oPos.x, oPos.y + bobY - radius * 0.3, radius * 0.1, oPos.x, oPos.y + bobY, radius);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.4, '#f9a8d4');
            grad.addColorStop(1, '#be185d');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(oPos.x, oPos.y + bobY, radius, 0, Math.PI * 2);
            ctx.fill();

            // Heart icon — much larger
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 0;
            ctx.font = `bold ${Math.floor(radius * 1.3)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('💗', oPos.x, oPos.y + bobY);
        }
        ctx.restore();
    }

    function drawObstacle(obs, subW) {
        const oPos = app.world.getScreenPos(obs.lane, obs.depth, subW);
        const scale = 0.2 + (obs.depth * 0.8);
        const totalW = oPos.w * obs.span * scale;

        ctx.save();
        if (obs.type === 'high') {
            ctx.fillStyle = '#f59e0b'; ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 15;
            ctx.fillRect(oPos.x - (totalW/2), oPos.y - (100*scale), totalW, 40*scale);
        } else if (obs.type === 'low' || obs.type === 'low-wide') {
            ctx.fillStyle = obs.type === 'low-wide' ? '#dc2626' : '#ef4444'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 15;
            ctx.fillRect(oPos.x - (totalW/2), oPos.y - (30*scale), totalW, 30*scale);
        } else if (obs.type === 'block') {
            ctx.fillStyle = '#ec4899'; ctx.shadowColor = '#ec4899'; ctx.shadowBlur = 15;
            ctx.fillRect(oPos.x - (totalW/2), oPos.y - (80*scale), totalW, 80*scale);
        } else if (obs.type === 'door') {
            ctx.fillStyle = '#0ea5e9'; ctx.shadowColor = '#0ea5e9'; ctx.shadowBlur = 15;
            ctx.fillRect(oPos.x - (totalW/2), oPos.y - (120*scale), totalW, 40*scale);
            ctx.fillRect(oPos.x - (totalW/2), oPos.y - (120*scale), 20*scale, 120*scale);
            ctx.fillRect(oPos.x + (totalW/2) - (20*scale), oPos.y - (120*scale), 20*scale, 120*scale);
        }
        ctx.restore();
    }

    // Draw shield ring around player when shield is active
    function drawShieldRing(p, subW) {
        if (!p.shieldActive) return;
        const basePos  = app.world.getScreenPos(p.lane, 0.85, subW);
        const pulse    = 1 + Math.sin(state.game.frameCount * 0.15) * 0.08;
        const radius   = 80;
        const progress = p.shieldTimer / 300;   // countdown 1 → 0
        const secsLeft = Math.ceil(p.shieldTimer / 60);

        ctx.save();

        // Filled semi-transparent inner glow
        ctx.beginPath();
        ctx.arc(p.renderX || basePos.x, basePos.y - 35, radius * pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(6,182,212,0.08)';
        ctx.fill();

        // Background ring (faint)
        ctx.beginPath();
        ctx.arc(p.renderX || basePos.x, basePos.y - 35, radius * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(6,182,212,0.2)';
        ctx.lineWidth = 10;
        ctx.stroke();

        // Countdown arc — drains as time passes
        ctx.beginPath();
        ctx.arc(p.renderX || basePos.x, basePos.y - 35, radius * pulse,
            -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * progress));
        ctx.strokeStyle = secsLeft <= 5 ? '#fbbf24' : '#06b6d4';
        ctx.lineWidth = 10;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 30;
        ctx.stroke();

        // Countdown text above player
        ctx.fillStyle = secsLeft <= 5 ? '#fbbf24' : '#06b6d4';
        ctx.shadowBlur = 8;
        ctx.font = 'bold 22px Segoe UI';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`🛡️ ${secsLeft}s`, p.renderX || basePos.x, basePos.y - 35 - radius * pulse - 6);

        ctx.restore();
    }

    function updateAndDrawPlayer(p, subW, playerIndex) {
        const basePos = app.world.getScreenPos(p.lane, 0.85, subW);

        if (p.renderX === undefined) p.renderX = basePos.x;
        p.renderX += (basePos.x - p.renderX) * 0.2;

        const dx = basePos.x - p.renderX;
        p.renderAngle = dx * 0.005;

        const isMovingLeft = dx < -2;
        const isMovingRight = dx > 2;

        let targetArmL = Math.PI * 0.5 + Math.sin(state.game.frameCount * 0.2) * 0.2;
        let targetArmR = Math.PI * 0.5 - Math.sin(state.game.frameCount * 0.2) * 0.2;
        let targetYOffset = 0;
        let targetScaleY = 1;
        let targetScaleX = 1;

        if (p.isResting) {
            // Arms crossed visual: arms point inward
            targetArmL = Math.PI * 0.1;   // Right-ish
            targetArmR = Math.PI * 0.9;   // Left-ish
            targetYOffset = 0;
            targetScaleY = 0.95;
            targetScaleX = 1.05;
        } else if (p.isJumping) {
            targetYOffset = -90;
            targetScaleY = 1.1;
            targetScaleX = 0.9;
            targetArmL = Math.PI * 1.4;
            targetArmR = -Math.PI * 0.4;
        } else if (p.isSquatting) {
            targetYOffset = 0;
            targetScaleY = 0.6;
            targetScaleX = 1.3;
            targetArmL = Math.PI;
            targetArmR = 0;
        } else {
            targetYOffset = Math.sin(state.game.frameCount * 0.3) * 5;
            if (isMovingLeft) targetArmL = Math.PI;
            else if (isMovingRight) targetArmR = 0;
        }

        if (p.renderArmL === undefined) p.renderArmL = targetArmL;
        if (p.renderArmR === undefined) p.renderArmR = targetArmR;

        p.renderYOffset += (targetYOffset - p.renderYOffset) * 0.3;
        p.renderScaleY += (targetScaleY - p.renderScaleY) * 0.3;
        p.renderScaleX += (targetScaleX - p.renderScaleX) * 0.3;
        p.renderArmL += (targetArmL - p.renderArmL) * 0.3;
        p.renderArmR += (targetArmR - p.renderArmR) * 0.3;

        // Draw shield ring behind player
        drawShieldRing(p, subW);

        ctx.save();
        ctx.translate(p.renderX, basePos.y + p.renderYOffset);
        ctx.rotate(p.renderAngle);
        ctx.scale(p.renderScaleX, p.renderScaleY);

        let color = playerIndex === 0 ? '#3b82f6' : '#ef4444';
        if (p.shieldActive) color = '#06b6d4'; // Cyan tint while shielded
        else if (p.isJumping) color = playerIndex === 0 ? '#60a5fa' : '#f87171';
        else if (p.isSquatting) color = playerIndex === 0 ? '#1e3a8a' : '#7f1d1d';
        else if (p.isResting) color = '#a78bfa'; // Purple tint while resting
        if (p.invulnerableFrames > 0 && !p.shieldActive) color = '#ffffff';

        const w = 70, h = 70;

        if (p.isJumping) {
            ctx.fillStyle = '#fb923c';
            ctx.beginPath();
            ctx.moveTo(-w/3, 0);
            ctx.lineTo(0, 42 + Math.random() * 28);
            ctx.lineTo(w/3, 0);
            ctx.fill();
        }

        ctx.fillStyle = color;
        const armLength = 42;
        const armThickness = 17;
        const shoulderY = -h + 21;

        ctx.save();
        ctx.translate(-w/2, shoulderY);
        ctx.rotate(p.renderArmL);
        ctx.beginPath();
        ctx.roundRect(0, -armThickness/2, armLength, armThickness, armThickness/2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.translate(w/2, shoulderY);
        ctx.rotate(p.renderArmR);
        ctx.beginPath();
        ctx.roundRect(0, -armThickness/2, armLength, armThickness, armThickness/2);
        ctx.fill();
        ctx.restore();

        ctx.shadowColor = p.shieldActive ? '#06b6d4' : color;
        ctx.shadowBlur = p.shieldActive ? 25 : 15;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(-w/2, -h, w, h, 12);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.roundRect(-w/2 + 8, -h + 10, w - 16, 15, 6);
        ctx.fill();

        ctx.restore();

        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.ellipse(p.renderX, basePos.y, 35 * p.renderScaleX, 11, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    return { drawOrb, drawObstacle, drawShieldRing, updateAndDrawPlayer };
}
