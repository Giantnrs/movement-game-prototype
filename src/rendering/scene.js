/** Composes each viewport in the original drawing and animation order. */
function createScene({ state, app }) {
    const { ctx } = app.viewport;

    function renderGameplay() {
        ctx.clearRect(0, 0, state.viewport.gameWidth, state.viewport.gameHeight);
        const subW = state.viewport.gameWidth / state.session.numPlayers;

        for (let i = 0; i < state.session.numPlayers; i++) {
            ctx.save();
            ctx.translate(i * subW, 0);
            ctx.beginPath();
            ctx.rect(0, 0, subW, state.viewport.gameHeight);
            ctx.clip();

            app.world.drawBackground(subW);

            // Draw orbs (behind obstacles)
            state.game.orbs.sort((a,b) => a.depth - b.depth).forEach(orb => {
                if (orb.active) app.entities.drawOrb(orb, subW);
            });

            state.game.obstacles.sort((a,b) => a.depth - b.depth).forEach(obs => {
                if (obs.active) app.entities.drawObstacle(obs, subW);
            });

            if (state.game.players[i].lives > 0 && !state.game.players[i].eliminated && (state.game.players[i].invulnerableFrames === 0 || Math.floor(state.game.frameCount / 5) % 2 === 0)) {
                app.entities.updateAndDrawPlayer(state.game.players[i], subW, i);
            }
            ctx.restore();

            if (i > 0) {
                ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#475569' : '#ffffff';
                ctx.fillRect(i * subW - 3, 0, 6, state.viewport.gameHeight);
            }
        }
    }

    return { renderGameplay };
}
