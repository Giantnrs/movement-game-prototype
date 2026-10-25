/** progress: see docs/architecture.md for ownership and compatibility rules. */
function createProgress({ state, app }) {
    // Old streaks may have been inflated by the prototype's special-name override.
    if (localStorage.getItem('streak_data_version') !== '1') {
        for (const key of ['last_login_date', 'current_streak', 'streak_bonus_claimed_date']) {
            localStorage.removeItem(key);
        }
        localStorage.setItem('streak_data_version', '1');
    }

    function getLocalDateKey(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function calculateStreak() {
        const now = new Date();
        const todayStr = getLocalDateKey(now);
        const lastLogin = localStorage.getItem('last_login_date');
        const savedStreak = Number(localStorage.getItem('current_streak'));
        let currentStreak = Number.isSafeInteger(savedStreak) && savedStreak > 0 ? savedStreak : 0;

        if (lastLogin !== todayStr || currentStreak === 0) {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            if (lastLogin === getLocalDateKey(yesterday)) currentStreak += 1;
            else currentStreak = 1;
            localStorage.setItem('last_login_date', todayStr);
            localStorage.setItem('current_streak', currentStreak);
            // Reset bonus-claimed flag on new day login
            localStorage.removeItem('streak_bonus_claimed_date');
        }
        const streakNumberEl = document.getElementById('streak-number');
        if (streakNumberEl) streakNumberEl.textContent = currentStreak;

        const claimedDate = localStorage.getItem('streak_bonus_claimed_date');
        document.getElementById('streak-reward-notice').classList.toggle('hidden', currentStreak < 3 || claimedDate === todayStr);
        return currentStreak;
    }

    return { calculateStreak, getLocalDateKey };
}
