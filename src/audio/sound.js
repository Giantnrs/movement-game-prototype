/** audio: see docs/architecture.md for ownership and compatibility rules. */
function createAudio({ state, app }) {
    const bgMusic = document.getElementById('bg-music');
    bgMusic.volume = 0.4;
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    function playSynth(type) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const now = audioCtx.currentTime;
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.connect(g).connect(audioCtx.destination);
        g.gain.value = 0.15; let duration = 0.18;
        if (type === 'lane') { o.type = 'sine'; o.frequency.setValueAtTime(660, now); o.frequency.linearRampToValueAtTime(880, now + duration); }
        else if (type === 'jump') { o.type = 'triangle'; o.frequency.setValueAtTime(440, now); o.frequency.linearRampToValueAtTime(1320, now + 0.22); duration = 0.22; }
        else if (type === 'squat') { o.type = 'triangle'; o.frequency.setValueAtTime(660, now); o.frequency.linearRampToValueAtTime(220, now + 0.22); duration = 0.22; }
        else if (type === 'hit') { o.type = 'sawtooth'; o.frequency.setValueAtTime(110, now); o.frequency.linearRampToValueAtTime(55, now + 0.18); g.gain.setValueAtTime(0.2, now); g.gain.linearRampToValueAtTime(0, now + 0.18); }
        else if (type === 'levelup') { o.type = 'square'; o.frequency.setValueAtTime(880, now); o.frequency.linearRampToValueAtTime(1760, now + 0.25); duration = 0.25; }
        else if (type === 'orb') { o.type = 'sine'; o.frequency.setValueAtTime(880, now); o.frequency.linearRampToValueAtTime(1320, now + 0.15); g.gain.setValueAtTime(0.2, now); g.gain.linearRampToValueAtTime(0, now + 0.2); duration = 0.2; }
        else if (type === 'heart') { o.type = 'sine'; o.frequency.setValueAtTime(660, now); o.frequency.linearRampToValueAtTime(990, now + 0.1); o.frequency.linearRampToValueAtTime(1320, now + 0.2); g.gain.setValueAtTime(0.2, now); g.gain.linearRampToValueAtTime(0, now + 0.25); duration = 0.25; }
        else if (type === 'shield') { o.type = 'triangle'; o.frequency.setValueAtTime(440, now); o.frequency.linearRampToValueAtTime(880, now + 0.15); o.frequency.linearRampToValueAtTime(1760, now + 0.3); g.gain.setValueAtTime(0.25, now); g.gain.linearRampToValueAtTime(0, now + 0.4); duration = 0.4; }
        o.start(now); o.stop(now + duration);
        o.onended = () => { o.disconnect(); g.disconnect(); };
    }

    return { bgMusic, audioCtx, playSynth };
}
