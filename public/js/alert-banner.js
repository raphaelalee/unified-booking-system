(() => {
    const ALERT_TYPES = new Set(['success', 'error', 'warning', 'info']);
    const ICONS = {
        success: 'OK',
        error: '!',
        warning: '!',
        info: 'i'
    };
    const TITLES = {
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        info: 'Info'
    };
    const DEFAULT_TIMEOUTS = {
        success: 4500,
        info: 4500,
        warning: 8500,
        error: 0
    };

    const getContainer = () => {
        let container = document.querySelector('[data-alert-container]');

        if (!container) {
            container = document.createElement('div');
            container.className = 'alert-banner-container';
            container.dataset.alertContainer = '';
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('aria-relevant', 'additions');
            document.body.appendChild(container);
        }

        document.querySelectorAll('[data-alert-container]').forEach((item) => {
            if (item !== container) {
                item.remove();
            }
        });

        return container;
    };

    const normalizeType = (type) => {
        const value = String(type || '').toLowerCase();
        if (value === 'danger') return 'error';
        if (value === 'warn') return 'warning';
        return ALERT_TYPES.has(value) ? value : 'info';
    };

    const getTypeFromElement = (element) => {
        if (element.dataset.alertType) return normalizeType(element.dataset.alertType);
        if (element.classList.contains('success') || element.classList.contains('alert-success')) return 'success';
        if (element.classList.contains('error') || element.classList.contains('danger') || element.classList.contains('alert-danger')) return 'error';
        if (element.classList.contains('warning') || element.classList.contains('alert-warning')) return 'warning';
        if (element.classList.contains('info') || element.classList.contains('alert-info')) return 'info';
        return 'info';
    };

    const dismiss = (banner) => {
        if (!banner || banner.dataset.alertDismissing === 'true') return;
        banner.dataset.alertDismissing = 'true';
        banner.classList.add('is-dismissing');
        window.setTimeout(() => banner.remove(), 180);
    };

    const scheduleDismiss = (banner, type, timeout) => {
        const delay = Number(timeout || DEFAULT_TIMEOUTS[type] || 0);
        if (!delay) return;
        window.setTimeout(() => dismiss(banner), delay);
    };

    const show = ({ type = 'info', title, message, timeout } = {}) => {
        const normalizedType = normalizeType(type);
        const text = String(message || '').trim();

        if (!text) return null;

        const container = getContainer();
        const duplicate = Array.from(container.querySelectorAll('[data-alert-banner]')).find((item) => {
            return normalizeType(item.dataset.alertType) === normalizedType
                && item.querySelector('.alert-banner-copy p')?.textContent.trim() === text;
        });

        if (duplicate) return duplicate;

        const banner = document.createElement('article');
        banner.className = `alert-banner is-${normalizedType}`;
        banner.dataset.alertBanner = '';
        banner.dataset.alertType = normalizedType;
        banner.innerHTML = `
            <span class="alert-banner-icon" aria-hidden="true"></span>
            <div class="alert-banner-copy">
                <strong></strong>
                <p></p>
            </div>
            <button class="alert-banner-close" type="button" data-alert-dismiss aria-label="Dismiss notification">&times;</button>
        `;
        banner.querySelector('.alert-banner-icon').textContent = ICONS[normalizedType] || ICONS.info;
        banner.querySelector('strong').textContent = title || TITLES[normalizedType] || TITLES.info;
        banner.querySelector('p').textContent = text;
        banner.querySelector('[data-alert-dismiss]').addEventListener('click', () => dismiss(banner));
        container.appendChild(banner);
        scheduleDismiss(banner, normalizedType, timeout);
        return banner;
    };

    const upgradeElement = (element) => {
        if (!element || element.closest('[data-alert-container]')) return;
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') return;
        if (element.offsetParent === null && getComputedStyle(element).position !== 'fixed') return;

        const isNotice = element.classList.contains('notice');
        const isBootstrapAlert = element.classList.contains('alert') || Array.from(element.classList).some((name) => /^alert-(success|danger|warning|info)$/.test(name));
        const isExplicit = element.hasAttribute('data-alert-banner') || element.hasAttribute('data-alert-source');
        const isStatusNotice = isNotice && Array.from(element.attributes).some((attribute) => /^data-.*status/.test(attribute.name));
        const hasFeedbackType = ['success', 'error', 'danger', 'warning', 'info', 'alert-success', 'alert-danger', 'alert-warning', 'alert-info'].some((name) => element.classList.contains(name));

        if (!isExplicit && !(isNotice && hasFeedbackType) && !isBootstrapAlert && !isStatusNotice) return;

        const message = element.textContent.replace(/\s+/g, ' ').trim();
        if (!message) return;
        const type = getTypeFromElement(element);

        if (element.dataset.alertLastMessage === message && element.dataset.alertLastType === type) {
            return;
        }

        element.dataset.alertUpgraded = 'true';
        element.dataset.alertLastMessage = message;
        element.dataset.alertLastType = type;
        show({
            type,
            title: element.dataset.alertTitle || undefined,
            message,
            timeout: element.dataset.alertTimeout || undefined
        });

        element.hidden = true;
    };

    const upgradeExisting = () => {
        getContainer()
            .querySelectorAll('[data-alert-banner]')
            .forEach((banner) => {
                banner.querySelector('[data-alert-dismiss]')?.addEventListener('click', () => dismiss(banner));
                scheduleDismiss(banner, normalizeType(banner.dataset.alertType), banner.dataset.alertTimeout);
            });

        document.querySelectorAll('.notice, .alert, [data-alert-source]').forEach(upgradeElement);
    };

    document.addEventListener('click', (event) => {
        const dismissButton = event.target.closest('[data-alert-dismiss]');
        if (dismissButton) {
            dismiss(dismissButton.closest('[data-alert-banner]'));
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        upgradeExisting();

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (!(node instanceof Element)) return;
                        upgradeElement(node);
                        node.querySelectorAll?.('.notice, .alert, [data-alert-source]').forEach(upgradeElement);
                    });
                } else if (mutation.type === 'attributes' && mutation.target instanceof Element) {
                    upgradeElement(mutation.target);
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'hidden', 'style', 'data-alert-source', 'data-alert-type']
        });
    });

    window.VanidayAlerts = {
        show,
        success: (message, options = {}) => show({ ...options, type: 'success', message }),
        error: (message, options = {}) => show({ ...options, type: 'error', message }),
        warning: (message, options = {}) => show({ ...options, type: 'warning', message }),
        info: (message, options = {}) => show({ ...options, type: 'info', message }),
        dismiss
    };
})();
