/** viewport: see docs/architecture.md for ownership and compatibility rules. */
function createViewport({ state, app }) {
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = state.viewport.gameWidth; canvas.height = state.viewport.gameHeight;

    window.addEventListener('resize', () => {
        state.viewport.gameWidth = window.innerWidth; state.viewport.gameHeight = window.innerHeight;
        canvas.width = state.viewport.gameWidth; canvas.height = state.viewport.gameHeight;
        if(state.game.gameState === 'login' || state.game.gameState === 'dashboard') app.world.drawStaticBackground();
    });

    return { canvas, ctx };
}
