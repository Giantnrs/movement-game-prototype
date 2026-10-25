/** notifications: see docs/architecture.md for ownership and compatibility rules. */
function createNotifications({ state, app }) {
    function clearOrbNotify() {
        state.game.orbNotifyTimer = 0;
        document.getElementById('orb-notify').classList.add('hidden');
        app.hud.layoutGameplayNotices();
    }

    function showOrbNotify(text, color) {
        if (state.game.gameState !== 'playing') {
            clearOrbNotify();
            return;
        }
        const el = document.getElementById('orb-notify');
        const textEl = document.getElementById('orb-notify-text');
        textEl.textContent = text;
        textEl.style.background = color;
        el.classList.remove('hidden');
        state.game.orbNotifyTimer = 120;
        app.hud.layoutGameplayNotices();
    }

    return { showOrbNotify, clearOrbNotify };
}
