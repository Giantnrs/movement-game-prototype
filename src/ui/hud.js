/** hud: see docs/architecture.md for ownership and compatibility rules. */
function createHud({ state, app }) {
    function layoutGameplayNotices() {
        if (state.game.gameState !== 'playing') return;
        const notices = ['player-tracking-notice', 'orb-notify'].map(id => document.getElementById(id))
            .filter(element => !element.hidden && !element.classList.contains('hidden'));
        if (!notices.length) return;
        const container = document.getElementById('game-container').getBoundingClientRect();
        const hud = document.getElementById(state.session.numPlayers === 1 ? 'hud-1p' : 'hud-2p').getBoundingClientRect();
        const gap = 12;
        let top = Math.max(gap, Math.ceil(hud.bottom - container.top) + gap);
        for (const notice of notices) {
            const maxHeight = Math.max(0, Math.floor(container.height - top - gap));
            const nextTop = `${top}px`, nextMaxHeight = `${maxHeight}px`;
            if (notice.style.top !== nextTop) notice.style.top = nextTop;
            if (notice.style.maxHeight !== nextMaxHeight) notice.style.maxHeight = nextMaxHeight;
            top += Math.ceil(notice.getBoundingClientRect().height) + gap;
        }
    }

    function renderRanking(id, playerIndex, dict) {
        const tile = document.getElementById(id);
        tile.querySelector('[data-ranking-label]').textContent = dict.hudLiveRanking;
        const ranking = app.scores.getLiveRanking(playerIndex);
        for (const [index, row] of [...tile.querySelectorAll('[data-rank-row]')].entries()) {
            const entry = ranking.rows[index];
            row.hidden = !entry;
            row.classList.toggle('hud-rank-current', !!entry && entry.playerIndex === playerIndex);
            row.querySelector('.hud-rank-number').textContent = entry ? `#${entry.rank}` : '';
            const name = row.querySelector('.hud-rank-name');
            const medal = entry && ['🥇 ', '🥈 ', '🥉 '][entry.rank - 1] || '';
            name.textContent = entry ? medal + entry.name : '';
            name.title = entry ? entry.name : '';
            row.querySelector('.hud-rank-score').textContent = entry ? entry.score : '';
        }
    }

    function renderPlayerName(id, name) {
        const element = document.getElementById(id);
        element.textContent = name;
        element.title = name;
    }

    function updateHUD() {
        const dict = app.localization.translations[document.getElementById('lang-select').value];
        if (state.session.numPlayers === 1) {
            document.getElementById('score-display-1p').innerText = Math.floor(state.game.score);
            document.getElementById('lives-display-1p').innerText = state.game.players[0].lives;
            document.getElementById('shield-display-1p').innerText = state.game.players[0].shieldOrbs;
            renderRanking('hud-ranking-1p', 0, dict);
        } else {
            // Both players share same score (co-op style)
            document.getElementById('score-display-2p').innerText = Math.floor(state.game.score);
            document.getElementById('score-display-2p-p2').innerText = Math.floor(state.game.score);
            // P1 (left board = hud-p2 elements) — person standing LEFT side of room
            document.getElementById('p2-lives-display').innerText = state.game.players[0].lives;
            document.getElementById('p2-shields').innerText = state.game.players[0].shieldOrbs;
            document.getElementById('score-display-2p-p2').innerText = Math.floor(state.game.players[0].score || state.game.score);
            renderPlayerName('p2-hud-name', state.session.currentPlayerName);
            // P2 (right board = hud-p1 elements) — person standing RIGHT side of room
            document.getElementById('p1-lives-display').innerText = state.game.players[1].lives;
            document.getElementById('p1-shields').innerText = state.game.players[1].shieldOrbs;
            document.getElementById('score-display-2p').innerText = Math.floor(state.game.players[1].score || state.game.score);
            renderPlayerName('p1-hud-name', state.session.currentPlayer2Name);
        }
        document.getElementById('energy-estimate-help').textContent = dict.energyEstimateHelp;
        document.querySelectorAll('[data-energy-estimate]').forEach(element => {
            element.title = dict.energyEstimateHelp;
        });
        layoutGameplayNotices();
    }

    window.addEventListener('resize', layoutGameplayNotices);

    return { updateHUD, layoutGameplayNotices };
}
