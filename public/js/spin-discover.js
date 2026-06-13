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
    const segments = Array.isArray(config.segments) ? config.segments : [];

    if (!form || !wheel || !button) {
        return;
    }

    let isSpinning = false;
    let currentRotation = 0;

    function setStatus(message) {
        if (status) {
            status.textContent = message;
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
            const segmentNode = wheel.querySelectorAll('.spin-wheel-segment')[typeIndex];
            const label = segmentNode ? segmentNode.querySelector('em') : null;
            if (label) label.textContent = reward.title || label.textContent;
            return typeIndex;
        }

        const lastIndex = Math.max(0, segments.length - 1);
        const segmentNode = wheel.querySelectorAll('.spin-wheel-segment')[lastIndex];
        const label = segmentNode ? segmentNode.querySelector('em') : null;
        const icon = segmentNode ? segmentNode.querySelector('b') : null;
        if (label) label.textContent = reward.title || 'Reward';
        if (icon) icon.textContent = rewardIcon(reward.rewardType);
        return lastIndex;
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
        if (!confetti) return;
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
        if (!noPrize) launchConfetti();
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.remove('is-open');
        modal.style.display = '';
        modal.hidden = true;
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
        return new Promise((resolve) => {
            const count = Math.max(1, segments.length);
            const index = findSegmentIndex(reward);
            const segmentAngle = 360 / count;
            const targetCenter = index * segmentAngle + segmentAngle / 2;
            const fullTurns = 4 + Math.floor(Math.random() * 2);
            const landingRotation = (fullTurns * 360) + (360 - targetCenter);
            currentRotation += landingRotation;
            setStatus('Spinning through live rewards...');

            wheel.classList.remove('has-spun');
            wheel.classList.add('is-spinning');
            wheel.getBoundingClientRect();

            window.requestAnimationFrame(() => {
                wheel.style.transform = `translateZ(0) rotate(${currentRotation}deg)`;
            });

            window.setTimeout(() => setStatus('Almost there...'), 1150);
            window.setTimeout(() => setStatus('Revealing your reward...'), 2100);
            window.setTimeout(() => {
                wheel.classList.remove('is-spinning');
                wheel.classList.add('has-spun');
                resolve();
            }, 2800);
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

    if (config.fallbackResult) {
        window.setTimeout(() => openModal(config.fallbackResult), 350);
    }
}());
