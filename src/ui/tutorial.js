/** tutorial: see docs/architecture.md for ownership and compatibility rules. */
function createTutorial({ state, app }) {
    const HEALTH_TIPS = [
        { title: "Every move counts", body: "Be as active as you can — any amount of movement is better than none, in whatever way works for you." },
        { title: "Sitting doesn't mean stopping!", body: "Chair-based stretching and resistance exercises still count toward your activity goals." },
        { title: "Start small, grow strong", body: "Build up your activity gradually — even a little more each week makes a real difference." },
        { title: "Ask your doctor first", body: "Before trying new exercises, check with your health practitioner — especially if you're just starting out." },
        { title: "Variety keeps you well", body: "Aim for a mix of gentle aerobic movement, resistance, balance, and flexibility — all adaptable to your ability." },
        { title: "Don't forget vitamin D", body: "Talk to your doctor about whether vitamin D supplements would benefit you — it's great for bones and muscles." }
    ];

    let instructionStep = 0;
    let instructionVoiceMuted = localStorage.getItem('instruction_voice_muted') === 'true';
    let instructionVoiceAudio = null;

    function stopInstructionVoice() {
        if (instructionVoiceAudio) {
            instructionVoiceAudio.pause();
            instructionVoiceAudio.currentTime = 0;
            instructionVoiceAudio = null;
        }
    }

    function playInstructionVoice(src) {
        if (instructionVoiceMuted || !src) return;
        stopInstructionVoice();
        instructionVoiceAudio = new Audio(src);
        instructionVoiceAudio.play().catch(() => {});
    }

    function updateInstructionMuteButton() {
        const btn = document.getElementById('instruction-mute');
        const iconOn = document.getElementById('instruction-mute-icon-on');
        const iconOff = document.getElementById('instruction-mute-icon-off');
        if (!btn || !iconOn || !iconOff) return;
        const dict = app.localization.translations[document.getElementById('lang-select').value];
        iconOn.classList.toggle('hidden', instructionVoiceMuted);
        iconOff.classList.toggle('hidden', !instructionVoiceMuted);
        btn.setAttribute('aria-pressed', String(instructionVoiceMuted));
        btn.setAttribute('aria-label', instructionVoiceMuted ? dict.instructionUnmute : dict.instructionMute);
    }

    function toggleInstructionMute() {
        instructionVoiceMuted = !instructionVoiceMuted;
        localStorage.setItem('instruction_voice_muted', instructionVoiceMuted);
        updateInstructionMuteButton();
        if (instructionVoiceMuted) {
            stopInstructionVoice();
        } else {
            const slide = getInstructionSlides()[instructionStep];
            if (slide.voice) playInstructionVoice(slide.voice);
        }
    }

    function getInstructionSlides() {
        return app.localization.translations[document.getElementById('lang-select').value].instructionSlides;
    }

    function renderInstructionSlide() {
        const slides = getInstructionSlides();
        const slide = slides[instructionStep];
        const dict = app.localization.translations[document.getElementById('lang-select').value];

        document.getElementById('txt-how-to-play').textContent = slide.subtitle ?? dict.howToPlay;
        document.getElementById('instruction-page-current').textContent = String(instructionStep + 1);
        document.getElementById('instruction-page-total').textContent = String(slides.length);

        const img = document.getElementById('instruction-image');
        const video = document.getElementById('instruction-video');
        video.pause();
        video.classList.add('hidden');
        img.classList.add('hidden');
        img.removeAttribute('src');
        video.removeAttribute('src');
        video.innerHTML = '';

        if (slide.mediaType === 'video') {
            const source = document.createElement('source');
            source.src = slide.media;
            source.type = slide.media.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
            video.appendChild(source);
            video.classList.remove('hidden');
            video.load();
            video.play().catch(() => {});
        } else {
            img.src = slide.media;
            img.classList.remove('hidden');
        }

        document.getElementById('instruction-prev').disabled = instructionStep === 0;

        stopInstructionVoice();
        if (slide.voice) playInstructionVoice(slide.voice);
    }

    function showInstructionsScreen() {
        app.notifications.clearOrbNotify();
        instructionStep = 0;
        document.getElementById('instructions-screen').classList.remove('hidden');
        updateInstructionMuteButton();
        renderInstructionSlide();
    }

    function finishInstructions() {
        stopInstructionVoice();
        const video = document.getElementById('instruction-video');
        video.pause();
        document.getElementById('instructions-screen').classList.add('hidden');
        document.getElementById('start-screen').classList.remove('hidden');
    }

    function advanceInstruction() {
        const slides = getInstructionSlides();
        if (instructionStep < slides.length - 1) {
            instructionStep++;
            renderInstructionSlide();
        } else {
            finishInstructions();
        }
    }

    function skipInstructions() {
        finishInstructions();
    }

    function goBackInstruction() {
        if (instructionStep > 0) { instructionStep--; renderInstructionSlide(); }
    }

    return { HEALTH_TIPS, instructionStep, instructionVoiceMuted, instructionVoiceAudio, stopInstructionVoice, playInstructionVoice, updateInstructionMuteButton, toggleInstructionMute, getInstructionSlides, renderInstructionSlide, showInstructionsScreen, finishInstructions, advanceInstruction, skipInstructions, goBackInstruction };
}
