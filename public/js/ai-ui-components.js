(() => {
    const toneMap = {
        positive: 'positive',
        information: 'information',
        info: 'information',
        recommendation: 'recommendation',
        warning: 'warning',
        danger: 'warning',
        historical: 'historical',
        neutral: 'historical'
    };

    const createElement = (tag, className = '', text = '') => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };

    const normalizeConfidence = (value = 'Medium') => {
        const text = String(value || 'Medium').toLowerCase();
        if (text.includes('high')) return 'High';
        if (text.includes('low')) return 'Low';
        return 'Medium';
    };

    const confidenceBadge = (confidence = 'Medium') => {
        const value = normalizeConfidence(confidence);
        const badge = createElement('span', 'ai-standard-confidence-badge', value);
        badge.dataset.confidence = value.toLowerCase();
        return badge;
    };

    const statusBadge = (label = 'Ready', tone = 'information') => {
        const badge = createElement('span', 'ai-standard-status-badge', label);
        badge.dataset.tone = toneMap[tone] || 'information';
        return badge;
    };

    const reasoningPanel = ({
        title = 'Show Reasoning',
        dataSources = [],
        metrics = [],
        timePeriod = 'Current period',
        reason = '',
        confidence = 'Medium'
    } = {}) => {
        const panel = createElement('details', 'ai-standard-reasoning-panel');
        const summary = createElement('summary', '', title);
        const list = createElement('dl');
        [
            ['Data Sources', Array.isArray(dataSources) ? dataSources.join(', ') : dataSources],
            ['Metrics Used', Array.isArray(metrics) ? metrics.join(', ') : metrics],
            ['Time Period', timePeriod],
            ['Why Generated', reason],
            ['Confidence', normalizeConfidence(confidence)]
        ].filter(([, value]) => String(value || '').trim()).forEach(([label, value]) => {
            const row = createElement('div');
            row.append(createElement('dt', '', label), createElement('dd', '', value));
            list.appendChild(row);
        });
        panel.append(summary, list);
        return panel;
    };

    const loadingState = (message = 'Analysing...', tone = 'information') => {
        const state = createElement('div', 'ai-standard-loading-state');
        state.dataset.tone = toneMap[tone] || 'information';
        state.append(createElement('span', 'ai-standard-loading-dot'), createElement('strong', '', message));
        return state;
    };

    const emptyState = (title = 'No AI results yet.', detail = 'Ask AI to analyse your business.') => {
        const state = createElement('div', 'ai-standard-empty-state');
        state.append(createElement('strong', '', title), createElement('span', '', detail));
        return state;
    };

    const sectionList = (sections = []) => {
        const wrap = createElement('div', 'ai-standard-response-sections');
        sections.filter((section) => section && section.title && section.rows && section.rows.length).forEach((section) => {
            const block = createElement('section');
            block.appendChild(createElement('h4', '', section.title));
            const list = createElement('ul');
            section.rows.filter(Boolean).forEach((row) => list.appendChild(createElement('li', '', row)));
            block.appendChild(list);
            wrap.appendChild(block);
        });
        return wrap;
    };

    const actionButton = (label, handler, options = {}) => {
        const button = createElement('button', options.className || 'ai-standard-action-button', label);
        button.type = 'button';
        if (options.disabled) button.disabled = true;
        if (options.title) button.title = options.title;
        button.addEventListener('click', handler);
        return button;
    };

    window.VanidayAIUI = {
        actionButton,
        confidenceBadge,
        createElement,
        emptyState,
        loadingState,
        normalizeConfidence,
        reasoningPanel,
        sectionList,
        statusBadge
    };
})();
