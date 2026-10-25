(function () {
    const fw = document.getElementById('fireworks-canvas');
    const fctx = fw.getContext('2d');
    let fwParticles = [], fwAnimId = null, fwActive = false;

    function resize() { fw.width = window.innerWidth; fw.height = window.innerHeight; }
    window.addEventListener('resize', resize);
    resize();

    function burst(cx, cy) {
        const palette = ['#f59e0b','#ef4444','#10b981','#3b82f6','#8b5cf6','#ec4899','#fbbf24','#34d399'];
        for (let i = 0; i < 28; i++) {
            const angle = (i / 28) * Math.PI * 2 + Math.random() * 0.3;
            const spd   = 2.5 + Math.random() * 5;
            fwParticles.push({
                x: cx, y: cy,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd - 1,
                color: palette[Math.floor(Math.random() * palette.length)],
                r: 3 + Math.random() * 3,
                life: 1.0,
                decay: 0.012 + Math.random() * 0.01
            });
        }
    }

    function scheduleBursts() {
        // Fire exactly 3 bursts at staggered times
        [0, 550, 1100].forEach(d => setTimeout(() => {
            burst(fw.width * (0.2 + Math.random() * 0.6), fw.height * (0.1 + Math.random() * 0.5));
        }, d));
        // Stop the active flag after the last burst fires so particles fade on their own
        setTimeout(() => { fwActive = false; }, 1150);
    }

    function drawFw() {
        fctx.clearRect(0, 0, fw.width, fw.height);
        fwParticles = fwParticles.filter(p => p.life > 0);
        fwParticles.forEach(p => {
            fctx.save();
            fctx.globalAlpha = p.life;
            fctx.beginPath();
            fctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
            fctx.fillStyle = p.color;
            fctx.shadowColor = p.color;
            fctx.shadowBlur = 6;
            fctx.fill();
            fctx.restore();
            p.x  += p.vx;
            p.y  += p.vy;
            p.vy += 0.09;   // gravity
            p.vx *= 0.98;   // air drag
            p.life -= p.decay;
        });
        if (fwActive || fwParticles.length > 0) fwAnimId = requestAnimationFrame(drawFw);
        else { fctx.clearRect(0, 0, fw.width, fw.height); fw.style.display = 'none'; }
    }

    window.startFireworks = function () {
        fwActive = true;
        fwParticles = [];
        fw.style.display = 'block';
        cancelAnimationFrame(fwAnimId);
        scheduleBursts();
        drawFw();
    };

    window.stopFireworks = function () {
        fwActive = false;
        // particles fade out naturally; canvas hides itself when empty
    };
})();
