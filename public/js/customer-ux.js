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

    function setupSignupForm() {
        const form = document.querySelector('[data-signup-form]');

        if (!form) {
            return;
        }

        const checkbox = form.querySelector('[data-terms-checkbox]');
        const submitButton = form.querySelector('[data-create-account]');

        if (!checkbox || !submitButton) {
            return;
        }

        const fields = Array.from(form.querySelectorAll('[data-validate]'));
        const summary = form.querySelector('[data-signup-summary]');
        const passwordRules = form.querySelector('[data-password-rules]');
        const getField = (name) => form.elements[name];
        const validators = {
            name(value) {
                return value.trim().length >= 2 ? '' : 'Enter your full name.';
            },
            email(value) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? '' : 'Use a valid email address.';
            },
            phone(value) {
                return /^[689]\d{7}$/.test(value.trim()) ? '' : 'Use an 8-digit Singapore mobile number.';
            },
            birthday(value) {
                if (!value) return 'Select your birthday.';
                const birthday = new Date(`${value}T00:00:00`);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                return birthday && !Number.isNaN(birthday.getTime()) && birthday <= today
                    ? ''
                    : 'Birthday cannot be in the future.';
            },
            age(value) {
                const age = Number(value);
                return Number.isInteger(age) && age >= 1 && age <= 120 ? '' : 'Age must be 1 to 120.';
            },
            gender(value) {
                return value ? '' : 'Choose a gender option.';
            },
            postalCode(value) {
                return /^\d{6}$/.test(value.trim()) ? '' : 'Use a 6-digit postal code.';
            },
            preferredContactMethod(value) {
                return value ? '' : 'Choose a contact method.';
            },
            password(value) {
                if (value.length < 8) return 'Password needs at least 8 characters.';
                if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Use at least one letter and one number.';
                return '';
            },
            confirmPassword(value) {
                return value && value === (getField('password')?.value || '') ? '' : 'Passwords must match.';
            },
            referralCode(value) {
                return !value.trim() || /^[A-Z0-9-]{4,20}$/i.test(value.trim())
                    ? ''
                    : 'Referral code looks too long or has invalid characters.';
            }
        };

        function calculateAge(birthdayValue) {
            if (!birthdayValue) {
                return '';
            }

            const birthday = new Date(`${birthdayValue}T00:00:00`);
            if (Number.isNaN(birthday.getTime())) {
                return '';
            }

            const today = new Date();
            let age = today.getFullYear() - birthday.getFullYear();
            const monthDiff = today.getMonth() - birthday.getMonth();

            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate())) {
                age -= 1;
            }

            return age >= 0 ? String(age) : '';
        }

        function setFieldState(input, message, showMessage = false) {
            const field = input.closest('.signup-field') || input.closest('label');
            const messageNode = field?.querySelector('[data-field-message]');
            const shouldShow = showMessage || input.dataset.touched === 'true';

            input.classList.toggle('is-invalid', shouldShow && Boolean(message));
            input.classList.toggle('is-valid', shouldShow && !message && Boolean(input.value || input.tagName === 'SELECT'));

            if (messageNode) {
                messageNode.textContent = shouldShow ? message : '';
            }
        }

        function syncPasswordRules() {
            if (!passwordRules) {
                return;
            }

            const password = getField('password')?.value || '';
            const rules = {
                length: password.length >= 8,
                letter: /[A-Za-z]/.test(password),
                number: /\d/.test(password)
            };

            Object.entries(rules).forEach(([key, passed]) => {
                passwordRules.querySelector(`[data-rule="${key}"]`)?.classList.toggle('is-met', passed);
            });
        }

        function validateField(input, showMessage = false) {
            const key = input.dataset.validate;
            const validator = validators[key];
            const message = validator ? validator(input.value || '') : '';
            setFieldState(input, message, showMessage);
            return message;
        }

        const sync = (showAll = false) => {
            syncPasswordRules();
            const errors = fields.map((input) => validateField(input, showAll)).filter(Boolean);
            submitButton.disabled = !checkbox.checked || errors.length > 0;

            if (summary) {
                summary.hidden = !showAll || errors.length === 0;
                summary.textContent = errors.length ? errors[0] : '';
            }
        };

        const birthdayInput = getField('birthday');
        const ageInput = getField('age');

        birthdayInput?.addEventListener('change', () => {
            const age = calculateAge(birthdayInput.value);
            if (age && ageInput && !ageInput.matches(':focus')) {
                ageInput.value = age;
            }
            birthdayInput.dataset.touched = 'true';
            sync();
        });

        fields.forEach((input) => {
            input.addEventListener('input', () => sync());
            input.addEventListener('change', () => sync());
            input.addEventListener('blur', () => {
                input.dataset.touched = 'true';
                validateField(input);
            });
        });

        checkbox.addEventListener('change', () => sync());
        form.addEventListener('submit', (event) => {
            fields.forEach((input) => {
                input.dataset.touched = 'true';
            });
            sync(true);

            if (submitButton.disabled) {
                event.preventDefault();
                fields.find((input) => input.classList.contains('is-invalid'))?.focus();
            }
        });

        sync();
    }

    function setupLoginForm() {
        const form = document.querySelector('[data-login-form]');

        if (!form) {
            return;
        }

        const fields = Array.from(form.querySelectorAll('[data-login-validate]'));
        const summary = form.querySelector('[data-login-summary]');
        const validators = {
            email(value) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? '' : 'Enter a valid email address.';
            },
            password(value) {
                return value.length > 0 ? '' : 'Enter your password.';
            }
        };

        function setFieldState(input, message, showMessage = false) {
            const field = input.closest('.signin-field') || input.closest('label');
            const messageNode = field?.querySelector('[data-field-message]');
            const shouldShow = showMessage || input.dataset.touched === 'true';

            input.classList.toggle('is-invalid', shouldShow && Boolean(message));
            input.classList.toggle('is-valid', shouldShow && !message && Boolean(input.value));

            if (messageNode) {
                messageNode.textContent = shouldShow ? message : '';
            }
        }

        function validateField(input, showMessage = false) {
            const validator = validators[input.dataset.loginValidate];
            const message = validator ? validator(input.value || '') : '';
            setFieldState(input, message, showMessage);
            return message;
        }

        function sync(showAll = false) {
            const errors = fields.map((input) => validateField(input, showAll)).filter(Boolean);

            if (summary) {
                summary.hidden = !showAll || errors.length === 0;
                summary.textContent = errors.length ? errors[0] : '';
            }
        }

        fields.forEach((input) => {
            input.addEventListener('input', () => sync());
            input.addEventListener('change', () => sync());
            input.addEventListener('blur', () => {
                input.dataset.touched = 'true';
                validateField(input);
            });
        });

        form.addEventListener('submit', (event) => {
            fields.forEach((input) => {
                input.dataset.touched = 'true';
            });

            const errors = fields.map((input) => validateField(input, true)).filter(Boolean);

            if (errors.length > 0) {
                event.preventDefault();
                if (summary) {
                    summary.hidden = false;
                    summary.textContent = errors[0];
                }
                fields.find((input) => input.classList.contains('is-invalid'))?.focus();
            }
        });

        sync();
    }

    addPasswordToggles();
    setupSignupForm();
    setupLoginForm();
}());
