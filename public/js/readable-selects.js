(() => {
    const closeAll = (except = null) => {
        document.querySelectorAll('.custom-readable-select.is-open').forEach((wrapper) => {
            if (wrapper === except) return;
            const menu = wrapper.querySelector('.custom-promotion-type-menu');
            const trigger = wrapper.querySelector('.custom-promotion-type-trigger');
            wrapper.classList.remove('is-open');
            if (menu) menu.hidden = true;
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
    };

    const enhanceSelect = (select) => {
        if (!select || select.dataset.readableSelectReady === '1') return;
        select.dataset.readableSelectReady = '1';
        select.classList.add('native-readable-select');

        const wrapper = document.createElement('div');
        wrapper.className = 'custom-promotion-type-select custom-readable-select';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'custom-promotion-type-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');

        const label = document.createElement('span');
        const caret = document.createElement('span');
        caret.className = 'custom-promotion-type-caret';
        caret.setAttribute('aria-hidden', 'true');
        caret.textContent = '∨';
        trigger.append(label, caret);

        const menu = document.createElement('div');
        menu.className = 'custom-promotion-type-menu';
        menu.role = 'listbox';
        menu.hidden = true;

        const sync = () => {
            const selected = select.options[select.selectedIndex];
            label.textContent = selected ? selected.textContent.trim() : 'Select';
            trigger.disabled = Boolean(select.disabled);
            wrapper.classList.toggle('is-disabled', Boolean(select.disabled));
            Array.from(menu.querySelectorAll('button')).forEach((button) => {
                button.classList.toggle('is-selected', button.dataset.value === select.value);
            });
        };

        const close = () => {
            wrapper.classList.remove('is-open');
            menu.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        };

        const open = () => {
            if (select.disabled) return;
            closeAll(wrapper);
            wrapper.classList.add('is-open');
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
        };

        const rebuild = () => {
            menu.innerHTML = '';
            Array.from(select.options).forEach((option) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.role = 'option';
                item.dataset.value = option.value;
                item.textContent = option.textContent.trim();
                item.disabled = Boolean(option.disabled);
                item.addEventListener('click', () => {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    close();
                });
                menu.appendChild(item);
            });
            sync();
        };

        trigger.addEventListener('click', () => {
            menu.hidden ? open() : close();
        });
        select.addEventListener('change', sync);

        const observer = new MutationObserver(() => {
            rebuild();
        });
        observer.observe(select, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['disabled']
        });

        wrapper.append(trigger, menu);
        select.insertAdjacentElement('afterend', wrapper);
        rebuild();
    };

    const init = () => {
        document.querySelectorAll('select[data-readable-select]').forEach(enhanceSelect);
    };

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.custom-readable-select')) {
            closeAll();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeAll();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
