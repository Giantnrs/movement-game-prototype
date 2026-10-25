/** leaderboards: see docs/architecture.md for ownership and compatibility rules. */
function createLeaderboards({ state, app }) {
    function appendCell(row, text, className) {
        const cell = document.createElement('td');
        cell.className = className;
        cell.textContent = text;
        row.appendChild(cell);
        return cell;
    }

    function renderBoard(tbody, board, gameOver = false) {
        if (!tbody) return;
        tbody.innerHTML = '';
        if (board.length === 0) {
            const dict = app.localization.translations[document.getElementById('lang-select').value];
            const row = document.createElement('tr');
            appendCell(row, dict.leaderboardEmpty, 'p-4 text-xl text-gray-500 dark:text-gray-400 text-center').colSpan = 3;
            tbody.appendChild(row);
            return;
        }
        board.forEach((player, index) => {
            const nameKey = app.scores.playerNameKey(player.name);
            const current = gameOver && [state.session.currentPlayerName, state.session.currentPlayer2Name]
                .some(name => app.scores.playerNameKey(name) === nameKey);
            const row = document.createElement('tr');
            row.className = 'border-b border-gray-200 dark:border-gray-700 last:border-0' + (current ? ' bg-green-50 dark:bg-green-900/30' : '');
            const rank = gameOver && index < 3 ? ['🥇', '🥈', '🥉'][index] : `#${index + 1}`;
            appendCell(row, rank, 'p-4 text-2xl');
            appendCell(row, player.name + (current ? ' ⬅' : ''), 'p-4 text-2xl font-black' + (current ? ' text-green-700 dark:text-green-400' : ''));
            appendCell(row, player.score, 'p-4 text-2xl text-indigo-600 dark:text-indigo-400 font-bold');
            tbody.appendChild(row);
        });
    }

    function renderLeaderboard() {
        // The selected tab determines which mode's saved scores are displayed.
        const key = lbViewTab === 'chill' ? 'game_leaderboard_chill' : 'game_leaderboard_normal';
        renderBoard(document.getElementById('leaderboard-body'), app.scores.getLeaderboard(key));
    }

    function renderGameOverLeaderboard() {
        const key = goLBTab === 'chill' ? 'game_leaderboard_chill' : 'game_leaderboard_normal';
        renderBoard(document.getElementById('gameover-leaderboard-body'), app.scores.getLeaderboard(key), true);
    }

    // Toggle leaderboard on game over screen
    let goLBTab = 'normal';

    function switchGOLBTab(tab) {
        goLBTab = tab;
        if (tab === 'normal') {
            document.getElementById('go-lb-tab-normal').className = 'flex-1 bg-green-600 text-white font-bold py-2 rounded-xl border-2 border-green-400 text-lg';
            document.getElementById('go-lb-tab-chill').className  = 'flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold py-2 rounded-xl border-2 border-transparent text-lg';
        } else {
            document.getElementById('go-lb-tab-chill').className  = 'flex-1 bg-cyan-600 text-white font-bold py-2 rounded-xl border-2 border-cyan-400 text-lg';
            document.getElementById('go-lb-tab-normal').className = 'flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold py-2 rounded-xl border-2 border-transparent text-lg';
        }
        renderGameOverLeaderboard();
    }

    function toggleGameoverLB() {
        const wrap = document.getElementById('gameover-lb-wrap');
        const btn  = document.getElementById('btn-gameover-lb');
        if (wrap.classList.contains('hidden')) {
            wrap.classList.remove('hidden');
            btn.textContent = '✕ Hide';
            // Default tab to match current game mode
            goLBTab = state.game.speedMultiplier < 1 ? 'chill' : 'normal';
            switchGOLBTab(goLBTab);
        } else {
            wrap.classList.add('hidden');
            btn.textContent = '🏆 Leaderboard';
        }
    }

    // Toggle leaderboard visibility on dashboard
    let lbViewTab = 'normal';

    function switchLBTab(tab) {
        lbViewTab = tab;
        if (tab === 'normal') {
            document.getElementById('lb-tab-normal').className = 'flex-1 bg-green-600 text-white font-bold py-2 rounded-xl border-2 border-green-400 text-lg';
            document.getElementById('lb-tab-chill').className  = 'flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold py-2 rounded-xl border-2 border-transparent text-lg';
        } else {
            document.getElementById('lb-tab-chill').className  = 'flex-1 bg-cyan-600 text-white font-bold py-2 rounded-xl border-2 border-cyan-400 text-lg';
            document.getElementById('lb-tab-normal').className = 'flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold py-2 rounded-xl border-2 border-transparent text-lg';
        }
        renderLeaderboard();
    }

    function toggleLeaderboard() {
        const modal = document.getElementById('lb-modal');
        if (!modal) return;
        if (modal.style.display === 'none' || !modal.style.display) {
            modal.style.display = 'flex';
            renderLeaderboard();
        } else {
            modal.style.display = 'none';
        }
    }

    return { renderLeaderboard, renderGameOverLeaderboard, goLBTab, switchGOLBTab, toggleGameoverLB, lbViewTab, switchLBTab, toggleLeaderboard };
}
