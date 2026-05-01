(() => {
    const config = window.flappyRewardsConfig || {};
    const canvas = document.getElementById('flappy-canvas');

    if (!canvas) {
        return;
    }

    const frame = canvas.parentElement;
    const ctx = canvas.getContext('2d');
    const dom = {
        tries: document.getElementById('flappy-tries'),
        sideTries: document.getElementById('flappy-side-tries'),
        score: document.getElementById('flappy-score'),
        best: document.getElementById('flappy-best'),
        level: document.getElementById('flappy-level'),
        sideLevel: document.getElementById('flappy-side-level'),
        streak: document.getElementById('flappy-streak'),
        levelMeter: document.getElementById('flappy-level-meter'),
        panel: document.getElementById('flappy-panel'),
        panelKicker: document.getElementById('flappy-panel-kicker'),
        panelTitle: document.getElementById('flappy-panel-title'),
        panelMessage: document.getElementById('flappy-panel-message'),
        prizeCard: document.getElementById('flappy-prize-card'),
        prizeTitle: document.getElementById('flappy-prize-title'),
        prizeDescription: document.getElementById('flappy-prize-description'),
        primary: document.getElementById('flappy-primary'),
        pause: document.getElementById('flappy-pause'),
        countdown: document.getElementById('flappy-countdown'),
        toast: document.getElementById('flappy-toast')
    };

    const world = { width: 420, height: 600, ground: 536 };
    const bird = {
        x: 92,
        y: 260,
        radius: 17,
        velocity: 0,
        wing: 0
    };
    const state = {
        mode: 'ready',
        frame: 0,
        lastTime: 0,
        score: 0,
        level: 1,
        streak: 0,
        best: Number(window.localStorage.getItem('flappyRewardsBest') || 0),
        remainingPlays: Number(config.initialPlays || 0),
        submitting: false,
        pipes: [],
        particles: [],
        flashes: [],
        shake: 0,
        countdownTimer: null,
        returnTimer: null,
        milestoneHits: new Set()
    };

    function setText(element, value) {
        if (element) {
            element.textContent = value;
        }
    }

    function updateHud() {
        setText(dom.tries, state.remainingPlays);
        setText(dom.sideTries, state.remainingPlays);
        setText(dom.score, state.score);
        setText(dom.best, state.best);
        setText(dom.level, state.level);
        setText(dom.sideLevel, `Level ${state.level}`);
        setText(dom.streak, state.streak);

        if (dom.levelMeter) {
            dom.levelMeter.style.width = `${((state.score % 5) / 5) * 100}%`;
        }
    }

    function getDifficulty() {
        const level = Math.floor(state.score / 5) + 1;
        return {
            level,
            speed: Math.min(4.6, 2.65 + (level - 1) * 0.22),
            gap: Math.max(118, 158 - (level - 1) * 5),
            gravity: Math.min(0.5, 0.39 + (level - 1) * 0.012),
            pipeDistance: Math.max(154, 196 - (level - 1) * 4)
        };
    }

    function applyDifficulty() {
        state.level = getDifficulty().level;
    }

    function showToast(message) {
        if (!dom.toast) {
            return;
        }

        dom.toast.textContent = message;
        dom.toast.hidden = false;
        dom.toast.classList.remove('is-visible');
        window.requestAnimationFrame(() => dom.toast.classList.add('is-visible'));
        window.setTimeout(() => {
            dom.toast.classList.remove('is-visible');
            window.setTimeout(() => {
                dom.toast.hidden = true;
            }, 180);
        }, 1300);
    }

    function setPanel({ kicker, title, message, buttonText, showButton = true, prize = null }) {
        setText(dom.panelKicker, kicker);
        setText(dom.panelTitle, title);
        setText(dom.panelMessage, message);
        setText(dom.primary, buttonText || '');

        if (dom.primary) {
            dom.primary.hidden = !showButton;
        }

        if (prize) {
            dom.prizeCard.hidden = false;
            setText(dom.prizeTitle, prize.title);
            setText(dom.prizeDescription, prize.description || 'Reward saved to your history.');
        } else {
            dom.prizeCard.hidden = true;
            setText(dom.prizeTitle, '');
            setText(dom.prizeDescription, '');
        }

        dom.panel.classList.add('is-visible');
    }

    function hidePanel() {
        dom.panel.classList.remove('is-visible');
    }

    function roundRect(x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function createPipe(x) {
        const difficulty = getDifficulty();
        const minTop = 70;
        const maxTop = world.ground - difficulty.gap - 84;
        const topHeight = minTop + Math.random() * Math.max(1, maxTop - minTop);

        return {
            x,
            width: 66,
            topHeight,
            gap: difficulty.gap,
            passed: false,
            shine: Math.random() * Math.PI * 2
        };
    }

    function createParticles(x, y, count, color, spread = 1) {
        for (let i = 0; i < count; i += 1) {
            state.particles.push({
                x,
                y,
                vx: (Math.random() - 0.5) * 4.8 * spread,
                vy: (Math.random() - 0.5) * 4.8 * spread,
                life: 1,
                decay: 0.018 + Math.random() * 0.024,
                radius: 2 + Math.random() * 3,
                color
            });
        }
    }

    function resetRound() {
        bird.y = 260;
        bird.velocity = 0;
        bird.wing = 0;
        state.frame = 0;
        state.lastTime = 0;
        state.score = 0;
        state.level = 1;
        state.streak = 0;
        state.submitting = false;
        state.milestoneHits.clear();
        state.particles = [];
        state.flashes = [];
        state.shake = 0;
        state.pipes = [createPipe(world.width + 110), createPipe(world.width + 330)];
        updateHud();
    }

    function fitCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const maxHeight = Math.max(430, window.innerHeight - 156);
        const scale = Math.min(frame.clientWidth / world.width, maxHeight / world.height);

        canvas.style.width = `${world.width * scale}px`;
        canvas.style.height = `${world.height * scale}px`;
        canvas.width = world.width * dpr;
        canvas.height = world.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    function drawBackground() {
        const gradient = ctx.createLinearGradient(0, 0, 0, world.height);
        gradient.addColorStop(0, '#8ecdea');
        gradient.addColorStop(0.54, '#d5f0ed');
        gradient.addColorStop(1, '#f8eadb');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, world.width, world.height);

        ctx.fillStyle = 'rgba(255, 250, 245, 0.44)';
        ctx.beginPath();
        ctx.arc(344, 78, 38, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 250, 245, 0.86)';
        for (let i = 0; i < 5; i += 1) {
            const x = ((state.frame * 0.32) + i * 116) % (world.width + 140) - 90;
            const y = 66 + (i % 3) * 46;
            ctx.beginPath();
            ctx.ellipse(x, y, 34, 14, 0, 0, Math.PI * 2);
            ctx.ellipse(x + 24, y - 8, 28, 18, 0, 0, Math.PI * 2);
            ctx.ellipse(x + 54, y, 36, 15, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = 'rgba(61, 36, 23, 0.08)';
        for (let i = 0; i < 7; i += 1) {
            const width = 38 + (i % 3) * 10;
            const height = 78 + (i % 4) * 20;
            const x = ((i * 78) - (state.frame * 0.55)) % (world.width + 120) - 60;
            roundRect(x, world.ground - height, width, height, 10);
            ctx.fill();
        }
    }

    function drawPipes() {
        state.pipes.forEach((pipe) => {
            const bottomY = pipe.topHeight + pipe.gap;
            const pipeGradient = ctx.createLinearGradient(pipe.x, 0, pipe.x + pipe.width, 0);
            pipeGradient.addColorStop(0, '#247763');
            pipeGradient.addColorStop(0.5, '#35a080');
            pipeGradient.addColorStop(1, '#1d6658');

            ctx.fillStyle = pipeGradient;
            roundRect(pipe.x, -10, pipe.width, pipe.topHeight, 8);
            ctx.fill();
            roundRect(pipe.x - 8, pipe.topHeight - 18, pipe.width + 16, 24, 8);
            ctx.fill();
            roundRect(pipe.x, bottomY, pipe.width, world.ground - bottomY + 12, 8);
            ctx.fill();
            roundRect(pipe.x - 8, bottomY, pipe.width + 16, 24, 8);
            ctx.fill();

            ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
            ctx.fillRect(pipe.x + 12, 0, 8, Math.max(0, pipe.topHeight - 20));
            ctx.fillRect(pipe.x + 12, bottomY + 24, 8, Math.max(0, world.ground - bottomY - 24));
        });
    }

    function drawBird() {
        state.particles
            .filter((particle) => particle.color === 'trail')
            .forEach((particle) => {
                ctx.fillStyle = `rgba(255, 250, 245, ${particle.life * 0.5})`;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                ctx.fill();
            });

        ctx.save();
        ctx.translate(bird.x, bird.y);
        ctx.rotate(Math.max(-0.52, Math.min(0.62, bird.velocity / 12)));

        const bodyGradient = ctx.createRadialGradient(-6, -8, 2, 0, 0, 24);
        bodyGradient.addColorStop(0, '#ffe28b');
        bodyGradient.addColorStop(0.72, '#f5b640');
        bodyGradient.addColorStop(1, '#d58d25');
        ctx.fillStyle = bodyGradient;
        ctx.beginPath();
        ctx.ellipse(0, 0, 21, 16, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f7d875';
        ctx.beginPath();
        ctx.ellipse(-9, 3, 13, 7, -0.55 + Math.sin(bird.wing) * 0.22, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fffaf5';
        ctx.beginPath();
        ctx.arc(8, -6, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#3d2417';
        ctx.beginPath();
        ctx.arc(10, -6, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#e46d4f';
        ctx.beginPath();
        ctx.moveTo(18, -1);
        ctx.lineTo(35, 5);
        ctx.lineTo(18, 11);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawGround() {
        ctx.fillStyle = '#7c8b6f';
        ctx.fillRect(0, world.ground, world.width, world.height - world.ground);

        ctx.fillStyle = '#65785c';
        ctx.fillRect(0, world.ground, world.width, 7);

        ctx.fillStyle = 'rgba(255, 250, 245, 0.42)';
        for (let x = -40; x < world.width + 40; x += 38) {
            const offset = (state.frame * 2.2) % 38;
            ctx.fillRect(x - offset, world.ground + 18, 18, 5);
        }
    }

    function drawParticles() {
        state.particles
            .filter((particle) => particle.color !== 'trail')
            .forEach((particle) => {
                const alpha = Math.max(0, particle.life);
                const color = particle.color === 'gold'
                    ? `rgba(245, 182, 64, ${alpha})`
                    : `rgba(228, 109, 79, ${alpha})`;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                ctx.fill();
            });
    }

    function drawFlashes() {
        state.flashes.forEach((flash) => {
            ctx.save();
            ctx.globalAlpha = flash.life;
            ctx.fillStyle = '#fffaf5';
            ctx.font = '800 22px "Plus Jakarta Sans", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(flash.text, flash.x, flash.y);
            ctx.restore();
        });
    }

    function draw() {
        ctx.save();
        if (state.shake > 0) {
            ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
        }
        drawBackground();
        drawPipes();
        drawGround();
        drawBird();
        drawParticles();
        drawFlashes();
        ctx.restore();
    }

    function hitsPipe(pipe) {
        const padding = 5;
        const birdLeft = bird.x - bird.radius + padding;
        const birdRight = bird.x + bird.radius - padding;
        const birdTop = bird.y - bird.radius + padding;
        const birdBottom = bird.y + bird.radius - padding;
        const withinPipeX = birdRight > pipe.x && birdLeft < pipe.x + pipe.width;
        const withinGap = birdTop > pipe.topHeight && birdBottom < pipe.topHeight + pipe.gap;
        return withinPipeX && !withinGap;
    }

    function updateParticles(deltaScale) {
        state.particles.forEach((particle) => {
            particle.x += particle.vx * deltaScale;
            particle.y += particle.vy * deltaScale;
            particle.vy += 0.04 * deltaScale;
            particle.life -= particle.decay * deltaScale;
        });
        state.particles = state.particles.filter((particle) => particle.life > 0);

        state.flashes.forEach((flash) => {
            flash.y -= 0.55 * deltaScale;
            flash.life -= 0.018 * deltaScale;
        });
        state.flashes = state.flashes.filter((flash) => flash.life > 0);

        state.shake = Math.max(0, state.shake - 0.35 * deltaScale);
    }

    function passPipe(pipe) {
        pipe.passed = true;
        state.score += 1;
        state.streak += 1;
        applyDifficulty();
        state.flashes.push({ text: `+${state.streak}`, x: bird.x + 20, y: bird.y - 24, life: 1 });
        createParticles(bird.x - 8, bird.y, 8, 'gold', 0.7);

        if ([5, 12, 20].includes(state.score) && !state.milestoneHits.has(state.score)) {
            state.milestoneHits.add(state.score);
            showToast(state.score === 5 ? 'Clean start' : state.score === 12 ? 'Hot streak' : 'Elite flight');
        }

        updateHud();
    }

    function updateWorld(deltaScale) {
        const difficulty = getDifficulty();
        state.frame += deltaScale;
        bird.wing += 0.32 * deltaScale;
        bird.velocity += difficulty.gravity * deltaScale;
        bird.y += bird.velocity * deltaScale;

        const lastPipe = state.pipes[state.pipes.length - 1];
        if (lastPipe && lastPipe.x < world.width - difficulty.pipeDistance) {
            state.pipes.push(createPipe(world.width + 24));
        }

        state.pipes.forEach((pipe) => {
            pipe.x -= difficulty.speed * deltaScale;
            if (!pipe.passed && pipe.x + pipe.width < bird.x) {
                passPipe(pipe);
            }
        });

        state.pipes = state.pipes.filter((pipe) => pipe.x + pipe.width > -32);

        if (state.frame % 3 < deltaScale) {
            state.particles.push({
                x: bird.x - 22,
                y: bird.y + 3,
                vx: -1.6,
                vy: (Math.random() - 0.5) * 0.6,
                life: 0.8,
                decay: 0.04,
                radius: 2 + Math.random() * 2,
                color: 'trail'
            });
        }

        updateParticles(deltaScale);

        const hitGround = bird.y + bird.radius >= world.ground;
        const hitCeiling = bird.y - bird.radius <= 0;
        const hitPipe = state.pipes.some(hitsPipe);

        if (hitGround || hitCeiling || hitPipe) {
            state.streak = 0;
            createParticles(bird.x, bird.y, 18, 'crash', 1.1);
            state.shake = 12;
            updateHud();
            endRound();
        }
    }

    function gameLoop(timestamp) {
        if (state.mode !== 'running') {
            return;
        }

        if (!state.lastTime) {
            state.lastTime = timestamp;
        }

        const delta = Math.min(32, timestamp - state.lastTime);
        state.lastTime = timestamp;
        updateWorld(delta / 16.67);
        draw();
        window.requestAnimationFrame(gameLoop);
    }

    function beginCountdown() {
        let count = 3;
        state.mode = 'countdown';
        dom.countdown.hidden = false;
        dom.countdown.textContent = count;
        dom.pause.disabled = true;

        window.clearInterval(state.countdownTimer);
        state.countdownTimer = window.setInterval(() => {
            count -= 1;

            if (count > 0) {
                dom.countdown.textContent = count;
                return;
            }

            window.clearInterval(state.countdownTimer);
            dom.countdown.hidden = true;
            state.mode = 'running';
            state.lastTime = 0;
            dom.pause.disabled = false;
            window.requestAnimationFrame(gameLoop);
        }, 640);
    }

    function startRound() {
        if (state.remainingPlays < 1 || state.submitting) {
            return;
        }

        resetRound();
        hidePanel();
        beginCountdown();
    }

    function pauseRound() {
        if (state.mode !== 'running') {
            return;
        }

        state.mode = 'paused';
        dom.pause.textContent = 'Resume';
        setPanel({
            kicker: 'Paused',
            title: 'Flight on hold',
            message: `Score ${state.score}. Best ${state.best}.`,
            buttonText: 'Resume'
        });
    }

    function resumeRound() {
        if (state.mode !== 'paused') {
            return;
        }

        hidePanel();
        state.mode = 'running';
        state.lastTime = 0;
        dom.pause.textContent = 'Pause';
        window.requestAnimationFrame(gameLoop);
    }

    function flap() {
        if (state.mode === 'running') {
            bird.velocity = -7.7;
            createParticles(bird.x - 16, bird.y + 8, 5, 'gold', 0.35);
            return;
        }

        if (state.mode === 'ready') {
            startRound();
        }
    }

    function endRound() {
        if (state.mode !== 'running' || state.submitting) {
            return;
        }

        state.mode = 'ended';
        state.submitting = true;
        state.best = Math.max(state.best, state.score);
        window.localStorage.setItem('flappyRewardsBest', String(state.best));
        dom.pause.disabled = true;
        dom.pause.textContent = 'Pause';
        updateHud();
        draw();
        submitScore();
    }

    function startReturn(message) {
        let countdown = 4;
        document.body.classList.add('is-returning');
        setPanel({
            kicker: 'All Tries Used',
            title: 'Returning to Vaniday',
            message: `${message} Returning in ${countdown} seconds.`,
            showButton: false
        });

        window.clearInterval(state.returnTimer);
        state.returnTimer = window.setInterval(() => {
            countdown -= 1;
            setText(dom.panelMessage, `${message} Returning in ${Math.max(countdown, 0)} seconds.`);

            if (countdown <= 0) {
                window.clearInterval(state.returnTimer);
                window.location.href = config.returnPath || '/rewards-game';
            }
        }, 1000);
    }

    async function submitScore() {
        setPanel({
            kicker: 'Saving',
            title: 'Recording your reward',
            message: 'Your run is being converted into a reward draw.',
            showButton: false
        });

        try {
            const response = await window.fetch(config.finishUrl || '/rewards-game/flappy/finish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    score: state.score,
                    level: state.level
                })
            });
            const data = await response.json();

            if (!data.ok) {
                state.remainingPlays = data.remainingPlays || 0;
                state.submitting = false;
                updateHud();
                startReturn(data.message || 'The game cannot continue right now.');
                return;
            }

            state.remainingPlays = data.remainingPlays;
            state.submitting = false;
            state.mode = 'ready';
            updateHud();

            if (data.shouldRedirect || state.remainingPlays < 1) {
                setPanel({
                    kicker: 'Reward Won',
                    title: data.prize.title,
                    message: `Score ${data.score}. Your reward is saved.`,
                    showButton: false,
                    prize: data.prize
                });
                window.setTimeout(() => startReturn('Your final reward has been saved.'), 1350);
                return;
            }

            setPanel({
                kicker: 'Reward Won',
                title: data.prize.title,
                message: `Score ${data.score}. You still have ${state.remainingPlays} tries left.`,
                buttonText: 'Play next try',
                prize: data.prize
            });
        } catch (error) {
            state.submitting = false;
            setPanel({
                kicker: 'Connection',
                title: 'Could not save this try',
                message: 'Please return to the rewards page and try again.',
                buttonText: 'Return to rewards'
            });
        }
    }

    function handlePrimaryAction() {
        if (dom.primary.textContent === 'Return to rewards') {
            window.location.href = config.returnPath || '/rewards-game';
            return;
        }

        if (state.mode === 'paused') {
            resumeRound();
            return;
        }

        startRound();
    }

    dom.primary.addEventListener('click', handlePrimaryAction);
    dom.pause.addEventListener('click', () => {
        if (state.mode === 'paused') {
            resumeRound();
        } else {
            pauseRound();
        }
    });
    canvas.addEventListener('pointerdown', flap);
    window.addEventListener('keydown', (event) => {
        if (event.code === 'Space') {
            event.preventDefault();
            flap();
        }

        if (event.key.toLowerCase() === 'p') {
            if (state.mode === 'paused') {
                resumeRound();
            } else {
                pauseRound();
            }
        }
    });
    window.addEventListener('resize', fitCanvas);

    updateHud();
    resetRound();
    fitCanvas();
    window.setTimeout(() => document.body.classList.add('is-loaded'), 420);
})();
