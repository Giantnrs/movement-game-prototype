/** Presents earned streak days in order; persistence is owned by progress. */
function createStreak({ app }) {
    const dotClasses = 'w-16 h-16 rounded-full border-4 flex items-center justify-center text-2xl font-black ';

    function renderStreak(streak) {
        const dict = app.localization.translations[document.getElementById('lang-select').value];
        document.getElementById('streak-big-number').textContent = streak;
        document.getElementById('streak-big-msg').textContent = streak === 1 ? dict.streakFirstDay
            : streak === 2 ? dict.streakSecondDay : dict.streakMilestone.replace('{days}', streak);

        for (let day = 1; day <= 3; day++) {
            const dot = document.getElementById(`streak-day-${day}`);
            const completed = streak >= day;
            dot.className = dotClasses + (completed ? 'border-green-500 bg-green-500/20 text-green-600' : 'border-gray-400 text-gray-400');
            dot.textContent = completed ? '✓' : '';
            if (day === Math.min(streak, 3)) dot.setAttribute('aria-current', 'step');
            else dot.removeAttribute('aria-current');
            const label = dict.streakDay.replace('{day}', day);
            document.getElementById(`streak-day-label-${day}`).textContent = label;
            dot.setAttribute('aria-label', label);
        }
    }

    return { renderStreak };
}
