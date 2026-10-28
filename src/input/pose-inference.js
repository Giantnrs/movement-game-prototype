/** Runs only inside a dedicated classic worker (including MediaPipe's WASM loader). */
function poseWorkerRuntime() {
    let landmarker;
    self.onmessage = async ({ data }) => {
        const { type, id, bitmap, timestamp } = data;
        try {
            if (type === 'init') {
                let vision;
                try {
                    vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm");
                } catch (error) {
                    vision = await import("https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.3");
                }
                const files = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm');
                const options = {
                    baseOptions: {
                        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
                        delegate: 'GPU'
                    },
                    runningMode: 'VIDEO',
                    numPoses: 4
                };
                let delegate = 'GPU';
                try {
                    options.canvas = new OffscreenCanvas(256, 256);
                    landmarker = await vision.PoseLandmarker.createFromOptions(files, options);
                } catch (error) {
                    // Machines without worker WebGL still infer off the UI thread.
                    delegate = 'CPU';
                    options.baseOptions.delegate = delegate;
                    delete options.canvas;
                    landmarker = await vision.PoseLandmarker.createFromOptions(files, options);
                }
                self.postMessage({ type: 'ready', id, delegate });
            } else if (type === 'frame') {
                const start = performance.now();
                const results = landmarker.detectForVideo(bitmap, timestamp);
                self.postMessage({ type: 'result', id, landmarks: results.landmarks,
                    inferenceMs: Math.round((performance.now() - start) * 10) / 10 });
            }
        } catch (error) {
            self.postMessage({ type: 'error', id, message: String(error) });
        } finally {
            bitmap?.close();
        }
    };
}

/** Owns worker lifecycle and one outstanding request; never queues camera frames. */
function createPoseInference({ app }) {
    let worker, pending, initialization, ready = false, nextId = 0, framePending = false;

    function fail(error) {
        ready = false;
        worker?.terminate();
        worker = undefined;
        if (pending) {
            clearTimeout(pending.timer);
            const reject = pending.reject;
            pending = undefined;
            reject(error);
        }
    }

    function request(message, transfers = [], timeout = 10000) {
        return new Promise((resolve, reject) => {
            const id = ++nextId;
            pending = { id, resolve, reject,
                timer: setTimeout(() => fail(new Error('Body tracking worker timed out')), timeout) };
            try { worker.postMessage({ ...message, id }, transfers); }
            catch (error) { fail(error); }
        });
    }

    function initializePoseInference() {
        if (ready) return Promise.resolve();
        if (initialization) return initialization;
        initialization = (async () => {
            const url = URL.createObjectURL(new Blob([`(${poseWorkerRuntime.toString()})();`], { type: 'text/javascript' }));
            try { worker = new Worker(url); }
            finally { URL.revokeObjectURL(url); }
            worker.onmessage = ({ data }) => {
                if (!pending || data.id !== pending.id) return;
                const current = pending;
                pending = undefined;
                clearTimeout(current.timer);
                if (data.type === 'error') current.reject(new Error(data.message));
                else current.resolve(data);
            };
            worker.onerror = event => {
                event.preventDefault();
                fail(new Error(event.message || 'Body tracking worker failed'));
            };
            worker.onmessageerror = () => fail(new Error('Body tracking worker returned an unreadable result'));
            const result = await request({ type: 'init' }, [], 30000);
            ready = true;
            app.debug.record('camera.worker.ready', { delegate: result.delegate });
        })().catch(error => { fail(error); throw error; }).finally(() => { initialization = undefined; });
        return initialization;
    }

    async function inferPose(bitmap, timestamp) {
        if (framePending) { bitmap.close(); throw new Error('Body tracking worker is busy'); }
        framePending = true;
        try {
            await initializePoseInference();
            return await request({ type: 'frame', bitmap, timestamp }, [bitmap]);
        } catch (error) {
            // Closing a transferred bitmap is harmless; capture/transfer failures
            // must also release the main-thread copy.
            bitmap.close();
            throw error;
        } finally {
            framePending = false;
        }
    }

    return { initializePoseInference, inferPose };
}
