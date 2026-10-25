/** scores: see docs/architecture.md for ownership and compatibility rules. */
function createScores({ state, app }) {
    function getLBKey() {
        return state.game.speedMultiplier < 1 ? 'game_leaderboard_chill' : 'game_leaderboard_normal';
    }

    // Discard legacy demo results once; real scores persist on subsequent loads.
    if (localStorage.getItem('leaderboard_data_version') !== '1') {
        localStorage.removeItem('game_leaderboard_normal');
        localStorage.removeItem('game_leaderboard_chill');
        localStorage.setItem('leaderboard_data_version', '1');
    }

    function playerNameKey(name) {
        return typeof name === 'string' ? name.trim().normalize('NFC').toLowerCase() : '';
    }

    function highestPerName(entries) {
        const best = new Map();
        for (const entry of entries) {
            const key = playerNameKey(entry.name);
            if (key && (!best.has(key) || entry.score > best.get(key).score)) best.set(key, entry);
        }
        return [...best.values()].sort((a, b) => b.score - a.score);
    }

    function getLeaderboard(key = getLBKey()) {
        try {
            const board = JSON.parse(localStorage.getItem(key) || '[]');
            if (!Array.isArray(board)) return [];
            const valid = board.filter(player => player && typeof player.name === 'string' &&
                player.name.trim() && Number.isFinite(player.score) && player.score > 0)
                .map(player => ({ name: player.name.trim(), score: Math.floor(player.score) }))
                .filter(player => player.score > 0);
            return highestPerName(valid).slice(0, 5);
        } catch {
            return [];
        }
    }

    // Consolidate existing real scores without re-running the demo-data reset.
    // Reads during gameplay stay free of persistence side effects.
    for (const key of ['game_leaderboard_normal', 'game_leaderboard_chill']) {
        const stored = localStorage.getItem(key);
        if (stored !== null) {
            const cleaned = JSON.stringify(getLeaderboard(key));
            if (stored !== cleaned) localStorage.setItem(key, cleaned);
        }
    }

    function saveScore(newScore) {
        if (!Number.isFinite(newScore) || Math.floor(newScore) <= 0) return;
        const name = typeof state.session.currentPlayerName === 'string' ? state.session.currentPlayerName.trim() : '';
        if (!name) return;
        const board = highestPerName([...getLeaderboard(),
            { name, score: Math.floor(newScore) }]).slice(0, 5);
        localStorage.setItem(getLBKey(), JSON.stringify(board));
        app.leaderboards.renderLeaderboard();
    }

    // Rank current runs alongside all saved results, including same-name bests.
    // Live rows are identified by slot, and this projection never writes storage.
    function getLiveRanking(playerIndex) {
        const names = [state.session.currentPlayerName, state.session.currentPlayer2Name].slice(0, state.session.numPlayers);
        const entries = getLeaderboard().map(entry => ({ ...entry, playerIndex: null }));
        for (let index = 0; index < state.session.numPlayers; index++) {
            const score = state.session.numPlayers === 1 ? state.game.score : state.game.players[index].score;
            entries.push({ name: typeof names[index] === 'string' ? names[index].trim() : '',
                score: Math.max(0, Math.floor(Number.isFinite(score) ? score : 0)), playerIndex: index });
        }
        const ranked = entries.sort((a, b) => b.score - a.score)
            .map((entry, index) => ({ ...entry, rank: index + 1 }));
        const index = ranked.findIndex(entry => entry.playerIndex === playerIndex);
        if (index < 0) return { current: null, rows: [] };
        // Keep the current run centered when possible; fill from the available
        // side at the top/bottom so a three-entry window never wastes a row.
        const start = Math.max(0, Math.min(index - 1, ranked.length - 3));
        return { current: ranked[index], rows: ranked.slice(start, start + 3) };
    }

    return { getLBKey, getLeaderboard, saveScore, getLiveRanking, playerNameKey };
}
