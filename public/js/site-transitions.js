(() => {
    const transitionForms = document.querySelectorAll('form[action="/login"], form[action="/logout"]');

    if (!transitionForms.length) {
        return;
    }

    const getMessage = (form) => {
        const action = form.getAttribute('action');

        if (action === '/logout') {
            return 'Signing you out...';
        }

        return 'Preparing your Vaniday space...';
    };

    const showOverlay = (message) => {
        let overlay = document.querySelector('.page-transition-overlay');

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'page-transition-overlay';
            overlay.setAttribute('aria-live', 'polite');
            overlay.innerHTML = `
                <div class="page-transition-card">
                    <span class="page-transition-mark">V</span>
                    <span class="page-transition-spinner" aria-hidden="true"></span>
                    <strong></strong>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        overlay.querySelector('strong').textContent = message;
        document.body.classList.add('is-transitioning');
        window.requestAnimationFrame(() => overlay.classList.add('is-visible'));
    };

    transitionForms.forEach((form) => {
        form.addEventListener('submit', (event) => {
            if (form.dataset.transitionSubmitted === 'true') {
                return;
            }

            event.preventDefault();
            form.dataset.transitionSubmitted = 'true';
            form.classList.add('is-submitting');
            showOverlay(getMessage(form));

            window.setTimeout(() => {
                form.submit();
            }, 420);
        });
    });
})();
