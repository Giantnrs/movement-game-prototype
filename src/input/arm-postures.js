/** Camera-space geometry for the extended, level-arm duck gesture. */
function createArmPostures({ app }) {
    const MIN_CONFIDENCE = 0.6;
    const MAX_WRIST_ANGLE = 20;
    const MAX_ELBOW_ANGLE = 25;
    const MIN_EXTENSION_ANGLE = 150;

    function tracked(point) {
        return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
            ['visibility', 'presence'].every(key => point[key] === undefined ||
                (Number.isFinite(point[key]) && point[key] >= MIN_CONFIDENCE));
    }

    function readLevelArms(landmarks) {
        if (![11,12,13,14,15,16].every(index => tracked(landmarks?.[index]))) {
            return { detected: false, reason: 'visibility' };
        }
        const video = app.camera.videoElement;
        const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
        const point = index => ({ x: landmarks[index].x * aspect, y: landmarks[index].y });
        const leftShoulder = point(11), rightShoulder = point(12);
        const span = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y);
        if (span < 0.03 || Math.abs(leftShoulder.x - rightShoulder.x) < 0.03) {
            return { detected: false, reason: 'shoulders' };
        }

        function arm(shoulder, otherShoulder, elbow, wrist) {
            const outward = Math.sign(shoulder.x - otherShoulder.x);
            const wristX = (wrist.x - shoulder.x) * outward;
            const elbowX = (elbow.x - shoulder.x) * outward;
            const wristAngle = Math.atan2(Math.abs(wrist.y - shoulder.y), wristX) * 180 / Math.PI;
            const elbowAngle = Math.atan2(Math.abs(elbow.y - shoulder.y), elbowX) * 180 / Math.PI;
            const upper = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y };
            const forearm = { x: wrist.x - elbow.x, y: wrist.y - elbow.y };
            const length = Math.hypot(upper.x, upper.y) * Math.hypot(forearm.x, forearm.y);
            const extension = length > 0 ? Math.acos(Math.max(-1, Math.min(1,
                (upper.x * forearm.x + upper.y * forearm.y) / length))) * 180 / Math.PI : 0;
            const extended = wristX >= span * 0.65 && elbowX >= span * 0.2 && extension >= MIN_EXTENSION_ANGLE;
            const level = wristAngle <= MAX_WRIST_ANGLE && elbowAngle <= MAX_ELBOW_ANGLE;
            return { detected: extended && level, extended, level, wristAngle, elbowAngle,
                extension, outwardShoulderWidths: wristX / span };
        }

        const left = arm(leftShoulder, rightShoulder, point(13), point(15));
        const right = arm(rightShoulder, leftShoulder, point(14), point(16));
        return { detected: left.detected && right.detected, left, right };
    }

    return { readLevelArms };
}
