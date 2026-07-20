(function () {
    const config = window.spinDiscoverConfig || {};
    const form = document.querySelector('[data-spin-form]');
    const wheel = document.querySelector('[data-spin-wheel]');
    const button = document.querySelector('[data-spin-button]');
    const status = document.querySelector('[data-spin-status] span');
    const errorBox = document.querySelector('[data-spin-error]');
    const modal = document.querySelector('[data-spin-modal]');
    const confetti = document.querySelector('[data-spin-confetti]');
    const inlineResult = document.querySelector('[data-spin-result-inline]');
    const announcer = document.querySelector('[data-spin-announcer]');
    const segments = Array.isArray(config.segments) ? config.segments : [];
    const segmentNodes = Array.from(wheel ? wheel.querySelectorAll('[data-spin-segment]') : []);
    const pointer = document.querySelector('.spin-wheel-pointer');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    if (!form || !wheel || !button) {
        return;
    }

    let isSpinning = false;
    let currentRotation = 0;
    let lastFocusedElement = null;
    let pointerTickTimer = null;

    function setStatus(message) {
        if (status) {
            status.textContent = message;
        }
        if (announcer) {
            announcer.textContent = message;
        }
    }

    function showError(message) {
        if (!errorBox) return;
        const copy = errorBox.querySelector('p');
        if (copy) copy.textContent = message;
        errorBox.hidden = false;
    }

    function hideError() {
        if (errorBox) {
            errorBox.hidden = true;
        }
    }

    function formatType(value) {
        return String(value || 'reward').replace(/_/g, ' ');
    }

    function rewardIcon(type) {
        if (type === 'cashback') return '$';
        if (type === 'loyalty_points') return 'VG';
        if (type === 'product_discount') return 'P';
        if (type === 'service_discount') return 'S';
        if (type === 'try_again') return '*';
        return '%';
    }

    function formatDate(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function getRewardPayload(reward) {
        return reward && typeof reward.payload === 'object' && reward.payload ? reward.payload : {};
    }

    function findSegmentIndex(reward) {
        if (!segments.length) return 0;
        const sourceId = reward.sourceId === null || reward.sourceId === undefined ? '' : String(reward.sourceId);
        const exactIndex = segments.findIndex((segment) => {
            const segmentSourceId = segment.sourceId === null || segment.sourceId === undefined ? '' : String(segment.sourceId);
            return String(segment.sourceType || '') === String(reward.sourceType || '')
                && segmentSourceId === sourceId
                && String(segment.rewardType || '') === String(reward.rewardType || '');
        });

        if (exactIndex >= 0) return exactIndex;

        const typeIndex = segments.findIndex((segment) => String(segment.rewardType || '') === String(reward.rewardType || ''));
        if (typeIndex >= 0) {
            return typeIndex;
        }

        const lastIndex = Math.max(0, segments.length - 1);
        return lastIndex;
    }

    function normalizeAngle(value) {
        return ((value % 360) + 360) % 360;
    }

    function clearWinningSegment() {
        segmentNodes.forEach((node) => {
            node.classList.remove('is-winning');
            node.removeAttribute('data-winning');
        });
        wheel.classList.remove('has-winning-segment');
    }

    function highlightWinningSegment(index) {
        clearWinningSegment();
        const winningNode = segmentNodes[index];
        if (!winningNode) return;
        winningNode.classList.add('is-winning');
        winningNode.setAttribute('data-winning', 'true');
        wheel.classList.add('has-winning-segment');
    }

    function easeSpin(progress) {
        if (progress < 0.18) {
            const local = progress / 0.18;
            return 0.08 * local * local;
        }

        if (progress < 0.62) {
            return 0.08 + (0.62 * ((progress - 0.18) / 0.44));
        }

        const local = (progress - 0.62) / 0.38;
        return 0.7 + (0.3 * (1 - Math.pow(1 - local, 3)));
    }

    function triggerPointerTick() {
        if (!pointer || prefersReducedMotion.matches) return;
        pointer.classList.add('is-ticking');
        window.clearTimeout(pointerTickTimer);
        pointerTickTimer = window.setTimeout(() => {
            pointer.classList.remove('is-ticking');
        }, 90);
    }

    function updateTokenSummary(summary) {
        if (!summary) return;
        document.querySelectorAll('[data-spin-count]').forEach((node) => {
            node.textContent = Number(summary.available || 0);
        });
        document.querySelectorAll('[data-spin-used]').forEach((node) => {
            node.textContent = Number(summary.used || 0);
        });
        document.querySelectorAll('[data-spin-expired]').forEach((node) => {
            node.textContent = Number(summary.expired || 0);
        });
    }

    function prependHistory(reward) {
        const list = document.querySelector('[data-spin-history]');
        if (!list || !reward) return;

        const article = document.createElement('article');
        const title = document.createElement('strong');
        const meta = document.createElement('span');
        const saved = document.createElement('small');
        title.textContent = reward.title || 'Reward';
        meta.textContent = `${formatType(reward.rewardType)} - just now`;
        saved.textContent = reward.status === 'no_prize' ? 'No prize' : 'Saved to account';
        article.append(title, meta, saved);
        list.prepend(article);
    }

    function launchConfetti() {
        if (!confetti || prefersReducedMotion.matches) return;
        confetti.innerHTML = '';
        const colors = ['#d9b35f', '#83a474', '#bd7565', '#8eb1a0', '#fff2c7'];
        for (let index = 0; index < 34; index += 1) {
            const piece = document.createElement('span');
            piece.style.setProperty('--x', `${Math.random() * 220 - 110}px`);
            piece.style.setProperty('--delay', `${Math.random() * 180}ms`);
            piece.style.background = colors[index % colors.length];
            confetti.appendChild(piece);
        }
        confetti.classList.remove('is-active');
        window.requestAnimationFrame(() => confetti.classList.add('is-active'));
    }

    function openModal(reward) {
        if (!modal || !reward) return;
        const payload = getRewardPayload(reward);
        const merchantName = payload.salonName || payload.merchantName || reward.merchantName || '';
        const expiry = formatDate(payload.expiresAt || reward.expiresAt);
        const noPrize = reward.rewardType === 'try_again' || reward.status === 'no_prize';

        lastFocusedElement = document.activeElement;
        modal.querySelector('[data-spin-modal-icon]').textContent = rewardIcon(reward.rewardType);
        modal.querySelector('[data-spin-modal-type]').textContent = noPrize ? 'Keep discovering' : `You won - ${formatType(reward.rewardType)}`;
        modal.querySelector('[data-spin-modal-title]').textContent = reward.title || 'Reward unlocked';
        modal.querySelector('[data-spin-modal-description]').textContent = reward.description || '';
        modal.querySelector('[data-spin-modal-status]').textContent = noPrize ? 'No reward claimed this time' : 'Saved to your account';
        modal.querySelector('[data-spin-modal-instructions]').textContent = noPrize
            ? 'Complete another booking or product order to earn a new spin chance.'
            : 'Your reward has been saved. View your wallet or vouchers to redeem it on an eligible booking or checkout.';

        const merchantWrap = modal.querySelector('[data-spin-modal-merchant-wrap]');
        const merchantValue = modal.querySelector('[data-spin-modal-merchant]');
        merchantWrap.hidden = !merchantName;
        merchantValue.textContent = merchantName;

        const expiryWrap = modal.querySelector('[data-spin-modal-expiry-wrap]');
        const expiryValue = modal.querySelector('[data-spin-modal-expiry]');
        expiryWrap.hidden = !expiry;
        expiryValue.textContent = expiry;

        modal.hidden = false;
        modal.style.display = 'grid';
        modal.classList.add('is-open');
        const dialog = modal.querySelector('[role="dialog"]');
        if (dialog) {
            dialog.focus({ preventScroll: true });
        }
        if (!noPrize) launchConfetti();
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.remove('is-open');
        modal.style.display = '';
        modal.hidden = true;
        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus({ preventScroll: true });
        }
    }

    function showInlineResult(reward) {
        if (!inlineResult || !reward) return;
        const title = inlineResult.querySelector('[data-spin-result-title]');
        const description = inlineResult.querySelector('[data-spin-result-description]');
        if (title) title.textContent = reward.title || 'Reward unlocked';
        if (description) description.textContent = reward.description || 'Your reward has been saved to your account.';
        inlineResult.hidden = false;
        inlineResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function animateToReward(reward) {
        return new Promise((resolve, reject) => {
            const count = Math.max(1, segments.length);
            if (!count || !segmentNodes.length) {
                reject(new Error('The reward wheel is not available right now.'));
                return;
            }
            const index = findSegmentIndex(reward);
            const segmentAngle = 360 / count;
            const safeOffsetRange = Math.min(segmentAngle * 0.18, 8);
            const safeOffset = prefersReducedMotion.matches
                ? 0
                : (Math.random() * (safeOffsetRange * 2)) - safeOffsetRange;
            const targetModulo = normalizeAngle((-index * segmentAngle) + safeOffset);
            const startRotation = currentRotation;
            const currentModulo = normalizeAngle(startRotation);
            const forwardDelta = normalizeAngle(targetModulo - currentModulo);
            const fullTurns = prefersReducedMotion.matches ? 1 : 5 + (index % 2);
            const finalRotation = startRotation + (fullTurns * 360) + forwardDelta;
            const duration = prefersReducedMotion.matches ? 900 : 4800;
            let lastTickSegment = Math.floor(normalizeAngle(currentModulo + (segmentAngle / 2)) / segmentAngle);

            setStatus('Spinning through live rewards...');

            wheel.classList.remove('has-spun');
            wheel.classList.add('is-spinning');
            clearWinningSegment();
            wheel.getBoundingClientRect();

            const startedAt = window.performance.now();
            let statusStage = 0;

            function frame(now) {
                const progress = Math.min(1, (now - startedAt) / duration);
                const eased = easeSpin(progress);
                const nextRotation = startRotation + ((finalRotation - startRotation) * eased);
                const pointerSegment = Math.floor(normalizeAngle(nextRotation + (segmentAngle / 2)) / segmentAngle);

                wheel.style.transform = `translateZ(0) rotate(${nextRotation}deg)`;

                if (pointerSegment !== lastTickSegment) {
                    lastTickSegment = pointerSegment;
                    triggerPointerTick();
                }

                if (progress > 0.32 && statusStage === 0) {
                    statusStage = 1;
                    setStatus('Almost there...');
                } else if (progress > 0.72 && statusStage === 1) {
                    statusStage = 2;
                    setStatus('Revealing your reward...');
                }

                if (progress < 1) {
                    window.requestAnimationFrame(frame);
                    return;
                }

                currentRotation = normalizeAngle(finalRotation);
                wheel.style.transform = `translateZ(0) rotate(${currentRotation}deg)`;
                wheel.classList.remove('is-spinning');
                wheel.classList.add('has-spun');
                highlightWinningSegment(index);
                resolve();
            }

            window.requestAnimationFrame(frame);
        });
    }

    function serializeForm() {
        return new URLSearchParams(new FormData(form));
    }

    async function submitSpin(event) {
        event.preventDefault();

        if (!config.isCustomer) {
            window.location.href = config.loginUrl || '/login?returnTo=%2Fspin-discover';
            return;
        }

        if (isSpinning || button.disabled) {
            return;
        }

        hideError();
        isSpinning = true;
        button.disabled = true;
        button.classList.add('is-loading');
        button.querySelector('span').textContent = 'Spinning...';
        setStatus('Checking your spin eligibility...');

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                credentials: 'same-origin',
                body: serializeForm()
            });
            const payload = await response.json();

            if (!response.ok || !payload.ok) {
                throw new Error(payload.message || 'You do not have a spin chance available.');
            }

            await animateToReward(payload.reward);
            updateTokenSummary(payload.tokenSummary);
            prependHistory(payload.reward);
            showInlineResult(payload.reward);
            openModal(payload.reward);
            button.querySelector('span').textContent = Number(payload.tokenSummary?.available || 0) > 0 ? 'Spin again' : 'No spin chance available';
            button.disabled = Number(payload.tokenSummary?.available || 0) <= 0;
        } catch (error) {
            showError(error.message || 'Your spin could not be completed. Please try again.');
            setStatus('Spin could not be completed');
            button.disabled = false;
            button.querySelector('span').textContent = 'Spin now';
        } finally {
            button.classList.remove('is-loading');
            isSpinning = false;
        }
    }

    form.addEventListener('submit', submitSpin);
    document.querySelectorAll('[data-spin-close]').forEach((node) => {
        node.addEventListener('click', closeModal);
    });

    if (modal) {
        modal.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeModal();
                return;
            }

            if (event.key !== 'Tab') return;
            const focusable = Array.from(modal.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
                .filter((node) => !node.hasAttribute('hidden') && node.offsetParent !== null);
            if (!focusable.length) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
    }

    if (config.fallbackResult) {
        window.setTimeout(() => openModal(config.fallbackResult), 350);
    }
}());
