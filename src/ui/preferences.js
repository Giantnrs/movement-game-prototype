/** preferences: see docs/architecture.md for ownership and compatibility rules. */
function createPreferences({ state, app }) {
    function updateTheme(theme) {
        const htmlEl = document.documentElement;
        if (theme === 'dark') htmlEl.classList.add('dark');
        else htmlEl.classList.remove('dark');
        document.getElementById('theme-select').value = theme;
        localStorage.setItem('game_theme', theme);
        app.localization.updateLoginThemeIcon();
        if(state.game.gameState === 'loading' || state.game.gameState === 'login' || state.game.gameState === 'dashboard') app.world.drawStaticBackground();
    }

    return { updateTheme };
}
