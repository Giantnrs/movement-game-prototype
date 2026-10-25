/** Presents simulation feedback without owning game rules or timers. */
function createFeedback() {
    function hideShieldActive() {
        document.getElementById('shield-active-hud').classList.add('hidden');
    }

    function hideLevelUp() {
        document.getElementById('level-up-overlay').classList.add('hidden');
    }

    function showLevelUp(message) {
        document.getElementById('level-prompt-text').innerText = message;
        document.getElementById('level-up-overlay').classList.remove('hidden');
    }

    return { hideShieldActive, hideLevelUp, showLevelUp };
}
