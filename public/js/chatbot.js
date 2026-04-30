(() => {
    const widget = document.querySelector('.ai-chatbot');

    if (!widget) {
        return;
    }

    const toggle = widget.querySelector('.ai-chatbot-toggle');
    const panel = widget.querySelector('.ai-chatbot-panel');
    const closeButton = widget.querySelector('.ai-chatbot-close');
    const form = widget.querySelector('.ai-chatbot-form');
    const input = widget.querySelector('#ai-chatbot-input');
    const messages = widget.querySelector('.ai-chatbot-messages');

    const setOpen = (isOpen) => {
        panel.hidden = !isOpen;
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

        if (isOpen) {
            window.setTimeout(() => input.focus(), 0);
        }
    };

    const addMessage = (text, type) => {
        const message = document.createElement('div');
        message.className = `ai-chatbot-message ${type}`;
        message.textContent = text;
        messages.appendChild(message);
        messages.scrollTop = messages.scrollHeight;
        return message;
    };

    toggle.addEventListener('click', () => {
        setOpen(panel.hidden);
    });

    closeButton.addEventListener('click', () => {
        setOpen(false);
        toggle.focus();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const userMessage = input.value.trim();

        if (!userMessage) {
            return;
        }

        addMessage(userMessage, 'user');
        input.value = '';
        input.disabled = true;

        const loadingMessage = addMessage('Thinking...', 'bot');

        try {
            const response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ userQuery: userMessage })
            });
            const result = await response.json();

            loadingMessage.textContent = result.success
                ? result.answer
                : result.message || 'Sorry, I could not answer that just now.';
        } catch (error) {
            loadingMessage.textContent = 'Sorry, the AI assistant is unavailable right now.';
        } finally {
            input.disabled = false;
            input.focus();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !panel.hidden) {
            setOpen(false);
            toggle.focus();
        }
    });
})();
