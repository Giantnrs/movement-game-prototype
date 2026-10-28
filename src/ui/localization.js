/** localization: see docs/architecture.md for ownership and compatibility rules. */
function createLocalization({ state, app }) {
    const translations = {
        en: {
            themeDark: "Dark Theme", themeLight: "Light Theme",
            loginBrand: "ACTIVE RUNNER", loginSubtitle: "To Care for Kaumātua",
            loginQuote1: "\"Be strong, be brave, be steadfast\"",
            loginQuote2: "Move well, live well, stand tall.",
            loginNameLabel: "YOUR NAME", loginLangLabel: "LANGUAGE",
            loginLangEn: "English", loginLangMi: "Māori",
            loginBegin: "Let's begin, {name}!", loginBeginEmpty: "Let's begin!",
            welcome: "Welcome to Active Runner", instruction: "Please enter your name to begin.",
            placeholder: "Your Name", continueBtn: "Continue",
            hello: "Hello, ", streakTitle: "Daily Login Streak",
            playBtn: "Start Camera & Play", playSub: "Get ready to move!",
            leaderboard: "Top Players", rank: "Rank", name: "Name", score: "Score",
            leaderboardEmpty: "No scores yet. Play a game to set the first score!",
            leaderboardsCleared: "Local leaderboards cleared.",
            streakDay: "Day {day}",
            streakFirstDay: "Day 1 — great start! Come back tomorrow.",
            streakSecondDay: "Day 2 — you're on a roll! One more day for your first milestone.",
            streakMilestone: "🎉 {days} Days in a Row!",
            loadingAi: "Loading AI Engine...", loadingSub: "Please allow camera access when prompted.",
            warningTitle: "Safety Warning", warning1: "Please play in a clear, dry, non-slip area with enough room to move both arms.",
            warning2: "Go at your own pace and hold nearby support if needed.", warning3: "Stop immediately if you feel dizzy, unsteady, short of breath, or any pain.",
            warningBtn: "I understand", ready: "Ready to move?",
            readySub: "Step back so your upper body is visible. Stand still in the center to calibrate.",
            startCalBtn: "Start Calibration", standStill: "Stand Still...", learning: "Learning your neutral pose.",
            energyEstimateLabel: "Est. kcal",
            hudLiveRanking: "Live ranking", hudShields: "Shields",
            hudGameStatistics: "Game statistics", hudPlayerStatistics: "Player statistics", hudLocalRanking: "Live local ranking",
            finishPhotoTitle: "Your Active Runner finish", finishPhotoClose: "Close photo and show results",
            energyEstimateHelp: "Estimated total energy while playing, assuming 70 kg. Based on elapsed time and recent movement; pauses are excluded. Personal energy use varies.",
            trackingLost: "{players} lost — return to frame. Game paused.",
            trackingChecking: "Checking {players} — hold still. Game paused.",
            trackingUncertain: "Cannot identify {players} yet. Step apart and hold still — checking for the locked player. Game paused.",
            trackingError: "Game paused — camera tracking unavailable. Waiting for recovery.",
            trackingRecovering: "Game paused — hold still while tracking recovers.",
            trackingRecalibrate: "Recalibrate & restart",
            calibration: {
                prepare: "Get ready…",
                player: "Player {number}",
                selection: { selected: "Selected", ready: "Ready", paused: "Paused" },
                titles: { waiting: "Find your position", ready: "Good position!", sampling: "Calibrating..." },
                hold: "Hold comfortably still, with your arms relaxed down.",
                sample: "Stand comfortably — getting ready.",
                reasons: {
                    players: "Stand in the marked player zone(s). Keep shoulders and hips visible.",
                    uncertain: "Player selection is unclear. Step apart and keep your player zone clear.",
                    visibility: "Show your shoulders and hips clearly.",
                    frame: "Adjust your position until your shoulders and hips fit in the image.",
                    closer: "Move a little closer to the camera.",
                    back: "Step back a little so your upper body has room in the image.",
                    neutral: "Face the camera in a comfortable upright position.",
                    center: "Move roughly into the center of the image.",
                    sides: "Stand on separate sides of the image, with some space between you.",
                    steady: "Settle comfortably for a moment. Small hand movements are fine."
                }
            },
            gameOver: "Great Job!", finalScore: "Score: ", returnDash: "Return to Dashboard",
            hudScore1p: "Score", hudLives1p: "Lives", hudActivity1p: "Activity", hudSquats1p: "Squats", hudJumps1p: "Fly",
            speedNormal: "Normal Mode", speedChill: "Chill Mode",
            healthTipLabel: "Health tip", healthTipSource: "Source: NZ Ministry of Health",
            instructionScreenTitle: "Active Runner - How to play",
            howToPlay: "Use your body movement to dodge obstacles!",
            instructionSkip: "Skip tutorial",
            instructionMute: "Mute",
            instructionUnmute: "Unmute",
            instructionSlides: [
                { media: "assets/videos/left.mp4", mediaType: "video", accent: "blue", voice: "assets/audio/voice/left.mp3" },
                { media: "assets/videos/right.mp4", mediaType: "video", accent: "blue", voice: "assets/audio/voice/right.mp3" },
                { media: "assets/videos/fly.mp4", mediaType: "video", accent: "purple", voice: "assets/audio/voice/fly.mp3" },
                { media: "assets/videos/duck.mp4", mediaType: "video", accent: "green", voice: "assets/audio/voice/duck.mp3" },
                { media: "assets/images/powerup.jpg", mediaType: "image", accent: "indigo", subtitle: "✨POWER UP✨", voice: "assets/audio/voice/powerup.mp3" }
            ]
        },
        mi: {
            themeDark: "Kupu Pōuri", themeLight: "Kupu Mārama",
            loginBrand: "ACTIVE RUNNER", loginSubtitle: "Hei Tiaki i Ō Tūpuna",
            loginQuote1: "\"Kia kaha, kia māia, kia manawanui\"",
            loginQuote2: "Kia pai te neke, kia ora, kia tū pakari.",
            loginNameLabel: "TŌ INGOA", loginLangLabel: "REO",
            loginLangEn: "Ingarihi", loginLangMi: "Te Reo Māori",
            loginBegin: "Ka tīmata, {name}!", loginBeginEmpty: "Ka tīmata!",
            welcome: "Nau mai ki Active Runner", instruction: "Tuhia tō ingoa ki konei.",
            placeholder: "Tō Ingoa", continueBtn: "Haere Tonu",
            hello: "Tēnā koe, ", streakTitle: "Rā Takiuru (Streak)",
            playBtn: "Tīmata te Kāmera", playSub: "Kia rite ki te korikori!",
            leaderboard: "Ngā Toa o te Kēmu", rank: "Tūranga", name: "Ingoa", score: "Kaute",
            leaderboardEmpty: "Kāore anō he kaute. Tākaro kia whiwhi kaute!",
            leaderboardsCleared: "Kua mukua ngā kaute o tēnei pūtirotiro.",
            streakDay: "Rā {day}",
            streakFirstDay: "Rā 1 — ka pai! Hoki mai āpōpō.",
            streakSecondDay: "Rā 2 — ka pai! Kotahi anō te rā kia eke ki te taumata tuatahi.",
            streakMilestone: "🎉 {days} rā karapīpiti!",
            loadingAi: "E uta ana te Kāmera...", loadingSub: "Tukuna koa te kāmera kia kā.",
            warningTitle: "Whakatūpato Haumaru", warning1: "Me tākaro ki tētahi wāhi wātea, maroke.",
            warning2: "Kia tau te haere, puritia tētahi tūāpapa mehemea e tika ana.", warning3: "Kāti ināianei tonu mehemea ka pōrangi te māhunga, ka mamae rānei.",
            warningBtn: "Kua mārama ahau", ready: "Kua reri?",
            readySub: "Hoki whakamuri kia kitea te tinana. Tū mārie i waenganui.",
            startCalBtn: "Tīmata", standStill: "Tū Mārie...", learning: "E ako ana i tō tūnga.",
            energyEstimateLabel: "kcal whakatau",
            hudLiveRanking: "Tūranga", hudShields: "Ārai",
            hudGameStatistics: "Ngā tatauranga o te kēmu", hudPlayerStatistics: "Ngā tatauranga o ngā kaitākaro", hudLocalRanking: "Ngā tūranga ā-rohe",
            finishPhotoTitle: "Te mutunga o Active Runner", finishPhotoClose: "Katia te whakaahua, whakaatu ngā hua",
            energyEstimateHelp: "He whakatau pūngao mō te 70 kg, i runga i te wā tākaro me te korikori. Kāore ngā wā whakatā e tatauria.",
            trackingLost: "{players}: kua ngaro — hoki mai ki te kāmera. Kua whakatā te kēmu.",
            trackingChecking: "{players}: tū mārie kia mōhiotia ai. Kua whakatā te kēmu.",
            trackingUncertain: "Kāore anō kia mōhiotia a {players}. Tū wehe, tū mārie kia mōhiotia ai. Kua whakatā te kēmu.",
            trackingError: "Kua whakatā te kēmu — kāore e wātea te whai kāmera. E tatari ana.",
            trackingRecovering: "Kua whakatā te kēmu — tū mārie kia hoki mai te whai kāmera.",
            trackingRecalibrate: "Whakatikatika anō, tīmata anō",
            calibration: {
                prepare: "Kia rite…",
                player: "Kaitākaro {number}",
                selection: { selected: "Kua tīpakohia", ready: "Kua rite", paused: "Kua whakatā" },
                titles: { waiting: "Kimihia tō tūnga", ready: "Ka pai tō tūnga!", sampling: "E whakatika ana..." },
                hold: "Tū mārie, me ō ringa ki raro.",
                sample: "Tū pai — e whakarite ana.",
                reasons: {
                    players: "Tū ki ngā wāhi kua tohua mō ngā kaitākaro. Whakaaturia ō pakihiwi me tō hope.",
                    uncertain: "Kāore e mārama ko wai te kaitākaro. Tū wehe, kia wātea tō wāhi.",
                    visibility: "Whakaaturia ō pakihiwi me tō hope.",
                    frame: "Whakatikahia tō tūnga kia kitea ō pakihiwi me tō hope.",
                    closer: "Neke tata mai ki te kāmera.",
                    back: "Hoki whakamuri kia nui ake te wāhi mō tō tinana.",
                    neutral: "Anga ki te kāmera, tū pai.",
                    center: "Neke ki waenganui o te whakaahua.",
                    sides: "Tū ki ngā taha rerekē o te whakaahua, kia wātea te wāhi i waenganui.",
                    steady: "Kimihia he tūnga pai. Ka tīmata anō ina tū mārie koe."
                }
            },
            gameOver: "Ka Rawe!", finalScore: "Kaute: ", returnDash: "Hoki ki te Pīhono",
            hudScore1p: "Kaute", hudLives1p: "Oranga", hudActivity1p: "Mahi", hudSquats1p: "Piko", hudJumps1p: "Rere",
            speedNormal: "Mahi Pūnoa", speedChill: "Mahi Whakatā",
            healthTipLabel: "Kupu hauora", healthTipSource: "Pūtake: Manatū Hauora — NZ Ministry of Health",
            instructionScreenTitle: "Active Runner - How to play",
            howToPlay: "Use your body movement to dodge obstacles!",
            instructionSkip: "Peke i te aratohu",
            instructionMute: "Whakakore oro",
            instructionUnmute: "Whakakā oro",
            instructionSlides: [
                { media: "assets/videos/left.mp4", mediaType: "video", accent: "blue", voice: "assets/audio/voice/left.mp3" },
                { media: "assets/videos/right.mp4", mediaType: "video", accent: "blue", voice: "assets/audio/voice/right.mp3" },
                { media: "assets/videos/fly.mp4", mediaType: "video", accent: "purple", voice: "assets/audio/voice/fly.mp3" },
                { media: "assets/videos/duck.mp4", mediaType: "video", accent: "green", voice: "assets/audio/voice/duck.mp3" },
                { media: "assets/images/powerup.jpg", mediaType: "image", accent: "indigo", subtitle: "✨POWER UP✨", voice: "assets/audio/voice/powerup.mp3" }
            ]
        }
    };

    const elementsToTranslate = {
        'txt-theme-dark': 'themeDark', 'txt-theme-light': 'themeLight',
        'txt-login-subtitle': 'loginSubtitle',
        'txt-login-quote1': 'loginQuote1', 'txt-login-quote2': 'loginQuote2',
        'txt-login-name-label': 'loginNameLabel', 'txt-login-lang-label': 'loginLangLabel',
        'txt-welcome': 'welcome', 'txt-instruction': 'instruction',
        'txt-hello': 'hello', 'txt-streak-title': 'streakTitle',
        'txt-play-btn': 'playBtn', 'txt-play-sub': 'playSub', 'txt-leaderboard': 'leaderboard',
        'txt-rank': 'rank', 'txt-name': 'name', 'txt-score': 'score',
        'txt-loading-ai': 'loadingAi', 'txt-loading-sub': 'loadingSub',
        'txt-warning-title': 'warningTitle', 'txt-warning-1': 'warning1',
        'txt-warning-2': 'warning2', 'txt-warning-3': 'warning3', 'warning-continue-btn': 'warningBtn',
        'txt-ready': 'ready', 'txt-ready-sub': 'readySub', 'start-btn': 'startCalBtn',
        'txt-stand-still': 'standStill', 'txt-learning': 'learning',
        'txt-game-over': 'gameOver', 'txt-final-score': 'finalScore',
        'restart-btn': 'returnDash',
        'txt-hud-score-1p': 'hudScore1p', 'txt-hud-lives-1p': 'hudLives1p', 'txt-hud-activity-1p': 'hudActivity1p',
        'txt-hud-squats-1p': 'hudSquats1p', 'txt-hud-jumps-1p': 'hudJumps1p',
        'txt-hud-shields-1p': 'hudShields',
        'txt-hud-score-p2': 'hudScore1p', 'txt-hud-lives-p2': 'hudLives1p', 'txt-hud-shields-p2': 'hudShields',
        'txt-hud-score-p1': 'hudScore1p', 'txt-hud-lives-p1': 'hudLives1p', 'txt-hud-shields-p1': 'hudShields',
        'btn-speed-normal': 'speedNormal', 'btn-speed-chill': 'speedChill',
        'txt-health-tip-label': 'healthTipLabel', 'txt-health-tip-source': 'healthTipSource',
        'txt-instruction-screen-title': 'instructionScreenTitle', 'txt-how-to-play': 'howToPlay',
        'instruction-skip': 'instructionSkip'
    };

    const LOGIN_LANG_BTN_ACTIVE = 'flex-1 bg-indigo-600 text-white font-black py-4 rounded-2xl border-4 border-indigo-400 transform transition hover:scale-105 active:scale-95 text-2xl login-ui';
    const LOGIN_LANG_BTN_INACTIVE = 'flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-black py-4 rounded-2xl border-4 border-transparent transform transition hover:scale-105 active:scale-95 text-2xl login-ui';

    function setLoginLang(lang) {
        const select = document.getElementById('lang-select');
        if (select.value !== lang) select.value = lang;
        document.getElementById('lang-btn-en').className = lang === 'en' ? LOGIN_LANG_BTN_ACTIVE : LOGIN_LANG_BTN_INACTIVE;
        document.getElementById('lang-btn-mi').className = lang === 'mi' ? LOGIN_LANG_BTN_ACTIVE : LOGIN_LANG_BTN_INACTIVE;
        updateLanguage(lang);
    }

    function updateLoginBeginButton() {
        const lang = document.getElementById('lang-select').value;
        const dict = translations[lang];
        const name = document.getElementById('player-name').value.trim();
        const el = document.getElementById('txt-login-begin');
        if (!el) return;
        el.textContent = name
            ? dict.loginBegin.replace('{name}', name)
            : dict.loginBeginEmpty;
    }

    function updateLoginNameCheck() {
        const name = document.getElementById('player-name').value.trim();
        document.getElementById('login-name-check').classList.toggle('is-visible', name.length > 0);
        updateLoginBeginButton();
    }

    function updateLoginThemeIcon() {
        const isDark = document.documentElement.classList.contains('dark');
        document.getElementById('login-theme-icon-light').classList.toggle('hidden', isDark);
        document.getElementById('login-theme-icon-dark').classList.toggle('hidden', !isDark);
    }

    function updateLanguage(lang) {
        const dict = translations[lang];
        const calibrating = ['pre-calibrating', 'calibrating'].includes(state.game.gameState);
        for (const [id, key] of Object.entries(elementsToTranslate)) {
            if (calibrating && ['txt-stand-still', 'txt-learning'].includes(id)) continue;
            const el = document.getElementById(id);
            if (el) el.textContent = dict[key];
        }
        document.getElementById('hud-1p').setAttribute('aria-label', dict.hudGameStatistics);
        document.getElementById('hud-2p').setAttribute('aria-label', dict.hudPlayerStatistics);
        document.getElementById('hud-ranking-1p').setAttribute('aria-label', dict.hudLocalRanking);
        document.getElementById('player-name').placeholder = dict.placeholder;
        document.getElementById('lang-btn-en').textContent = dict.loginLangEn;
        document.getElementById('lang-btn-mi').textContent = dict.loginLangMi;
        updateLoginBeginButton();
        if (!document.getElementById('dashboard-screen').classList.contains('hidden')) {
            document.getElementById('txt-hello').textContent = dict.hello + state.session.currentPlayerName + "!";
        }
        if (!document.getElementById('instructions-screen').classList.contains('hidden')) {
            app.tutorial.updateInstructionMuteButton();
            app.tutorial.renderInstructionSlide();
        }
        if (!document.getElementById('streak-screen').classList.contains('hidden')) {
            app.streak.renderStreak(Number(localStorage.getItem('current_streak')) || 1);
        }
        app.leaderboards.renderLeaderboard();
        app.leaderboards.renderGameOverLeaderboard();
        if (calibrating) app.trackingStatus.refreshCalibrationLanguage();
        if (state.game.gameState === 'playing') app.hud.updateHUD();
        localStorage.setItem('game_lang', lang);
    }

    return { translations, elementsToTranslate, LOGIN_LANG_BTN_ACTIVE, LOGIN_LANG_BTN_INACTIVE, setLoginLang, updateLoginBeginButton, updateLoginNameCheck, updateLoginThemeIcon, updateLanguage };
}
