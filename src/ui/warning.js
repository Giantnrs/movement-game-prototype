/** warning: see docs/architecture.md for ownership and compatibility rules. */
function createWarning({ state, app }) {
    const WARNING_READ_PLAY_ICON = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>`;
    const WARNING_READ_STOP_ICON = `<line x1="1" y1="1" x2="23" y2="23"></line><polygon points="9 9 11 5 11 19 6 15 2 15 2 9 9 9"></polygon><path d="M15.54 8.46a5 5 0 0 1 1.46 3.54"></path>`;

    function resetWarningReadBtn() {
        const btn = document.getElementById('warning-read-btn');
        const icon = document.getElementById('warning-read-icon');
        if (!btn || !icon) return;
        icon.innerHTML = WARNING_READ_PLAY_ICON;
        btn.classList.remove('bg-amber-300', 'dark:bg-amber-700');
        btn.setAttribute('aria-pressed', 'false');
    }

    function stopWarningAudio() {
        const audio = document.getElementById('warning-audio');
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
        resetWarningReadBtn();
    }

    function toggleWarningRead() {
        const btn = document.getElementById('warning-read-btn');
        const icon = document.getElementById('warning-read-icon');
        const audio = document.getElementById('warning-audio');
        if (!btn || !icon || !audio) return;

        if (!audio.paused) {
            stopWarningAudio();
            return;
        }

        audio.currentTime = 0;
        audio.play().then(() => {
            icon.innerHTML = WARNING_READ_STOP_ICON;
            btn.classList.add('bg-amber-300', 'dark:bg-amber-700');
            btn.setAttribute('aria-pressed', 'true');
        }).catch(() => stopWarningAudio());

        audio.onended = stopWarningAudio;
        audio.onerror = stopWarningAudio;
    }

    return { WARNING_READ_PLAY_ICON, WARNING_READ_STOP_ICON, resetWarningReadBtn, stopWarningAudio, toggleWarningRead };
}
