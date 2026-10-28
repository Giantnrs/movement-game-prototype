/** Hand cursor presentation, hit testing and fresh-observation dwell clicks. */
function createHandCursor({ state, app }) {
    const cursor = document.getElementById('hand-cursor');
    const ring = document.getElementById('hand-cursor-progress');
    let target = null, lastAt, offSince, elapsed = 0, confirmed = false, fired = false, contextKey = '';

    function clearHandCursor() {
        if (target) target.removeAttribute('data-hand-hover');
        target = null;
        lastAt = offSince = undefined;
        elapsed = 0;
        confirmed = false;
        fired = false;
        contextKey = '';
        cursor.hidden = true;
        ring.style.strokeDashoffset = '100';
        cursor.dataset.progress = '0';
        cursor.dataset.paused = 'false';
    }

    function buttonAt(point, modal) {
        const element = document.elementFromPoint(point.x, point.y);
        const button = element?.closest('button, [role="button"]');
        if (!button || !button.isConnected || button.matches(':disabled, [aria-disabled="true"]') ||
            button.closest('[hidden], [inert], [aria-hidden="true"]') || (modal && !modal.contains(button))) return null;
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        for (let parent = button.parentElement; parent; parent = parent.parentElement) {
            if (Number(getComputedStyle(parent).opacity) === 0) return null;
        }
        return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0 &&
            rect.width > 0 && rect.height > 0 ? button : null;
    }

    function distanceFromButton(rect, point) {
        return Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right),
            Math.max(rect.top - point.y, 0, point.y - rect.bottom));
    }

    function targetMargin(rect) {
        // Only hand hit testing grows. Small controls receive more assistance;
        // their layout, appearance and mouse/touch hit boxes stay unchanged.
        return Math.max(18, Math.min(36, (104 - Math.min(rect.width, rect.height)) / 2));
    }

    function visibleAtNearestPoint(button, rect, point, modal) {
        return buttonAt({ x: Math.max(rect.left + 1, Math.min(rect.right - 1, point.x)),
            y: Math.max(rect.top + 1, Math.min(rect.bottom - 1, point.y)) }, modal) === button;
    }

    function targetAt(point, modal) {
        const direct = buttonAt(point, modal);
        if (direct) return direct;
        // Do not reach past another actual control, including disabled buttons
        // and text fields, to select a neighboring button by proximity.
        if (document.elementFromPoint(point.x, point.y)?.closest('button, [role="button"], input, select, textarea, a[href]')) return null;
        let nearest = null, nearestDistance = Infinity, nearestCenter = Infinity;
        for (const button of (modal || document).querySelectorAll('button, [role="button"]')) {
            const rect = button.getBoundingClientRect();
            const distance = distanceFromButton(rect, point);
            if (distance > targetMargin(rect) || !visibleAtNearestPoint(button, rect, point, modal)) continue;
            const center = Math.hypot(point.x - (rect.left + rect.width / 2), point.y - (rect.top + rect.height / 2));
            if (distance < nearestDistance || (distance === nearestDistance && center < nearestCenter)) {
                nearest = button;
                nearestDistance = distance;
                nearestCenter = center;
            }
        }
        return nearest;
    }

    function nearButton(button, point, modal, wrist = false) {
        const rect = button.getBoundingClientRect();
        const margin = targetMargin(rect) + (wrist ? 24 : 10);
        if (distanceFromButton(rect, point) > margin) return false;
        const hit = buttonAt(point, modal);
        if (!wrist && hit && hit !== button) return false;
        if (!wrist && !hit && document.elementFromPoint(point.x, point.y)?.closest('button, [role="button"], input, select, textarea, a[href]')) return false;
        // Check the nearest point inside the button too: tolerance must never
        // let a hidden, covered or disabled button remain selected.
        return visibleAtNearestPoint(button, rect, point, modal);
    }

    function updateHandCursor(point, raw, now) {
        const modal = document.querySelector('dialog[open]');
        const key = `${state.game.gameState}:${state.session.numPlayers}:${modal?.id || ''}`;
        if (key !== contextKey || (lastAt !== undefined && (now <= lastAt || now - lastAt > 250))) clearHandCursor();
        contextKey = key;
        const dt = lastAt === undefined ? 0 : now - lastAt;
        lastAt = now;
        // A native dialog is in the top layer; place the cursor inside it too.
        const parent = modal || document.body;
        if (cursor.parentNode !== parent) parent.appendChild(cursor);
        cursor.hidden = false;
        cursor.style.left = `${point.x}px`;
        cursor.style.top = `${point.y}px`;
        const hit = targetAt(point, modal);
        let next = null, inside = false;
        if (target && nearButton(target, point, modal)) {
            if (nearButton(target, raw, modal, true)) { next = target; inside = true; offSince = undefined; }
            else if (!buttonAt(raw, modal)) {
                offSince ??= now;
                // Ignore one short raw-coordinate spike without counting it as
                // dwell or clicking from a stale smoothed hand position.
                if (now - offSince <= 120) next = target;
            }
        }
        if (!next && hit && nearButton(hit, raw, modal, true)) { next = hit; inside = true; }
        if (target !== next) {
            if (target) target.removeAttribute('data-hand-hover');
            target = next;
            elapsed = 0;
            confirmed = false;
            offSince = undefined;
            fired = false;
        }
        if (target && inside && confirmed && !fired) elapsed += dt;
        confirmed = inside;
        // Fractional camera timestamps can sum to just below exactly two
        // seconds. Normalize floating-point roundoff without counting a missing
        // observation or an unconfirmed interval as dwell.
        if (Math.abs(elapsed - 2000) < 1e-7) elapsed = 2000;
        const progress = !target || fired ? 0 : Math.min(1, elapsed / 2000);
        cursor.dataset.progress = String(progress);
        cursor.dataset.paused = String(!!target && !inside);
        ring.style.strokeDashoffset = String(100 * (1 - progress));
        if (target && !fired) target.setAttribute('data-hand-hover', 'true');
        if (target && inside && progress === 1 && !fired) {
            const button = target;
            fired = true;
            button.removeAttribute('data-hand-hover');
            button.click();
        }
    }

    document.addEventListener('pointerdown', clearHandCursor, true);
    document.addEventListener('keydown', clearHandCursor, true);
    document.addEventListener('scroll', clearHandCursor, true);
    return { updateHandCursor, clearHandCursor };
}
