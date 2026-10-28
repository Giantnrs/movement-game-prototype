/** camera: see docs/architecture.md for ownership and compatibility rules. */
function createCamera({ state, app }) {
    const videoElement = document.getElementById('webcam-video');
    let lastVideoTime = -1;
    let cameraFrameId = null;
    let trackingError = false;
    let playbackError = false;
    let inferenceMs = 0;
    let inferencePending = false;
    let inferenceWork;
    let poseGeneration = 0;
    let lastObservedTime = -1;

    function invalidatePoseFrame() { poseGeneration++; }
    document.addEventListener('visibilitychange', invalidatePoseFrame);

    function scheduleCameraFrame() {
        if (!state.session.isCameraInitialized || cameraFrameId !== null) return;
        cameraFrameId = requestAnimationFrame(() => {
            cameraFrameId = null;
            predictWebcam();
        });
    }

    async function startVideoPlayback() {
        videoElement.muted = true;
        videoElement.playsInline = true;
        videoElement.classList.remove('hidden');
        await videoElement.play();
        playbackError = false;
        app.debug.record('camera.playing', readCameraStatus());
        scheduleCameraFrame();
    }

    async function initCameraSequence() {
        try {
            await app.poseInference.initializePoseInference();
        } catch(e) {
            app.debug.record('camera.model.error', { message: String(e) });
            console.error("AI Load Error:", e);
            alert("Failed to load AI engine. Please check your internet connection.");
            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('hidden');
            return;
        }

        if (!state.session.isCameraInitialized) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
                videoElement.srcObject = stream;
                state.session.isCameraInitialized = true;
                app.debug.record('camera.acquired', readCameraStatus());
            } catch (err) {
                app.debug.record('camera.acquire.error', { message: String(err) });
                alert("Camera access is required. Please check your browser permissions.");
                document.getElementById('loading-screen').classList.add('hidden');
                document.getElementById('dashboard-screen').classList.remove('hidden');
                return;
            }
        }

        try {
            // Explicit playback also handles an existing stream paused by the
            // browser. Start one loop after playback, not only on loadeddata.
            await startVideoPlayback();
        } catch (error) {
            playbackError = true;
            app.debug.record('camera.playback.error', { message: String(error) });
            console.error('Camera playback failed:', error);
            alert('Camera video could not start. Please check your camera and try again.');
            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('hidden');
            return;
        }

        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('warning-screen').classList.remove('hidden');
    }

    // Camera mirror canvases
    const camSingle = document.getElementById('cam-single');
    const camLeft   = document.getElementById('cam-left');
    const camRight  = document.getElementById('cam-right');
    const ctxCamSingle = camSingle.getContext('2d');
    const ctxCamLeft   = camLeft.getContext('2d');
    const ctxCamRight  = camRight.getContext('2d');
    const camCalibration = document.getElementById('cam-calibration');
    const ctxCalibration = camCalibration.getContext('2d');
    const calibrationStatus = document.getElementById('calibration-camera-status');

    function showCalibrationPreview() {
        // Re-entry must show this run's live image, never a cached prior frame.
        ctxCalibration.clearRect(0, 0, camCalibration.width, camCalibration.height);
        calibrationStatus.hidden = false;
        camSingle.classList.add('hidden');
        document.getElementById('split-cam-container').style.display = 'none';
        if (state.session.isCameraInitialized && videoElement.paused) {
            startVideoPlayback().catch(error => {
                playbackError = true;
                app.debug.record('camera.playback.error', { message: String(error) });
                console.error('Camera playback failed:', error);
                drawCameraFeeds();
            });
        }
        scheduleCameraFrame();
        drawCameraFeeds();
    }

    function refreshCalibrationCameraStatus() {
        if (!['pre-calibrating', 'calibrating'].includes(state.game.gameState) || videoElement.readyState < 2 || videoElement.paused || videoElement.ended) return;
        calibrationStatus.textContent = trackingError
            ? 'Camera is live, but body tracking is unavailable. Try recalibrating.' : 'Waiting for camera...';
        calibrationStatus.hidden = !trackingError;
    }

    function drawCameraFeeds() {
        const calibrating = ['pre-calibrating', 'calibrating'].includes(state.game.gameState);
        if (!state.session.isCameraInitialized || videoElement.readyState < 2 || videoElement.paused || videoElement.ended) {
            if (calibrating) {
                ctxCalibration.clearRect(0, 0, camCalibration.width, camCalibration.height);
                calibrationStatus.textContent = playbackError
                    ? 'Camera video could not start. Go back and start the camera again.' : 'Waiting for camera...';
                calibrationStatus.hidden = false;
            }
            return;
        }
        const vw = videoElement.videoWidth || 640;
        const vh = videoElement.videoHeight || 480;
        if (calibrating) {
            // The full frame keeps both players visible; CSS mirrors only the
            // presentation, leaving pose coordinates and player matching intact.
            if (camCalibration.width !== vw) camCalibration.width = vw;
            if (camCalibration.height !== vh) camCalibration.height = vh;
            ctxCalibration.drawImage(videoElement, 0, 0, vw, vh);
            refreshCalibrationCameraStatus();
        }

        if (state.session.numPlayers === 1) {
            ctxCamSingle.drawImage(videoElement, 0, 0, camSingle.width, camSingle.height);
        } else {
            // cam-left (left side of screen) → RIGHT half of raw video (shows person standing on left)
            ctxCamLeft.save();
            ctxCamLeft.translate(camLeft.width, 0);
            ctxCamLeft.scale(-1, 1);
            ctxCamLeft.drawImage(videoElement, vw / 2, 0, vw / 2, vh, 0, 0, camLeft.width, camLeft.height);
            ctxCamLeft.restore();

            // cam-right (right side of screen) → LEFT half of raw video (shows person standing on right)
            ctxCamRight.save();
            ctxCamRight.translate(camRight.width, 0);
            ctxCamRight.scale(-1, 1);
            ctxCamRight.drawImage(videoElement, 0, 0, vw / 2, vh, 0, 0, camRight.width, camRight.height);
            ctxCamRight.restore();
        }
    }

    function showCameraForMode() {
        if (state.session.numPlayers === 1) {
            camSingle.classList.remove('hidden');
            document.getElementById('split-cam-container').style.display = 'none';
        } else {
            camSingle.classList.add('hidden');
            document.getElementById('split-cam-container').style.display = 'flex';
        }
    }

    function reportInferenceError(error) {
        if (!trackingError) {
            console.error('Body tracking failed:', error);
            app.debug.record('camera.inference.error', { message: String(error), stack: String(error.stack || '').slice(0, 2000) });
        }
        trackingError = true;
        app.pose.onPoseResults({ landmarks: [] });
    }

    function predictWebcam() {
        let work;
        try {
            if (state.session.isCameraInitialized && !document.hidden &&
                ['playing', 'calibrating', 'pre-calibrating'].includes(state.game.gameState) &&
                videoElement.readyState >= 2 && !videoElement.paused && !videoElement.ended) {
                const videoTime = videoElement.currentTime;
                if (videoTime < lastObservedTime) { invalidatePoseFrame(); lastVideoTime = -1; }
                lastObservedTime = videoTime;
                if (lastVideoTime !== videoTime && !inferencePending) {
                    lastVideoTime = videoTime;
                    const capturedAt = performance.now();
                    const generation = poseGeneration;
                    const phase = state.game.gameState;
                    const count = state.session.numPlayers;
                    inferencePending = true;
                    // Capture/transfer one frame. While it runs, preview and game
                    // callbacks continue; the next request takes the newest video.
                    work = createImageBitmap(videoElement).then(bitmap => app.poseInference.inferPose(bitmap, capturedAt))
                        .then(result => {
                            const age = performance.now() - capturedAt;
                            if (generation !== poseGeneration || phase !== state.game.gameState || count !== state.session.numPlayers) return;
                            if (document.hidden || videoElement.paused || videoElement.ended ||
                                videoElement.currentTime < videoTime || age < 0 || age > 250) {
                                reportInferenceError(new Error('Body tracking frame is stale'));
                                return;
                            }
                            inferenceMs = result.inferenceMs;
                            trackingError = false;
                            app.pose.onPoseResults({ landmarks: result.landmarks || [] });
                            app.debug.sample('camera.frame', readCameraStatus());
                            app.debugPanel.drawDebugFrame(videoElement, result.landmarks || [], app.playerTracking.trackingReport());
                        }).catch(error => {
                            if (generation === poseGeneration && phase === state.game.gameState && count === state.session.numPlayers) reportInferenceError(error);
                        }).finally(() => {
                            inferencePending = false;
                            inferenceWork = undefined;
                            refreshCalibrationCameraStatus();
                        });
                    inferenceWork = work;
                }
            }
        } catch (error) {
            inferencePending = false;
            reportInferenceError(error);
        } finally {
            try { drawCameraFeeds(); }
            finally { scheduleCameraFrame(); }
        }
        return work || inferenceWork;
    }

    function readCameraStatus() {
        const track = videoElement.srcObject?.getVideoTracks()[0];
        const settings = track?.getSettings() || {};
        return { initialized: state.session.isCameraInitialized, readyState: videoElement.readyState,
            paused: videoElement.paused, ended: videoElement.ended, videoTime: videoElement.currentTime,
            width: videoElement.videoWidth, height: videoElement.videoHeight, frameRate: settings.frameRate,
            trackState: track?.readyState, inferenceMs, trackingError, playbackError };
    }

    return { videoElement, invalidatePoseFrame, initCameraSequence, camSingle, camLeft, camRight, ctxCamSingle, ctxCamLeft, ctxCamRight, drawCameraFeeds, showCalibrationPreview, showCameraForMode, predictWebcam, readCameraStatus };
}
