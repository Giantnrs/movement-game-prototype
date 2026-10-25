(function() {
    const bgCanvas = document.getElementById('bg-canvas');
    const bgCtx = bgCanvas.getContext('2d');
    let W, H, lines, particles;

    function resize() {
        W = bgCanvas.width  = window.innerWidth;
        H = bgCanvas.height = window.innerHeight;
        init();
    }

    function init() {
        lines = Array.from({ length: 18 }, (_, i) => ({
            y:   (H / 18) * i + Math.random() * 30,
            x:   Math.random() * W,
            amp: 10 + Math.random() * 22,
            freq:0.004 + Math.random() * 0.006,
            spd: 0.18 + Math.random() * 0.3,
            col: ['rgba(42,157,143,', 'rgba(192,57,43,', 'rgba(244,162,97,'][i % 3],
            op:  0.04 + Math.random() * 0.06
        }));
        particles = Array.from({ length: 55 }, () => ({
            x:  Math.random() * W,
            y:  Math.random() * H,
            r:  0.5 + Math.random() * 1.5,
            vx: 0.3 + Math.random() * 0.8,
            vy: -0.1 - Math.random() * 0.3,
            op: 0.1 + Math.random() * 0.25,
            col:['rgba(42,157,143,', 'rgba(212,168,67,', 'rgba(241,250,238,'][Math.floor(Math.random()*3)]
        }));
    }

    let t = 0;
    function drawBgKoru(cx, cy, scale, color) {
        bgCtx.save();
        bgCtx.translate(cx, cy);
        bgCtx.rotate(t * 0.002);
        bgCtx.beginPath();
        for (let a = 0; a < Math.PI * 4; a += 0.05) {
            const r = (a / (Math.PI * 4)) * scale;
            const x = Math.cos(a) * r, y = Math.sin(a) * r;
            a < 0.05 ? bgCtx.moveTo(x, y) : bgCtx.lineTo(x, y);
        }
        bgCtx.strokeStyle = color;
        bgCtx.lineWidth = 3;
        bgCtx.stroke();
        bgCtx.restore();
    }

    function drawBg() {
        bgCtx.clearRect(0, 0, W, H);

        const isDark = document.documentElement.classList.contains('dark');

        const grad = bgCtx.createRadialGradient(W*0.35, H*0.45, 0, W*0.5, H*0.5, W*0.85);
        if (isDark) {
            grad.addColorStop(0,   '#0d1f1a');
            grad.addColorStop(0.4, '#0f1e2a');
            grad.addColorStop(1,   '#0a1628');
        } else {
            grad.addColorStop(0,   '#e8f4ef');
            grad.addColorStop(0.4, '#d4ede7');
            grad.addColorStop(1,   '#c5e4dc');
        }
        bgCtx.fillStyle = grad;
        bgCtx.fillRect(0, 0, W, H);

        const lineOpMul = isDark ? 3.5 : 2.5;
        lines.forEach(l => {
            bgCtx.beginPath();
            for (let x = 0; x <= W; x += 3) {
                const y = l.y + Math.sin((x + l.x) * l.freq) * l.amp;
                x === 0 ? bgCtx.moveTo(x, y) : bgCtx.lineTo(x, y);
            }
            bgCtx.strokeStyle = l.col + (l.op * lineOpMul) + ')';
            bgCtx.lineWidth = 1.5;
            bgCtx.stroke();
            l.x += l.spd;
            if (l.x > W) l.x = 0;
        });

        const partOpMul = isDark ? 3.5 : 2.5;
        particles.forEach(p => {
            bgCtx.beginPath();
            bgCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            bgCtx.fillStyle = p.col + (p.op * partOpMul) + ')';
            bgCtx.fill();
            p.x += p.vx; p.y += p.vy;
            if (p.x > W) p.x = 0;
            if (p.y < 0)  p.y = H;
        });

        const koruOp = isDark ? 0.18 : 0.12;
        drawBgKoru(W * 0.08, H * 0.18, 90,  `rgba(42,157,143,${koruOp})`);
        drawBgKoru(W * 0.92, H * 0.75, 70,  `rgba(192,57,43,${isDark ? 0.15 : 0.1})`);
        drawBgKoru(W * 0.5,  H * 0.88, 55,  `rgba(244,162,97,${isDark ? 0.15 : 0.1})`);

        t++;
        requestAnimationFrame(drawBg);
    }

    window.addEventListener('resize', resize);
    resize();
    drawBg();
})();
