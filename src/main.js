/** Composition root. Factories register capabilities; callbacks run after wiring. */
const state = createState();
const app = {};
const context = { state, app };

app.debug = createDebugRecorder(context);
app.debugPanel = createDebugPanel(context);
app.trackingSafety = createTrackingSafety(context);
app.energy = createEnergy(context);
app.localization = createLocalization(context);
app.tutorial = createTutorial(context);
app.preferences = createPreferences(context);
app.progress = createProgress(context);
app.streak = createStreak(context);
app.scores = createScores(context);
app.leaderboards = createLeaderboards(context);
app.notifications = createNotifications(context);
app.viewport = createViewport(context);
app.audio = createAudio(context);
app.camera = createCamera(context);
app.finishPhoto = createFinishPhoto(context);
app.armPostures = createArmPostures(context);
app.laneGestures = createLaneGestures(context);
app.playerTracking = createPlayerTracking(context);
app.handCursor = createHandCursor(context);
app.handPointer = createHandPointer(context);
app.calibration = createCalibration(context);
app.calibrationPreview = createCalibrationPreview(context);
app.trackingStatus = createTrackingStatus(context);
app.pose = createPose(context);
app.controls = createControls(context);
app.world = createWorld(context);
app.entities = createEntities(context);
app.scene = createScene(context);
app.feedback = createFeedback(context);
app.hud = createHud(context);
app.session = createSession(context);
app.simulation = createSimulation(context);
app.warning = createWarning(context);
app.bootstrap = createBootstrap(context);

// Preserve the existing HTML onclick contract without exposing internal state.
window.toggleLeaderboard = app.leaderboards.toggleLeaderboard;
window.switchLBTab = app.leaderboards.switchLBTab;
window.switchGOLBTab = app.leaderboards.switchGOLBTab;

app.debugPanel.initializeDebugPanel();
app.debug.initializeDebug();
app.controls.bind();
app.bootstrap.initialize();
