/** bootstrap: see docs/architecture.md for ownership and compatibility rules. */
function createBootstrap({ state, app }) {
    function initialize() {
        window.addEventListener('DOMContentLoaded', () => {
            const savedTheme = localStorage.getItem('game_theme') || 'light';
            document.getElementById('theme-select').value = savedTheme;
            app.preferences.updateTheme(savedTheme);
            const savedLang = localStorage.getItem('game_lang') || 'en';
            document.getElementById('lang-select').value = savedLang;
            app.localization.setLoginLang(savedLang);
            const savedName = localStorage.getItem('player_name');
            if (savedName) document.getElementById('player-name').value = savedName;
            app.localization.updateLoginNameCheck();
            const savedName2 = localStorage.getItem('player2_name');
            if (savedName2) { state.session.currentPlayer2Name = savedName2; }
            app.world.drawStaticBackground();
            setTimeout(() => {
                const intro = document.getElementById('bg-intro');
                if (intro) intro.classList.add('out');
            }, 2000);
        });
    }


    return { initialize };
}
