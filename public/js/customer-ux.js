(function () {
    function addPasswordToggles() {
        document.querySelectorAll('input[type="password"]').forEach((input) => {
            if (input.dataset.passwordToggleReady === 'true' || !/password/i.test(input.name || '')) {
                return;
            }

            const wrapper = document.createElement('span');
            wrapper.className = 'password-input-wrap';
            input.parentNode.insertBefore(wrapper, input);
            wrapper.appendChild(input);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'password-toggle-button';
            button.setAttribute('aria-label', 'Show password');
            button.innerHTML = `
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            `;

            button.addEventListener('click', () => {
                const isVisible = input.type === 'text';
                input.type = isVisible ? 'password' : 'text';
                button.classList.toggle('is-visible', !isVisible);
                button.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
            });

            wrapper.appendChild(button);
            input.dataset.passwordToggleReady = 'true';
        });
    }

    function setupSignupTerms() {
        const form = document.querySelector('[data-signup-form]');

        if (!form) {
            return;
        }

        const checkbox = form.querySelector('[data-terms-checkbox]');
        const submitButton = form.querySelector('[data-create-account]');

        if (!checkbox || !submitButton) {
            return;
        }

        const sync = () => {
            submitButton.disabled = !checkbox.checked;
        };

        checkbox.addEventListener('change', sync);
        sync();
    }

    addPasswordToggles();
    setupSignupTerms();
}());
