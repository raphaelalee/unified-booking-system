(() => {
    const root = document.querySelector('[data-floating-ai-root]');
    if (!root) return;

    const role = root.dataset.floatingAiRole === 'admin' ? 'admin' : 'merchant';
    const currentPath = root.dataset.floatingAiCurrentPath || window.location.pathname;
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const toggle = root.querySelector('[data-floating-ai-toggle]');
    const closeButton = root.querySelector('[data-floating-ai-close]');
    const presentationToggle = root.querySelector('[data-floating-ai-presentation-toggle]');
    const memoryToggle = root.querySelector('[data-floating-ai-memory-toggle]');
    const newConversationButton = root.querySelector('[data-floating-ai-new-conversation]');
    const clearMemoryButton = root.querySelector('[data-floating-ai-clear-memory]');
    const memoryPanel = root.querySelector('[data-floating-ai-memory-panel]');
    const memoryList = root.querySelector('[data-floating-ai-memory-list]');
    const memorySearch = root.querySelector('[data-floating-ai-search]');
    const exportButtons = root.querySelectorAll('[data-floating-ai-export]');
    const drawer = root.querySelector('[data-floating-ai-drawer]');
    const heading = root.querySelector('[data-floating-ai-heading]');
    const pageLabel = root.querySelector('[data-floating-ai-page-label]');
    const pageTitle = root.querySelector('[data-floating-ai-page-title]');
    const pageHelp = root.querySelector('[data-floating-ai-page-help]');
    const period = root.querySelector('[data-floating-ai-period]');
    const periodLabel = root.querySelector('[data-floating-ai-period-label]');
    const history = root.querySelector('[data-floating-ai-history]');
    const promptWrap = root.querySelector('[data-floating-ai-prompts]');
    const input = root.querySelector('[data-floating-ai-input]');
    const sendButton = root.querySelector('[data-floating-ai-send]');
    const status = root.querySelector('[data-floating-ai-status]');

    const AIUI = window.VanidayAIUI || {};
    let inProgress = false;
    const storagePrefix = `vaniday:${role}:floating-ai`;
    const openStorageKey = `${storagePrefix}:open`;
    const legacyChatStorageKey = `${storagePrefix}:chat:${currentPath}`;
    const chatStorageKey = `${storagePrefix}:chat:session`;
    const memoryStorageKey = `${storagePrefix}:session-memory`;
    const presentationStorageKey = `${storagePrefix}:presentation-mode`;
    const presentationState = {
        active: false,
        index: 0,
        highlighted: null
    };
    const commandHelpText = [
        'Quick commands:',
        '/summary - summarise the current page metrics',
        '/performance - review performance signals',
        '/promotion - prepare campaign or promotion ideas',
        '/inventory - review stock and product demand',
        '/refunds - review refund trends or cases',
        '/spin - analyse Spin & Discover rewards',
        '/help - show these commands'
    ].join('\n');

    const matchesAny = (path, prefixes = []) => prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

    const merchantContexts = [
        {
            match: (path) => path === '/merchant' || matchesAny(path, ['/merchant/dashboard']),
            page: 'Dashboard',
            help: "I can explain today's KPIs and what needs attention.",
            prompts: ["Summarise today's dashboard", 'What needs action first?', 'Explain booking and order changes']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/analytics']),
            page: 'Analytics',
            help: "I can explain today's KPIs, trends, refunds and customer behaviour.",
            prompts: ["Summarise this month's performance", "Why are bookings decreasing?", 'How can I improve customer retention?']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/bookings', '/merchant/schedule', '/merchant/check-in']),
            page: 'Bookings',
            help: 'I can explain booking patterns, cancellations and schedule pressure.',
            prompts: ['Explain cancellations', 'Which booking trends matter?', 'Suggest schedule improvements']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/support']) || path.startsWith('/help-center'),
            page: 'Refunds',
            help: 'I can recommend what refund requests need careful review.',
            prompts: ['What refunds need attention?', 'Recommend refund decisions', 'Explain risky refund cases']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/loyalty', '/merchant/cashback', '/merchant/vouchers']) || path.includes('wallet'),
            page: 'Wallet',
            help: 'I can review reward, wallet, cashback and voucher activity.',
            prompts: ['Explain reward activity', 'Which vouchers should I review?', 'How can I improve repeat customers?']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/spin-discover', '/merchant/rewards-game']),
            page: 'Spin',
            help: 'I can analyse wheel wins, redemptions, inventory, claim limits and conversion before suggesting reward changes.',
            prompts: ['How is my wheel performing?', 'Which reward is most popular?', 'Which reward has poor redemption?', 'Should I replace a reward?']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/orders']),
            page: 'Inventory',
            help: 'I can identify products that may need restocking and review product order signals.',
            prompts: ['Which inventory needs restocking?', 'Explain product demand', 'Prepare a stock reminder']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/products']),
            page: 'Products',
            help: 'I can review product demand, stock, fulfilment and reward opportunities.',
            prompts: ['Which products need attention?', 'Review product performance', 'Prepare a stock recommendation']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/services']),
            page: 'Services',
            help: 'I can review service demand and suggest price or schedule ideas.',
            prompts: ['Recommend price changes', 'Which services need attention?', 'Suggest service improvements']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/promotions']),
            page: 'Promotions',
            help: 'I can suggest promotions using your current merchant analytics.',
            prompts: ['Suggest a promotion', 'Create a weekday promotion', 'Which campaign should I run next?']
        },
        {
            match: (path) => matchesAny(path, ['/merchant/profile']),
            page: 'Profile',
            help: 'I can help review business presentation and customer retention signals.',
            prompts: ['How can I improve my profile?', 'What should I update first?', 'Summarise customer retention']
        }
    ];

    const adminContexts = [
        {
            match: (path) => path === '/admin' || matchesAny(path, ['/admin/overview', '/admin/dashboard']),
            page: 'Dashboard',
            help: 'I can explain platform KPIs and operational priorities.',
            prompts: ['Summarise platform performance', 'What needs admin attention?', 'Show platform risks']
        },
        {
            match: (path) => matchesAny(path, ['/admin/analytics']),
            page: 'Analytics',
            help: 'I can explain platform metrics, trends and admin priorities.',
            prompts: ['Summarise platform performance', 'Show refund trends', 'Detect unusual activity']
        },
        {
            match: (path) => matchesAny(path, ['/admin/users']),
            page: 'Users',
            help: 'I can explain user growth, active customers and account-risk patterns.',
            prompts: ['Summarise user activity', 'Which customers are active?', 'Detect unusual user activity']
        },
        {
            match: (path) => matchesAny(path, ['/admin/merchants']),
            page: 'Merchants',
            help: 'I can identify merchants that may need review.',
            prompts: ['Which merchants need review?', 'Which merchants are inactive?', 'Prepare merchant review recommendation']
        },
        {
            match: (path) => path.includes('refund') || path.startsWith('/help-center'),
            page: 'Refunds',
            help: 'I can show refund trends and highlight cases for admin review.',
            prompts: ['Show refund trends', 'Which refunds need review?', 'Summarise refund risks']
        },
        {
            match: (path) => matchesAny(path, ['/admin/audit-trail', '/admin/platform-health']) || path.includes('report'),
            page: 'Reports',
            help: 'I can explain reporting, audit, platform health and operational signals.',
            prompts: ['Summarise reports', 'Detect unusual activity', 'What should admin check?']
        },
        {
            match: (path) => matchesAny(path, ['/admin/reward-shop', '/admin/loyalty', '/admin/cashback']),
            page: 'Reward Management',
            help: 'I can explain reward, loyalty and cashback activity across the platform.',
            prompts: ['Summarise reward activity', 'Which rewards need review?', 'Suggest platform campaigns']
        },
        {
            match: (path) => path.includes('spin') || matchesAny(path, ['/admin/rewards-game', '/admin/promotions']),
            page: 'Spin Management',
            help: 'I can review campaign performance and platform promotion risks.',
            prompts: ['Suggest platform campaigns', 'Analyse reward campaigns', 'Which campaigns need review?']
        }
    ];

    const defaultContext = role === 'admin'
        ? {
            page: 'Admin',
            help: 'I can use the current admin page as context for platform questions.',
            prompts: ['Summarise platform performance', 'Which merchants need review?', 'Detect unusual activity']
        }
        : {
            page: 'Merchant',
            help: 'I can use the current merchant page as context for business questions.',
            prompts: ["Summarise today's performance", 'What needs attention?', 'Suggest an improvement']
        };

    const context = (role === 'admin' ? adminContexts : merchantContexts).find((item) => item.match(currentPath)) || defaultContext;
    const loadingMessages = {
        insights: [
            'Reviewing the latest business signals...',
            'Comparing performance against the selected period...',
            'Preparing a concise executive summary...',
            'Generating executive summary...',
            'Analysing business performance...'
        ],
        reminders: [
            'Checking for operational reminders...',
            'Prioritising items that need attention...',
            'Preparing reminder suggestions...'
        ],
        proposal: [
            'Preparing a controlled recommendation...',
            'Checking the page context before suggesting action...',
            'Drafting a proposal for review only...',
            'Preparing recommendations...'
        ],
        question: [
            'Reading the current page context...',
            'Reviewing the recent conversation...',
            'Preparing a practical answer...',
            'Checking booking trends...',
            'Reviewing refund history...',
            'Analysing Spin campaign...',
            'Comparing previous reports...'
        ]
    };

    const nowTimeLabel = () => new Date().toLocaleTimeString('en-SG', {
        hour: 'numeric',
        minute: '2-digit'
    });

    const getWelcomeMessage = () => {
        const audience = role === 'admin' ? 'platform operations' : 'your business';
        return `Good to see you. I am ready to support ${audience} from the ${context.page} page. Ask a question, choose a suggestion, or use /help for quick commands.`;
    };

    const setStatus = (message, tone = '') => {
        if (!status) return;
        status.textContent = message || '';
        status.dataset.tone = tone;
    };

    const syncPeriodLabel = () => {
        if (periodLabel) periodLabel.textContent = period?.selectedOptions?.[0]?.textContent || 'Last 30 days';
    };

    const parseJsonScript = (id) => {
        const node = document.getElementById(id);
        if (!node) return null;
        try {
            return JSON.parse(node.textContent || '{}');
        } catch (error) {
            return null;
        }
    };

    const emptySessionMemory = () => ({
        currentPage: context.page,
        currentPath,
        lastTopic: '',
        lastQuestion: '',
        lastAnswer: '',
        lastReport: null,
        lastProposal: null,
        lastOpened: null,
        lastExplainedChart: '',
        prompts: [],
        answers: [],
        recommendations: [],
        reports: [],
        opened: [],
        explainedCharts: [],
        pinned: [],
        saved: [],
        viewed: {
            services: [],
            products: [],
            bookings: [],
            refunds: [],
            merchants: []
        },
        topics: {}
    });

    const readSessionMemory = () => {
        try {
            return { ...emptySessionMemory(), ...(JSON.parse(sessionStorage.getItem(memoryStorageKey) || '{}') || {}) };
        } catch (error) {
            return emptySessionMemory();
        }
    };

    const trimRows = (rows = [], limit = 12) => Array.isArray(rows) ? rows.filter(Boolean).slice(-limit) : [];

    const writeSessionMemory = (memory) => {
        const safe = {
            ...emptySessionMemory(),
            ...memory,
            currentPage: context.page,
            currentPath,
            prompts: trimRows(memory.prompts, 20),
            answers: trimRows(memory.answers, 20),
            recommendations: trimRows(memory.recommendations, 16),
            reports: trimRows(memory.reports, 12),
            opened: trimRows(memory.opened, 16),
            explainedCharts: trimRows(memory.explainedCharts, 12),
            pinned: trimRows(memory.pinned, 12),
            saved: trimRows(memory.saved, 12),
            viewed: {
                services: trimRows(memory.viewed?.services, 10),
                products: trimRows(memory.viewed?.products, 10),
                bookings: trimRows(memory.viewed?.bookings, 10),
                refunds: trimRows(memory.viewed?.refunds, 10),
                merchants: trimRows(memory.viewed?.merchants, 10)
            },
            topics: Object.fromEntries(Object.entries(memory.topics || {}).slice(-8))
        };
        sessionStorage.setItem(memoryStorageKey, JSON.stringify(safe));
        renderMemoryPanel();
        return safe;
    };

    const inferTopic = (text = '') => {
        const normalized = String(text || '').toLowerCase();
        if (/\brefund|return|cancel/.test(normalized)) return 'refunds';
        if (/\bbooking|appointment|schedule|slot|capacity/.test(normalized)) return 'bookings';
        if (/\binventory|stock|product|shampoo|serum|mask/.test(normalized)) return 'inventory';
        if (/\bservice|spa|facial|hair|massage|manicure/.test(normalized)) return 'services';
        if (/\bpromotion|campaign|voucher|discount/.test(normalized)) return 'promotions';
        if (/\bspin|wheel|reward|redemption/.test(normalized)) return 'spin';
        if (/\breport|brief|summary/.test(normalized)) return 'reports';
        if (/\bmerchant|salon/.test(normalized)) return 'merchants';
        if (/\brevenue|analytics|kpi|performance|trend/.test(normalized)) return 'analytics';
        return '';
    };

    const rememberSessionEvent = (type, data = {}) => {
        const memory = readSessionMemory();
        const timestamp = new Date().toISOString();
        const topic = data.topic || inferTopic(`${data.question || ''} ${data.answer || ''} ${data.title || ''}`) || memory.lastTopic || context.page.toLowerCase();
        memory.lastTopic = topic;
        memory.topics = memory.topics || {};
        memory.topics[topic] = {
            topic,
            lastUpdated: timestamp,
            summary: String(data.answer || data.detail || data.title || data.question || '').replace(/\s+/g, ' ').slice(0, 220)
        };

        if (type === 'prompt') {
            memory.lastQuestion = data.question || '';
            memory.prompts.push({ text: data.question || '', page: context.page, path: currentPath, topic, timestamp });
        }
        if (type === 'answer') {
            memory.lastAnswer = data.answer || '';
            memory.answers.push({ text: data.answer || '', page: context.page, topic, timestamp });
        }
        if (type === 'recommendation') {
            const row = { title: data.title || 'Recommendation', detail: data.detail || '', topic, timestamp };
            memory.lastProposal = row;
            memory.recommendations.push(row);
        }
        if (type === 'report') {
            const row = { title: data.title || 'Report', detail: data.detail || '', topic: 'reports', timestamp };
            memory.lastReport = row;
            memory.reports.push(row);
        }
        if (type === 'opened') {
            const row = { title: data.title || 'Opened page', href: data.href || '', detail: data.detail || '', topic, timestamp };
            memory.lastOpened = row;
            memory.opened.push(row);
        }
        if (type === 'explained') {
            memory.lastExplainedChart = data.title || '';
            memory.explainedCharts.push({ title: data.title || '', detail: data.detail || '', topic, timestamp });
        }
        if (type === 'viewed') {
            const bucket = memory.viewed?.[data.bucket] ? data.bucket : 'services';
            memory.viewed[bucket].push({ title: data.title || '', detail: data.detail || '', timestamp });
        }
        return writeSessionMemory(memory);
    };

    const sessionMemorySummary = () => {
        const memory = readSessionMemory();
        const topics = Object.keys(memory.topics || {});
        const recommendations = trimRows(memory.recommendations, 5).map((row) => row.title);
        const reports = trimRows(memory.reports, 3).map((row) => row.title);
        const opened = trimRows(memory.opened, 3).map((row) => row.title);
        return [
            `Current page: ${context.page}.`,
            memory.lastTopic ? `Current topic: ${memory.lastTopic}.` : '',
            memory.lastQuestion ? `Previous question: ${memory.lastQuestion}.` : '',
            memory.lastAnswer ? `Previous answer: ${memory.lastAnswer.slice(0, 180)}.` : '',
            memory.lastReport ? `Last report: ${memory.lastReport.title}.` : '',
            memory.lastProposal ? `Last recommendation: ${memory.lastProposal.title}.` : '',
            memory.lastOpened ? `Last opened page: ${memory.lastOpened.title}.` : '',
            memory.lastExplainedChart ? `Last explained chart: ${memory.lastExplainedChart}.` : '',
            topics.length ? `Topics discussed: ${topics.join(', ')}.` : '',
            recommendations.length ? `Recommendations given: ${recommendations.join('; ')}.` : '',
            reports.length ? `Reports generated: ${reports.join('; ')}.` : '',
            opened.length ? `Recently opened: ${opened.join('; ')}.` : ''
        ].filter(Boolean).join(' ').slice(0, 900);
    };

    const formatSpinAiContext = () => {
        if (role !== 'merchant' || context.page !== 'Spin') return '';
        const data = parseJsonScript('vanidaySpinDiscoverAiData');
        if (!data) return '';

        const stats = data.stats || {};
        const rewards = Array.isArray(data.rewards) ? data.rewards : [];
        const selected = rewards.filter((reward) => reward.selected);
        const top = [...rewards].sort((a, b) => Number(b.wins || 0) - Number(a.wins || 0))[0];
        const weak = selected
            .filter((reward) => Number(reward.wins || 0) > 0)
            .sort((a, b) => Number(a.conversionRate || 0) - Number(b.conversionRate || 0))[0];
        const depleted = rewards.filter((reward) => /claim limit|no inventory/i.test(reward.status || '')).slice(0, 3);

        const parts = [
            `Spin data: ${stats.totalWins || 0} wins, ${stats.activeRewards || 0} active, ${stats.inactiveRewards || 0} inactive, ${stats.depletedRewards || 0} depleted, ${stats.remainingInventory || 0} capped inventory left.`,
            top ? `Most won: ${top.name} (${top.type}, ${top.wins || 0} wins, ${top.redemptions || 0} redeemed, ${top.conversionRate || 0}% conversion).` : '',
            weak ? `Weak redemption: ${weak.name} (${weak.conversionRate || 0}% conversion from ${weak.wins || 0} wins).` : '',
            depleted.length ? `Limit/inventory issues: ${depleted.map((reward) => `${reward.name} ${reward.status}`).join('; ')}.` : '',
            selected.length ? `Selected rewards: ${selected.slice(0, 5).map((reward) => `${reward.name} (${reward.value}, limit ${reward.claimLimit ?? 'none'}, inventory ${reward.inventoryRemaining ?? 'no cap'})`).join('; ')}.` : 'No rewards currently selected for the wheel.'
        ].filter(Boolean);

        return parts.join(' ').slice(0, 650);
    };

    const syncButtons = () => {
        if (sendButton) sendButton.disabled = inProgress || !String(input?.value || '').trim();
        root.querySelectorAll('[data-floating-ai-prompt]').forEach((button) => {
            button.disabled = inProgress;
        });
        if (presentationToggle) {
            presentationToggle.textContent = presentationState.active ? 'Normal AI' : 'Present';
            presentationToggle.setAttribute('aria-pressed', presentationState.active ? 'true' : 'false');
        }
    };

    const setOpen = (open) => {
        if (!open && drawer?.contains(document.activeElement)) {
            toggle?.focus();
        }
        root.classList.toggle('is-open', open);
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (drawer) {
            drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
            drawer.inert = !open;
        }
        sessionStorage.setItem(openStorageKey, open ? 'open' : 'closed');
        if (open) setTimeout(() => input?.focus(), 180);
    };

    const getStoredConversation = () => {
        let saved = [];
        try {
            saved = JSON.parse(sessionStorage.getItem(chatStorageKey) || sessionStorage.getItem(legacyChatStorageKey) || '[]');
        } catch (error) {
            saved = [];
        }
        return Array.isArray(saved) ? saved : [];
    };

    const persistChat = () => {
        if (!history) return;
        const rows = Array.from(history.querySelectorAll('.vaniday-ai-message')).map((message) => ({
            role: message.dataset.role || 'assistant',
            text: message.querySelector('.vaniday-ai-message-text')?.textContent || '',
            timestamp: message.dataset.timestamp || new Date().toISOString(),
            page: message.dataset.page || context.page,
            path: message.dataset.path || currentPath,
            isTyping: message.classList.contains('is-typing')
        })).filter((row) => row.text && !row.isTyping).map(({ isTyping, ...row }) => row);
        sessionStorage.setItem(chatStorageKey, JSON.stringify(rows.slice(-24)));
    };

    const renderMemoryPanel = () => {
        if (!memoryList) return;
        const memory = readSessionMemory();
        while (memoryList.firstChild) memoryList.removeChild(memoryList.firstChild);

        const groups = [
            ['Pinned insights', trimRows(memory.pinned, 6), (row) => row.title],
            ['Saved responses', trimRows(memory.saved, 6), (row) => row.title],
            ['Previous prompts', trimRows(memory.prompts, 6), (row) => row.text],
            ['Reports', trimRows(memory.reports, 4), (row) => row.title],
            ['Recommendations', trimRows(memory.recommendations, 5), (row) => row.title],
            ['Opened pages', trimRows(memory.opened, 5), (row) => row.title],
            ['Explained charts', trimRows(memory.explainedCharts, 4), (row) => row.title]
        ];

        groups.forEach(([label, rows, pickText]) => {
            if (!rows.length) return;
            const section = document.createElement('section');
            const title = document.createElement('strong');
            title.textContent = label;
            section.appendChild(title);
            rows.slice().reverse().forEach((row) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = pickText(row) || 'Previous item';
                button.addEventListener('click', () => {
                    if (row.href) {
                        window.location.assign(row.href);
                        return;
                    }
                    const recall = row.text
                        ? `Continue from this: ${row.text}`
                        : `Show me this again: ${row.title || row.detail || label}`;
                    submitChat(recall);
                });
                section.appendChild(button);
            });
            memoryList.appendChild(section);
        });

        if (!memoryList.children.length) {
            memoryList.appendChild(AIUI.emptyState
                ? AIUI.emptyState('No previous conversations.', 'Ask AI to analyse your business.')
                : (() => {
                    const empty = document.createElement('p');
                    empty.textContent = 'No session history yet.';
                    return empty;
                })());
        }
    };

    const searchConversation = (term = '') => {
        const needle = String(term || '').trim().toLowerCase();
        history?.querySelectorAll('.vaniday-ai-message').forEach((message) => {
            const matched = needle && String(message.textContent || '').toLowerCase().includes(needle);
            message.classList.toggle('is-search-match', Boolean(matched));
            if (matched) message.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        memoryList?.querySelectorAll('button').forEach((button) => {
            const matched = needle && String(button.textContent || '').toLowerCase().includes(needle);
            button.classList.toggle('is-search-match', Boolean(matched));
        });
        setStatus(needle ? `Searching conversation for "${term}".` : 'Conversation search cleared.', 'success');
    };

    const conversationText = () => getStoredConversation()
        .map((row) => `${row.role === 'user' ? 'You' : 'Vaniday AI'} (${new Date(row.timestamp).toLocaleString('en-SG')}):\n${row.text}`)
        .join('\n\n');

    const exportConversation = (mode = 'text') => {
        const text = conversationText() || 'No conversation to export yet.';
        if (mode === 'print') {
            const win = window.open('', '_blank');
            if (!win) return;
            win.document.write(`<!doctype html><html><head><title>Vaniday AI Conversation</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#243225;line-height:1.5;white-space:pre-wrap}button{margin-bottom:20px}</style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>Vaniday AI Conversation</h1><p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p></body></html>`);
            win.document.close();
            return;
        }
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `vaniday-ai-conversation-${Date.now()}.txt`;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const clearSessionConversation = (message = 'Conversation memory cleared.') => {
        sessionStorage.removeItem(memoryStorageKey);
        sessionStorage.removeItem(chatStorageKey);
        sessionStorage.removeItem(legacyChatStorageKey);
        if (history) {
            while (history.firstChild) history.removeChild(history.firstChild);
        }
        writeSessionMemory(emptySessionMemory());
        appendMessage('assistant', message);
        setStatus(message, 'success');
    };

    const firstExistingElement = (selectors = []) => {
        for (const selector of selectors) {
            const node = document.querySelector(selector);
            if (node) return node;
        }
        return null;
    };

    const summarizeElement = (element, fallback = '') => {
        const text = String(element?.innerText || element?.textContent || fallback || '')
            .replace(/\s+/g, ' ')
            .trim();
        return text.length > 180 ? `${text.slice(0, 177)}...` : text;
    };

    const clearPresentationHighlight = () => {
        presentationState.highlighted?.classList?.remove('vaniday-ai-present-highlight');
        presentationState.highlighted = null;
    };

    const buildPresentationSteps = () => {
        const dashboardSteps = role === 'admin'
            ? [
                {
                    title: 'Admin Overview',
                    selectors: ['.admin-command-hero', '.admin-dashboard-header'],
                    fallback: 'This dashboard gives a quick view of platform health, merchant review work, customer activity and revenue.'
                },
                {
                    title: 'Platform KPIs',
                    selectors: ['.admin-stat-grid'],
                    fallback: 'These KPI cards show the main operating signals for merchants, users, bookings, revenue and support.'
                },
                {
                    title: 'Revenue',
                    selectors: ['.admin-stat-card.accent-green:nth-of-type(5)', '.admin-stat-grid .admin-stat-card:nth-child(5)'],
                    fallback: 'Revenue is shown as a platform-level business signal for the selected live records.'
                },
                {
                    title: 'Bookings',
                    selectors: ['.admin-stat-card.accent-orange', '.admin-stat-grid .admin-stat-card:nth-child(4)'],
                    fallback: 'Booking activity helps explain marketplace demand and operational workload.'
                },
                {
                    title: 'Refunds and Support',
                    selectors: ['.admin-stat-card.accent-yellow', '.admin-health-list'],
                    fallback: 'Support and refund counts highlight items that may need admin attention before they become delays.'
                },
                {
                    title: 'Merchant Recommendations',
                    selectors: ['.admin-overview-actions', '.admin-panel'],
                    fallback: 'The action links point admins toward merchant reviews, platform health, booking operations and campaign checks.'
                }
            ]
            : [
                {
                    title: 'Merchant Dashboard',
                    selectors: ['.merchant-command-hero', '.merchant-dashboard-hero'],
                    fallback: 'This dashboard brings together bookings, sales, promotions, customer signals and merchant health.'
                },
                {
                    title: 'Business Health',
                    selectors: ['.merchant-alert-card.needs-review', '.merchant-alert-card:last-of-type'],
                    fallback: 'Business health confirms whether setup issues need attention before customers book confidently.'
                },
                {
                    title: 'Revenue',
                    selectors: ['.merchant-executive-strip', '.merchant-payout-summary-grid', '.merchant-kpi-grid .merchant-kpi-card:nth-child(2)'],
                    fallback: 'Revenue and payout cards separate gross sales, commission and estimated net payout.'
                },
                {
                    title: 'Bookings',
                    selectors: ['.merchant-kpi-grid .merchant-kpi-card:nth-child(1)', '.merchant-insight-grid', '.merchant-orders-card'],
                    fallback: 'Booking cards show today\'s demand, pending approvals and upcoming appointments.'
                },
                {
                    title: 'Refunds',
                    selectors: ['.merchant-kpi-grid .merchant-kpi-card:nth-child(5)', '.merchant-insight-grid'],
                    fallback: 'Refund metrics show pending, processing and failed cases so the merchant can review risk early.'
                },
                {
                    title: 'Inventory',
                    selectors: ['.merchant-kpi-grid .merchant-kpi-card:nth-child(6)', '.merchant-product-orders-panel'],
                    fallback: 'Inventory and product-order signals show demand and can point to items that may need restocking.'
                },
                {
                    title: 'Spin Campaign',
                    selectors: ['.merchant-kpi-grid .merchant-kpi-card:nth-child(7)', '.spin-ai-intelligence-panel'],
                    fallback: 'Reward and Spin signals help explain loyalty-driven activity and campaign engagement.'
                },
                {
                    title: 'Recommendations',
                    selectors: ['.merchant-insight-grid', '.merchant-card-heading'],
                    fallback: 'Recommendation areas point the merchant toward bookings, customer insights, analytics and operational next steps.'
                },
                {
                    title: 'Charts',
                    selectors: ['.merchant-chart-card', '.ai-executive-dashboard', '.analytics-ai-chart-explanation'],
                    fallback: 'Charts and AI explanations turn dashboard numbers into simple business takeaways.'
                }
            ];

        const genericSteps = [
            {
                title: `${context.page} Overview`,
                selectors: ['main .page-container > section', 'main'],
                fallback: `This ${context.page} page is ready for a focused walkthrough.`
            },
            {
                title: 'Important Signals',
                selectors: ['.ai-executive-dashboard', '.merchant-kpi-grid', '.admin-stat-grid', '.merchant-chart-card', '.admin-panel'],
                fallback: context.help
            },
            {
                title: 'Suggested Next Actions',
                selectors: ['.vaniday-ai-prompts', '.merchant-hero-actions', '.admin-overview-actions', '.admin-topbar-utilities'],
                fallback: 'Use the visible controls and AI suggestions to continue the demo without changing business data.'
            }
        ];

        return context.page === 'Dashboard' ? dashboardSteps : genericSteps;
    };

    const presentationStepMessage = (step, element, index, total) => {
        const pageSnippet = summarizeElement(element, step.fallback);
        const lines = [
            `Step ${index + 1} of ${total}: ${step.title}`,
            step.fallback,
            pageSnippet && pageSnippet !== step.fallback ? `Current signal: ${pageSnippet}` : '',
            'Demo note: this presentation mode only explains and highlights the page. It does not modify business data.'
        ].filter(Boolean);
        return lines.join('\n');
    };

    const createPresentationControls = () => {
        const controls = document.createElement('div');
        controls.className = 'vaniday-ai-presentation-controls';
        const previous = AIUI.actionButton
            ? AIUI.actionButton('Previous', () => showPresentationStep(presentationState.index - 1), { disabled: presentationState.index <= 0 })
            : document.createElement('button');
        const next = AIUI.actionButton
            ? AIUI.actionButton(presentationState.index >= buildPresentationSteps().length - 1 ? 'Finish' : 'Next', () => showPresentationStep(presentationState.index + 1))
            : document.createElement('button');
        const skip = AIUI.actionButton
            ? AIUI.actionButton('Skip', () => setPresentationMode(false))
            : document.createElement('button');
        if (!AIUI.actionButton) {
            previous.type = next.type = skip.type = 'button';
            previous.textContent = 'Previous';
            next.textContent = presentationState.index >= buildPresentationSteps().length - 1 ? 'Finish' : 'Next';
            skip.textContent = 'Skip';
            previous.disabled = presentationState.index <= 0;
            previous.addEventListener('click', () => showPresentationStep(presentationState.index - 1));
            next.addEventListener('click', () => showPresentationStep(presentationState.index + 1));
            skip.addEventListener('click', () => setPresentationMode(false));
        }
        controls.append(previous, next, skip);
        return controls;
    };

    const showPresentationStep = (requestedIndex = 0) => {
        const steps = buildPresentationSteps();
        if (!steps.length) return;
        if (requestedIndex >= steps.length) {
            appendMessage('assistant', 'Presentation complete. You can continue with normal AI or restart the walkthrough anytime.', [], {
                progressive: true,
                transparency: {
                    periodLabel: 'Current page',
                    sources: ['Presentation mode'],
                    confidence: 'High',
                    reasoning: 'The walkthrough finished without changing any business data.'
                }
            });
            setPresentationMode(false, { silent: true });
            return;
        }
        presentationState.index = Math.max(0, Math.min(requestedIndex, steps.length - 1));
        const step = steps[presentationState.index];
        const target = firstExistingElement(step.selectors);
        clearPresentationHighlight();
        if (target) {
            target.classList.add('vaniday-ai-present-highlight');
            presentationState.highlighted = target;
            target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }
        appendMessage('assistant', presentationStepMessage(step, target, presentationState.index, steps.length), [createPresentationControls()], {
            progressive: true,
            sourcePrompt: `Presentation Mode: ${step.title}`,
            transparency: {
                periodLabel: 'Current page',
                sources: ['Current dashboard DOM', context.page],
                metrics: [step.title],
                confidence: target ? 'High' : 'Medium',
                reasoning: 'Presentation mode reads visible dashboard content and highlights the matching section. It does not call write endpoints or modify data.'
            }
        });
        rememberSessionEvent('explained', {
            title: `Presentation: ${step.title}`,
            detail: step.fallback,
            topic: 'presentation'
        });
        setStatus(`Presenting ${step.title}.`, 'success');
    };

    const setPresentationMode = (active, options = {}) => {
        presentationState.active = Boolean(active);
        root.classList.toggle('is-presentation-mode', presentationState.active);
        document.body.classList.toggle('vaniday-ai-presentation-active', presentationState.active);
        sessionStorage.setItem(presentationStorageKey, presentationState.active ? 'on' : 'off');
        clearPresentationHighlight();
        syncButtons();
        if (!presentationState.active) {
            if (!options.silent) {
                appendMessage('assistant', 'Presentation Mode is off. Normal AI chat is ready.', [], {
                    progressive: true,
                    transparency: {
                        periodLabel: 'Current page',
                        sources: ['Presentation mode'],
                        confidence: 'High',
                        reasoning: 'The assistant returned to normal conversation mode.'
                    }
                });
            }
            setStatus('Normal AI mode active.', 'success');
            return;
        }
        presentationState.index = 0;
        setOpen(true);
        appendMessage('assistant', `${role === 'admin' ? 'Admin' : 'Merchant'} Presentation Mode is on. I will guide this demo section by section and highlight the part I am explaining.`, [], {
            progressive: true,
            transparency: {
                periodLabel: 'Current page',
                sources: ['Presentation mode', context.page],
                confidence: 'High',
                reasoning: 'Presentation mode uses the existing assistant interface and visible page content only.'
            }
        });
        showPresentationStep(0);
    };

    const dataSourcesFor = (text = '') => {
        const normalized = `${context.page} ${text}`.toLowerCase();
        const sources = [];
        if (/\bbooking|appointment|schedule|slot|capacity\b/.test(normalized)) sources.push('Bookings');
        if (/\brevenue|sales|order|payment|transaction\b/.test(normalized)) sources.push('Revenue');
        if (/\brefund|return|cancel\b/.test(normalized)) sources.push('Refunds');
        if (/\bspin|wheel|reward|voucher|cashback|loyalty\b/.test(normalized)) sources.push('Spin / Rewards');
        if (/\binventory|stock|product\b/.test(normalized)) sources.push('Inventory');
        if (/\bmerchant|admin|platform|user|customer\b/.test(normalized)) sources.push(role === 'admin' ? 'Platform records' : 'Merchant records');
        return [...new Set(sources.length ? sources : [role === 'admin' ? 'Admin analytics' : 'Merchant analytics'])];
    };

    const confidenceForResponse = (text = '') => {
        const normalized = String(text || '').toLowerCase();
        if (/\bnot available|limited|no data|unavailable|manual/i.test(normalized)) return 'Low';
        if (dataSourcesFor(text).length >= 3) return 'High';
        return 'Medium';
    };

    const selectedPeriodLabel = () => period?.selectedOptions?.[0]?.textContent || 'Last 30 days';

    const buildTransparencyPanel = (text = '', options = {}) => {
        if (AIUI.reasoningPanel) {
            return AIUI.reasoningPanel({
                title: 'Show Reasoning',
                dataSources: options.sources || dataSourcesFor(text),
                metrics: options.metrics || dataSourcesFor(text),
                timePeriod: options.periodLabel || selectedPeriodLabel(),
                confidence: options.confidence || confidenceForResponse(text),
                reason: options.reasoning || 'Response generated from the current page context, session memory and existing analytics endpoints.'
            });
        }
        const details = document.createElement('details');
        details.className = 'vaniday-ai-transparency';
        const summary = document.createElement('summary');
        summary.textContent = 'AI transparency';
        const list = document.createElement('dl');
        [
            ['Data Sources Used', (options.sources || dataSourcesFor(text)).join(', ')],
            ['Time Period Analysed', options.periodLabel || selectedPeriodLabel()],
            ['Confidence Level', options.confidence || confidenceForResponse(text)],
            ['Reasoning Summary', options.reasoning || 'Response generated from the current page context, session memory and existing analytics endpoints.']
        ].forEach(([label, value]) => {
            const row = document.createElement('div');
            const term = document.createElement('dt');
            const detail = document.createElement('dd');
            term.textContent = label;
            detail.textContent = value;
            row.append(term, detail);
            list.appendChild(row);
        });
        details.append(summary, list);
        return details;
    };

    const exportSingleMessage = (text = '', mode = 'text') => {
        const content = String(text || '').trim() || 'No AI response text available.';
        if (mode === 'print') {
            const win = window.open('', '_blank');
            if (!win) return;
            win.document.write(`<!doctype html><html><head><title>Vaniday AI Response</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#243225;line-height:1.5;white-space:pre-wrap}</style></head><body><h1>Vaniday AI Response</h1><p>${content.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><button onclick="window.print()">Print / Save PDF</button></body></html>`);
            win.document.close();
            return;
        }
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `vaniday-ai-response-${Date.now()}.txt`;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const addSessionMemoryRow = (bucket, row) => {
        const memory = readSessionMemory();
        memory[bucket] = Array.isArray(memory[bucket]) ? memory[bucket] : [];
        memory[bucket].push({ ...row, timestamp: new Date().toISOString() });
        writeSessionMemory(memory);
    };

    const buildMessageActions = (message, content, options = {}) => {
        const actions = document.createElement('div');
        actions.className = 'vaniday-ai-response-actions';
        const menu = document.createElement('details');
        menu.className = 'vaniday-ai-message-menu';
        const summary = document.createElement('summary');
        summary.textContent = '...';
        summary.setAttribute('aria-label', 'Message actions');
        const list = document.createElement('div');
        list.className = 'vaniday-ai-message-menu-list';
        const addButton = (label, handler, disabled = false) => {
            const button = AIUI.actionButton
                ? AIUI.actionButton(label, handler, { disabled, className: 'ai-standard-action-button' })
                : document.createElement('button');
            if (!AIUI.actionButton) {
                button.type = 'button';
                button.textContent = label;
                button.disabled = disabled;
            }
            button.addEventListener('click', () => {
                menu.removeAttribute('open');
                handler();
            });
            list.appendChild(button);
        };
        const getText = () => content.textContent || '';
        addButton('Copy', async () => {
            try {
                await navigator.clipboard.writeText(getText());
                setStatus('AI response copied.', 'success');
            } catch (error) {
                setStatus('Copy failed. Select the response text manually.', 'error');
            }
        });
        addButton('Regenerate', () => {
            const prompt = message.dataset.sourcePrompt || readSessionMemory().lastQuestion || '';
            if (prompt) submitChat(prompt);
        }, !options.sourcePrompt && !readSessionMemory().lastQuestion);
        addButton('Export', () => exportSingleMessage(getText(), 'print'));
        addButton('Share', () => setStatus('Share is ready for a future sharing integration.', 'success'));
        addButton('Pin', () => {
            addSessionMemoryRow('pinned', { title: getText().slice(0, 90) || 'Pinned insight', detail: getText(), page: context.page });
            setStatus('Pinned for this session.', 'success');
        });
        addButton('Save to Session', () => {
            addSessionMemoryRow('saved', { title: getText().slice(0, 90) || 'Saved response', detail: getText(), page: context.page });
            setStatus('Saved to this session.', 'success');
        });
        addButton('Explain More', () => submitChat(`Explain more about this: ${getText().slice(0, 260)}`));
        menu.append(summary, list);
        actions.appendChild(menu);
        return actions;
    };

    const streamTextInto = (content, finalText, onDone) => {
        const text = String(finalText || '');
        if (!text || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            content.textContent = text;
            onDone?.();
            return;
        }
        content.textContent = '';
        let index = 0;
        const step = () => {
            index = Math.min(text.length, index + Math.max(2, Math.ceil(text.length / 80)));
            content.textContent = text.slice(0, index);
            history.scrollTop = history.scrollHeight;
            if (index < text.length) {
                window.setTimeout(step, 18);
            } else {
                onDone?.();
            }
        };
        step();
    };

    const appendConversationDivider = (messageRole) => {
        if (!history) return;
        const last = Array.from(history.querySelectorAll('.vaniday-ai-message, .vaniday-ai-conversation-divider')).pop();
        if (last?.classList?.contains('vaniday-ai-conversation-divider')) return;
        const lastRole = last?.dataset?.role;
        if (!last || lastRole === messageRole) return;

        const divider = document.createElement('div');
        divider.className = 'vaniday-ai-conversation-divider';
        divider.setAttribute('role', 'separator');
        divider.textContent = messageRole === 'user' ? 'Your follow-up' : 'Assistant response';
        history.appendChild(divider);
    };

    const appendMessage = (messageRole, text, children = [], options = {}) => {
        if (!history) return null;
        appendConversationDivider(messageRole);
        const message = document.createElement('article');
        message.className = 'vaniday-ai-message';
        message.dataset.role = messageRole;
        const timestamp = options.timestamp || new Date().toISOString();
        message.dataset.timestamp = timestamp;
        message.dataset.page = options.page || context.page;
        message.dataset.path = options.path || currentPath;
        if (options.kind) message.dataset.kind = options.kind;

        const meta = document.createElement('div');
        meta.className = 'vaniday-ai-message-meta';
        const label = document.createElement('strong');
        label.textContent = messageRole === 'user' ? 'You' : 'Vaniday AI';
        const time = document.createElement('time');
        time.dateTime = timestamp;
        time.textContent = options.timeLabel || nowTimeLabel();
        meta.append(label);
        if (options.page && options.page !== context.page) {
            const page = document.createElement('small');
            page.className = 'vaniday-ai-message-page';
            page.textContent = options.page;
            meta.append(page);
        }
        meta.append(time);

        const content = document.createElement('div');
        content.className = 'vaniday-ai-message-text';
        content.textContent = options.progressive ? '' : (text || '');
        message.append(meta, content);
        if (options.sourcePrompt) message.dataset.sourcePrompt = options.sourcePrompt;
        children.forEach((child) => message.appendChild(child));
        if (messageRole === 'assistant' && !options.skipActions && options.kind !== 'typing') {
            if (options.showReasoning) {
                message.appendChild(buildTransparencyPanel(text, options.transparency || {}));
            }
            message.appendChild(buildMessageActions(message, content, options));
        }
        history.appendChild(message);
        history.scrollTop = history.scrollHeight;
        if (options.progressive) {
            streamTextInto(content, text || '', () => {
                if (!options.skipPersist) persistChat();
            });
        } else if (!options.skipPersist) {
            persistChat();
        }
        return message;
    };

    const appendTyping = (message = 'Thinking...') => {
        const node = appendMessage('assistant', message, [], { kind: 'typing', skipPersist: true, skipActions: true });
        node?.classList.add('is-typing');
        node?.setAttribute('aria-label', message);
        return node;
    };

    const createDetailList = (rows = []) => {
        const list = document.createElement('div');
        list.className = 'vaniday-ai-card-list';
        rows.filter(Boolean).forEach((row) => {
            const item = document.createElement('article');
            const title = document.createElement('strong');
            const detail = document.createElement('span');
            title.textContent = row.title || 'Insight';
            detail.textContent = row.detail || '';
            item.append(title, detail);
            if (row.meta) {
                const meta = document.createElement('small');
                meta.textContent = row.meta;
                item.appendChild(meta);
            }
            list.appendChild(item);
        });
        return list;
    };

    const inferRecommendationType = (value = '') => {
        const text = String(value || '').toLowerCase();
        if (/\b(promotion|campaign|discount|spin|wheel|reward|voucher|cashback|redemption|conversion)\b/.test(text)) return 'Promotion';
        if (/\b(inventory|stock|restock|product)\b/.test(text)) return 'Inventory';
        if (/\b(refund|return|cancellation)\b/.test(text)) return 'Refund';
        if (/\b(price|pricing|rate)\b/.test(text)) return 'Price Change';
        if (/\b(schedule|booking|availability|calendar)\b/.test(text)) return 'Schedule';
        if (/\b(merchant|review|risk)\b/.test(text)) return 'Merchant Review';
        return role === 'admin' ? 'Platform Suggestion' : 'Recommendation';
    };

    const normalizeRecommendation = (source = {}, fallbackType = '') => {
        const title = source.title
            || source.action
            || source.priority
            || source.opportunity
            || source.risk
            || source.issue
            || source.trend
            || source.merchantName
            || source.signal
            || fallbackType
            || 'Recommendation';
        const reason = source.reason
            || source.detail
            || source.impact
            || source.evidence
            || source.suggestedResponse
            || source.recommendedAction
            || 'Review this recommendation before taking action.';
        const suggestedAction = source.suggestedAction
            || source.recommendedAction
            || source.action
            || source.suggestedResponse
            || source.reason
            || 'Review and decide whether to proceed.';
        const expectedImpact = source.expectedImpact
            || source.impact
            || source.evidence
            || source.meta
            || 'Expected impact depends on current dashboard data.';
        const confidence = source.confidence
            || source.priority
            || source.urgency
            || source.severity
            || source.riskLevel
            || 'Medium';
        const type = source.type || fallbackType || inferRecommendationType(`${title} ${reason} ${suggestedAction}`);

        return {
            ...source,
            type,
            title,
            reason,
            confidence,
            expectedImpact,
            suggestedAction
        };
    };

    const createRecommendationCard = (recommendation = {}, options = {}) => {
        const normalized = normalizeRecommendation(recommendation, options.type);
        const card = document.createElement('article');
        card.className = 'vaniday-ai-recommendation-card';
        card.dataset.recommendationType = normalized.type;

        const badge = document.createElement('span');
        badge.className = 'vaniday-ai-recommendation-type';
        badge.textContent = normalized.type;

        const title = document.createElement('h4');
        title.textContent = normalized.title;

        const fields = document.createElement('div');
        fields.className = 'vaniday-ai-recommendation-fields';
        [
            ['Reason', normalized.reason],
            ['Confidence', normalized.confidence],
            ['Expected impact', normalized.expectedImpact],
            ['Suggested action', normalized.suggestedAction]
        ].forEach(([label, value]) => {
            const row = document.createElement('p');
            const key = document.createElement('strong');
            const detail = document.createElement('span');
            key.textContent = label;
            detail.textContent = value || 'Review required.';
            row.append(key, detail);
            fields.appendChild(row);
        });

        const actions = document.createElement('div');
        actions.className = 'vaniday-ai-card-actions';
        const endpoint = options.confirmEndpoint || '';

        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = 'button primary';
        confirmButton.textContent = options.confirmLabel || 'Confirm';
        confirmButton.disabled = !endpoint || !normalized.proposalId;
        confirmButton.title = confirmButton.disabled ? 'Generate a confirmable proposal before confirming.' : '';
        confirmButton.addEventListener('click', async () => {
            if (!endpoint || !normalized.proposalId || inProgress) return;
            inProgress = true;
            syncButtons();
            confirmButton.disabled = true;
            const typing = appendTyping('Confirming safely...');
            try {
                const { response, payload } = await fetchAiJson(endpoint, { proposalId: normalized.proposalId });
                if (!response.ok || !payload.success) throw new Error(payload.message || 'Action could not be confirmed.');
                typing?.remove();
                appendMessage('assistant', 'Action confirmed. Refresh the dashboard if you want to see the newest totals.');
            } catch (error) {
                typing?.remove();
                appendMessage('assistant', error.message || 'Action could not be confirmed.');
                confirmButton.disabled = false;
            } finally {
                inProgress = false;
                syncButtons();
            }
        });

        const modifyButton = document.createElement('button');
        modifyButton.type = 'button';
        modifyButton.className = 'button secondary';
        modifyButton.textContent = 'Modify';
        modifyButton.addEventListener('click', () => {
            if (input) {
                input.value = `Modify this ${normalized.type.toLowerCase()}: ${normalized.title}. `;
                input.focus();
                syncButtons();
            }
        });

        const dismissButton = document.createElement('button');
        dismissButton.type = 'button';
        dismissButton.className = 'button ghost';
        dismissButton.textContent = 'Dismiss';
        dismissButton.addEventListener('click', () => {
            card.closest('.vaniday-ai-message')?.remove();
            persistChat();
        });

        actions.append(confirmButton, modifyButton, dismissButton);
        card.append(badge, title, fields, actions);
        return card;
    };

    const createRecommendationDeck = (rows = [], type = '') => {
        const deck = document.createElement('div');
        deck.className = 'vaniday-ai-recommendation-deck';
        rows.filter(Boolean).forEach((row) => {
            deck.appendChild(createRecommendationCard(row, { type }));
        });
        return deck;
    };

    const createNavigationCard = ({ title, detail, href = '', actionLabel = 'Open', tone = 'info' } = {}) => {
        const card = document.createElement('article');
        card.className = 'vaniday-ai-navigation-card';
        card.dataset.tone = tone;
        const heading = document.createElement('strong');
        heading.textContent = title || 'Navigation';
        const copy = document.createElement('span');
        copy.textContent = detail || '';
        card.append(heading, copy);
        if (href) {
            const link = document.createElement('a');
            link.className = 'button secondary compact';
            link.href = href;
            link.textContent = actionLabel;
            card.appendChild(link);
        }
        return card;
    };

    const navigationMap = {
        merchant: [
            { keys: ['dashboard', 'merchant dashboard', 'home'], label: 'Merchant Dashboard', href: '/merchant/dashboard' },
            { keys: ['analytics', 'insights', 'kpi', 'report'], label: 'Analytics', href: '/merchant/analytics' },
            { keys: ['booking', 'bookings', 'appointments'], label: 'Bookings', href: '/merchant/bookings' },
            { keys: ['refund', 'refunds', 'support', 'pending refunds'], label: 'Refunds', href: '/merchant/support' },
            { keys: ['inventory', 'stock', 'low stock'], label: 'Products and Inventory', href: '/merchant/products' },
            { keys: ['products', 'manage products'], label: 'Products', href: '/merchant/products' },
            { keys: ['services', 'manage services'], label: 'Services', href: '/merchant/services' },
            { keys: ['promotions', 'campaigns', 'manage promotions'], label: 'Promotions', href: '/merchant/promotions' },
            { keys: ['spin', 'wheel', 'spin dashboard', 'spin discover'], label: 'Spin & Discover', href: '/merchant/spin-discover' },
            { keys: ['wallet', 'loyalty', 'rewards'], label: 'Loyalty', href: '/merchant/loyalty' },
            { keys: ['vouchers'], label: 'Vouchers', href: '/merchant/vouchers' },
            { keys: ['cashback'], label: 'Cashback', href: '/merchant/cashback' },
            { keys: ['profile', 'settings'], label: 'Profile', href: '/merchant/profile' },
            { keys: ['schedule', 'availability'], label: 'Schedule', href: '/merchant/schedule' },
            { keys: ['orders', 'product orders'], label: 'Orders', href: '/merchant/orders' },
            { keys: ['reviews', 'customer reviews'], label: 'Customer Reviews', href: '/merchant/dashboard#reviews' }
        ],
        admin: [
            { keys: ['dashboard', 'admin dashboard', 'overview'], label: 'Admin Dashboard', href: '/admin/overview' },
            { keys: ['analytics', 'platform analytics'], label: 'Analytics', href: '/admin/analytics' },
            { keys: ['merchants', 'merchant management', 'merchant profile'], label: 'Merchant Management', href: '/admin/merchants' },
            { keys: ['users', 'customers', 'customer profile'], label: 'Users', href: '/admin/users' },
            { keys: ['refunds', 'refund disputes'], label: 'Refunds', href: '/admin/refund-disputes' },
            { keys: ['reports', 'audit', 'audit trail'], label: 'Reports', href: '/admin/audit-trail' },
            { keys: ['spin', 'spin management', 'spin statistics'], label: 'Spin Management', href: '/admin/rewards-game' },
            { keys: ['rewards', 'reward management', 'reward shop'], label: 'Reward Management', href: '/admin/reward-shop' },
            { keys: ['products'], label: 'Products', href: '/admin/products' },
            { keys: ['services'], label: 'Services', href: '/admin/services' },
            { keys: ['promotions'], label: 'Promotions', href: '/admin/promotions' },
            { keys: ['reviews'], label: 'Reviews', href: '/admin/reviews' },
            { keys: ['platform health'], label: 'Platform Health', href: '/admin/platform-health' }
        ]
    };

    const filterMap = [
        { keys: ['today'], params: { date: 'today' }, label: "today's records" },
        { keys: ['this week', 'week'], params: { period: 'week' }, label: 'this week' },
        { keys: ['completed bookings', 'completed appointments', 'completed'], params: { status: 'completed' }, label: 'completed records' },
        { keys: ['cancelled bookings', 'cancelled appointments', 'cancelled'], params: { status: 'cancelled' }, label: 'cancelled records' },
        { keys: ['refunded orders', 'refunded'], params: { status: 'refunded' }, label: 'refunded records' },
        { keys: ['pending refunds', 'pending refund'], params: { status: 'pending' }, label: 'pending refunds' },
        { keys: ['low inventory', 'low stock', 'under 10 units', 'products under 10'], params: { stock: 'low', maxStock: '10' }, label: 'low-stock products' },
        { keys: ['top services'], params: { sort: 'top-services' }, label: 'top services' },
        { keys: ['poor reviews', 'low reviews'], params: { rating: 'low' }, label: 'poor reviews' },
        { keys: ['vouchers'], params: { type: 'voucher' }, label: 'vouchers' },
        { keys: ['cashback campaigns', 'cashback'], params: { type: 'cashback' }, label: 'cashback campaigns' },
        { keys: ['newest', 'sort by newest'], params: { sort: 'newest' }, label: 'newest first' }
    ];

    const blockedBusinessAction = (text = '') => {
        const normalized = String(text || '').toLowerCase();
        return /\b(approve|reject|delete|remove|change|modify|update|suspend|create|restock|refund|complete)\b/.test(normalized)
            && /\b(refund|booking|product|service|inventory|price|merchant|promotion|schedule|order)\b/.test(normalized)
            && !/\b(open|show|view|find|search|explain|how do i|how to|where)\b/.test(normalized);
    };

    const findNavigationTarget = (text = '') => {
        const normalized = String(text || '').toLowerCase();
        const rows = navigationMap[role] || [];
        return rows.find((item) => item.keys.some((key) => {
            const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return pattern.test(normalized);
        })) || null;
    };

    const getSearchTerm = (text = '') => {
        const match = String(text || '').match(/\b(?:find|search|open|show)\s+(?:for\s+)?(.+?)\s*$/i);
        if (!match) return '';
        return match[1]
            .replace(/^(all|only|the)\s+/i, '')
            .replace(/\b(today|this week|completed|cancelled|refunded|pending|low stock|low inventory|newest)\b/ig, '')
            .replace(/^(booking|receipt|refund request|customer|merchant|product|service)\s+#?/i, '')
            .trim();
    };

    const inferSearchTarget = (text = '', term = '') => {
        const normalized = `${text} ${term}`.toLowerCase();
        if (/\breceipt\b/.test(normalized)) return role === 'admin'
            ? { label: 'Reports', href: '/admin/audit-trail' }
            : { label: 'Orders', href: '/merchant/orders' };
        if (/\bbooking|appointment\b/.test(normalized)) return role === 'admin'
            ? { label: 'Bookings', href: '/admin/bookings' }
            : { label: 'Bookings', href: '/merchant/bookings' };
        if (/\brefund|return|support\b/.test(normalized)) return role === 'admin'
            ? { label: 'Refunds', href: '/admin/refund-disputes' }
            : { label: 'Refunds', href: '/merchant/support' };
        if (/\bcustomer|user|john|mary\b/.test(normalized)) return role === 'admin'
            ? { label: 'Users', href: '/admin/users' }
            : { label: 'Customers', href: '/merchant/customers' };
        if (/\bmerchant|salon\b/.test(normalized)) return role === 'admin'
            ? { label: 'Merchants', href: '/admin/merchants' }
            : { label: 'Profile', href: '/merchant/profile' };
        if (/\bproduct|shampoo|serum|mask|stock|inventory\b/.test(normalized)) return role === 'admin'
            ? { label: 'Products', href: '/admin/products' }
            : { label: 'Products', href: '/merchant/products' };
        if (/\bservice|spa|facial|hair|massage|manicure\b/.test(normalized)) return role === 'admin'
            ? { label: 'Services', href: '/admin/services' }
            : { label: 'Services', href: '/merchant/services' };
        if (/\bvoucher|reward\b/.test(normalized)) return role === 'admin'
            ? { label: 'Reward Management', href: '/admin/reward-shop' }
            : { label: 'Vouchers', href: '/merchant/vouchers' };
        if (/\bcashback\b/.test(normalized)) return role === 'admin'
            ? { label: 'Cashback', href: '/admin/cashback' }
            : { label: 'Cashback', href: '/merchant/cashback' };
        if (/\bpromotion|campaign\b/.test(normalized)) return role === 'admin'
            ? { label: 'Promotions', href: '/admin/promotions' }
            : { label: 'Promotions', href: '/merchant/promotions' };
        return role === 'admin'
            ? { label: 'Admin Dashboard', href: '/admin/overview' }
            : { label: 'Merchant Dashboard', href: '/merchant/dashboard' };
    };

    const appendQuery = (href, params = {}) => {
        const url = new URL(href, window.location.origin);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
        });
        return `${url.pathname}${url.search}${url.hash}`;
    };

    const applyControlsOnCurrentPage = (params = {}, searchTerm = '') => {
        let applied = false;
        if (searchTerm) {
            const search = document.querySelector('input[type="search"], input[name="search"], input[name="q"], input[placeholder*="Search" i]');
            if (search) {
                search.value = searchTerm;
                search.dispatchEvent(new Event('input', { bubbles: true }));
                search.dispatchEvent(new Event('change', { bubbles: true }));
                applied = true;
            }
        }
        Object.entries(params).forEach(([key, value]) => {
            const control = document.querySelector(`[name="${key}"], [data-filter="${key}"], [data-${key}-filter]`);
            if (control && 'value' in control) {
                control.value = value;
                control.dispatchEvent(new Event('input', { bubbles: true }));
                control.dispatchEvent(new Event('change', { bubbles: true }));
                applied = true;
            }
        });
        return applied;
    };

    const highlightCurrentPageMatch = (term = '') => {
        const value = String(term || '').trim().toLowerCase();
        if (!value) return false;
        const candidates = Array.from(document.querySelectorAll('article, tr, section, .merchant-service-row, .js-merchant-promotion-card, .admin-merchant-card'));
        const match = candidates.find((node) => String(node.textContent || '').toLowerCase().includes(value));
        if (!match) return false;
        match.scrollIntoView({ behavior: 'smooth', block: 'center' });
        match.classList.add('vaniday-ai-highlight');
        setTimeout(() => match.classList.remove('vaniday-ai-highlight'), 2600);
        return true;
    };

    const performSafeUiAction = (text = '') => {
        const normalized = String(text || '').toLowerCase();
        const scrollMatch = normalized.match(/\b(?:scroll to|highlight|expand|collapse)\s+(.+)/);
        if (scrollMatch) {
            const term = scrollMatch[1].trim();
            const found = highlightCurrentPageMatch(term);
            return {
                handled: true,
                title: found ? `Showing ${term}` : 'I could not find that section here',
                detail: found ? `${term} is highlighted on this page.` : 'Try opening the relevant dashboard page first.'
            };
        }
        if (/\b(export report|print report)\b/.test(normalized)) {
            const button = Array.from(document.querySelectorAll('button, a')).find((node) => /print|save pdf|export report|open html/i.test(node.textContent || ''));
            if (button) {
                button.click();
                return { handled: true, title: 'Report action opened', detail: 'I used the existing report control on this page.' };
            }
            return { handled: true, title: 'No report control found here', detail: 'Open Analytics or the Executive Dashboard report section first.' };
        }
        if (/\b(open details|expand recommendations|expand chart|collapse panel)\b/.test(normalized)) {
            const details = Array.from(document.querySelectorAll('details')).find((node) => /recommendation|chart|insight|detail/i.test(node.textContent || ''));
            if (details) {
                details.open = !/\bcollapse\b/.test(normalized);
                details.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return { handled: true, title: details.open ? 'Panel expanded' : 'Panel collapsed', detail: 'I used the existing page panel control.' };
            }
            return { handled: true, title: 'No expandable panel found', detail: 'There is no matching expandable section on this page.' };
        }
        return null;
    };

    const resolveAppAssistantAction = (text = '') => {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized) return null;

        if (blockedBusinessAction(normalized)) {
            return {
                handled: true,
                title: 'That needs confirmation',
                detail: 'I cannot directly change business data. I can explain the workflow or prepare a proposal for review instead.',
                tone: 'warning'
            };
        }

        if (/^how\s+(do|can)\s+i\b|^how to\b/.test(normalized)) {
            return null;
        }

        const uiAction = performSafeUiAction(normalized);
        if (uiAction) return { ...uiAction, tone: 'success' };

        const idMatch = normalized.match(/\b(receipt|booking|refund request)\s+#?([a-z0-9-]+)/i);
        if (idMatch) {
            const type = idMatch[1];
            const id = encodeURIComponent(idMatch[2]);
            const href = type === 'receipt'
                ? `/receipt/${id}`
                : type === 'booking'
                    ? (role === 'admin' ? `/admin/bookings?search=${id}` : `/merchant/bookings?search=${id}`)
                    : `/help-center?search=${id}`;
            return { handled: true, navigate: true, href, title: `Opening ${type}`, detail: `I found the existing ${type} route/search view.`, tone: 'success' };
        }

        const isNavigation = /\b(open|go to|take me to|show|view|manage)\b/.test(normalized) || /^[a-z ]{3,28}$/.test(normalized);
        const target = findNavigationTarget(normalized);
        const filter = filterMap.find((item) => item.keys.some((key) => normalized.includes(key)));
        const searchTerm = /\b(find|search)\b/.test(normalized) ? getSearchTerm(text) : '';

        if (target && (isNavigation || searchTerm || filter)) {
            const params = { ...(filter?.params || {}) };
            if (searchTerm) params.search = searchTerm;
            const href = appendQuery(target.href, params);
            return {
                handled: true,
                navigate: true,
                href,
                title: `Opening ${target.label}`,
                detail: filter ? `Showing ${filter.label}${searchTerm ? ` matching "${searchTerm}"` : ''}.` : `Loading ${target.label}.`,
                tone: 'success'
            };
        }

        if (filter || searchTerm) {
            const params = { ...(filter?.params || {}) };
            if (searchTerm) params.search = searchTerm;
            const applied = applyControlsOnCurrentPage(params, searchTerm) || highlightCurrentPageMatch(searchTerm);
            if (applied) {
                sessionStorage.setItem(`${storagePrefix}:last-app-filter:${currentPath}`, JSON.stringify({ params, searchTerm }));
                return {
                    handled: true,
                    title: filter ? `Showing ${filter.label}` : `Searching for ${searchTerm}`,
                    detail: 'I applied the existing controls on this page.',
                    tone: 'success'
                };
            }
            const fallbackTarget = searchTerm
                ? inferSearchTarget(text, searchTerm)
                : findNavigationTarget(filter?.keys?.[0] || '');
            if (fallbackTarget) {
                return {
                    handled: true,
                    navigate: true,
                    href: appendQuery(fallbackTarget.href, params),
                    title: searchTerm ? `Searching for ${searchTerm}` : `Opening filtered view`,
                    detail: 'I will open the closest existing page and pass the filter in the URL.',
                    tone: 'success'
                };
            }
        }

        if (/^(only|show only|sort by)\b/.test(normalized)) {
            const last = sessionStorage.getItem(`${storagePrefix}:last-app-filter:${currentPath}`);
            const filterOnly = filterMap.find((item) => item.keys.some((key) => normalized.includes(key)));
            if (filterOnly || last) {
                let prior = {};
                try {
                    prior = last ? JSON.parse(last) : {};
                } catch (error) {
                    prior = {};
                }
                const params = { ...(prior.params || {}), ...(filterOnly?.params || {}) };
                const applied = applyControlsOnCurrentPage(params, prior.searchTerm || '');
                return {
                    handled: true,
                    title: filterOnly ? `Refined to ${filterOnly.label}` : 'Filter refined',
                    detail: applied ? 'I updated the existing page controls.' : 'This page does not expose a matching filter control, so keep using the page filters manually.',
                    tone: applied ? 'success' : 'warning'
                };
            }
        }

        return null;
    };

    const fetchAiJson = async (url, body) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        try {
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            const payload = await response.json().catch(() => ({
                success: false,
                message: response.ok
                    ? 'AI returned an unreadable response.'
                    : `AI request failed with HTTP ${response.status}.`
            }));
            if (!response.ok && !payload.message) {
                payload.message = `AI request failed with HTTP ${response.status}.`;
            }
            return { response, payload };
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('AI request timed out. Please try again.');
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    };

    const actionConfirmEndpoint = (actionType) => ({
        create_promotion: '/api/ai/merchant/actions/confirm-promotion',
        change_service_price: '/api/ai/merchant/actions/confirm-price-change',
        adjust_inventory: '/api/ai/merchant/actions/confirm-inventory-change',
        create_reminder: '/api/ai/merchant/actions/confirm-reminder',
        update_schedule: '/api/ai/merchant/actions/confirm-schedule-change'
    }[actionType] || '');

    const createProposalCard = (proposal = {}) => {
        const endpoint = role === 'merchant' ? actionConfirmEndpoint(proposal.actionType) : '';
        return createRecommendationCard({
            ...proposal,
            type: inferRecommendationType(proposal.actionType || proposal.title || proposal.reason),
            confidence: proposal.riskLevel || 'Requires confirmation',
            expectedImpact: (proposal.evidence || [])[0] || 'Prepared from current analytics context.',
            suggestedAction: proposal.title || proposal.actionType || 'Review and confirm this proposal.'
        }, {
            confirmEndpoint: endpoint && proposal.riskLevel !== 'recommend_only' ? endpoint : '',
            confirmLabel: proposal.actionType === 'create_promotion'
                ? 'Create Promotion'
                : proposal.actionType === 'create_reminder'
                    ? 'Create Reminder'
                    : 'Confirm'
        });
    };

    const formatComparisonValue = (row = {}) => {
        const label = String(row.label || '').toLowerCase();
        const current = Number(row.current || 0);
        const previous = Number(row.previous || 0);
        if (/revenue|refund|cashback|loyalty|promotion|spin/.test(label)) return `S$${previous.toFixed(2)} -> S$${current.toFixed(2)}`;
        if (/rating/.test(label)) return `${previous.toFixed(1)} -> ${current.toFixed(1)}`;
        return `${previous} -> ${current}`;
    };

    const createComparisonReportCard = (comparison = {}, answer = {}) => {
        const card = document.createElement('section');
        card.className = 'vaniday-ai-comparison-report';
        const heading = document.createElement('div');
        heading.className = 'vaniday-ai-comparison-heading';
        const title = document.createElement('strong');
        title.textContent = comparison.label || 'Business comparison';
        const confidence = AIUI.confidenceBadge ? AIUI.confidenceBadge(comparison.confidence || 'Medium') : document.createElement('span');
        if (!AIUI.confidenceBadge) confidence.textContent = comparison.confidence || 'Medium';
        const periodText = document.createElement('p');
        periodText.textContent = `${comparison.periods?.current?.label || 'Current period'} compared with ${comparison.periods?.previous?.label || 'comparison period'}. Charts remain unchanged.`;
        heading.append(title, confidence, periodText);
        card.appendChild(heading);

        const metrics = document.createElement('div');
        metrics.className = 'vaniday-ai-comparison-metrics';
        (comparison.metrics || []).slice(0, 12).forEach((row) => {
            const metric = document.createElement('article');
            const name = document.createElement('span');
            const values = document.createElement('strong');
            const change = document.createElement('em');
            name.textContent = row.label || 'Metric';
            values.textContent = formatComparisonValue(row);
            change.textContent = row.change?.label || 'No previous activity';
            change.dataset.direction = row.change?.value === null ? 'neutral' : Number(row.change.value) >= 0 ? 'up' : 'down';
            metric.append(name, values, change);
            metrics.appendChild(metric);
        });
        if (metrics.children.length) card.appendChild(metrics);

        const block = (label, rows = [], emptyText = '') => {
            const wrap = document.createElement('div');
            wrap.className = 'vaniday-ai-comparison-block';
            const headingNode = document.createElement('h4');
            headingNode.textContent = label;
            const list = document.createElement('ul');
            const items = rows.length ? rows : [emptyText].filter(Boolean);
            items.slice(0, 5).forEach((item) => {
                const li = document.createElement('li');
                li.textContent = typeof item === 'string' ? item : `${item.label || 'Metric'} ${item.change?.label || ''}`.trim();
                list.appendChild(li);
            });
            wrap.append(headingNode, list);
            return wrap;
        };

        const details = document.createElement('div');
        details.className = 'vaniday-ai-comparison-details';
        details.append(
            block('Key Improvements', comparison.keyImprovements || [], 'No clear improvement was detected from available metrics.'),
            block('Key Declines', comparison.keyDeclines || [], 'No clear decline was detected from available metrics.'),
            block('Reasons', comparison.reasons || [], 'Confirm reasons against the unchanged dashboard charts and records.'),
            block('Recommendations', comparison.recommendations || answer.suggestedNextSteps || answer.recommendedAdminActions || [], 'Review source charts before making business changes.')
        );
        card.appendChild(details);
        return card;
    };

    const renderInsightsToChat = (payload = {}, options = {}) => {
        const insights = payload.insights || payload.fallback || {};
        const rows = role === 'admin'
            ? [
                ...(insights.platformTrends || []).map((row) => ({ ...row, title: row.trend, reason: row.impact, expectedImpact: row.evidence, suggestedAction: row.recommendedAction || row.impact, type: 'Platform Suggestion' })),
                ...(insights.merchantAttention || []).map((row) => ({ ...row, title: row.merchantName || row.issue, reason: row.issue, expectedImpact: row.evidence, suggestedAction: row.recommendedAction, confidence: row.severity, type: 'Merchant Review' })),
                ...(insights.operationalRisks || []).map((row) => ({ ...row, title: row.risk, reason: row.evidence, expectedImpact: row.severity ? `Severity: ${row.severity}` : row.evidence, suggestedAction: row.recommendedAction, confidence: row.severity, type: 'Platform Suggestion' })),
                ...(insights.adminPriorities || []).map((row) => ({ ...row, title: row.priority, reason: row.reason, expectedImpact: row.urgency ? `Urgency: ${row.urgency}` : row.reason, suggestedAction: row.reason, confidence: row.urgency, type: 'Platform Suggestion' }))
            ]
            : [
                ...(insights.keyFindings || []).map((row) => ({ ...row, reason: row.detail, expectedImpact: row.evidence, suggestedAction: row.detail, type: inferRecommendationType(row.title || row.detail) })),
                ...(insights.recommendedActions || []).map((row) => ({ ...row, title: row.action, reason: row.reason, confidence: row.priority, expectedImpact: row.reason, suggestedAction: row.action, type: inferRecommendationType(row.action || row.reason) })),
                ...(insights.risks || []).map((row) => ({ ...row, title: row.issue, reason: row.suggestedResponse, confidence: row.severity, expectedImpact: row.severity ? `Severity: ${row.severity}` : row.suggestedResponse, suggestedAction: row.suggestedResponse, type: inferRecommendationType(row.issue || row.suggestedResponse) }))
            ];
        appendMessage('assistant', insights.executiveSummary || insights.summary || context.help, rows.length ? [createRecommendationDeck(rows.slice(0, 8))] : [], {
            progressive: true,
            sourcePrompt: options.sourcePrompt,
            transparency: {
                periodLabel: selectedPeriodLabel(),
                sources: dataSourcesFor(`${context.page} insights performance revenue bookings refunds spin inventory`),
                confidence: payload.fallback ? 'Medium' : 'High',
                reasoning: 'Generated from the existing analytics insight endpoint and the selected assistant period.'
            }
        });
    };

    const renderAnswerToChat = (answer = {}, options = {}, payload = {}) => {
        const sourcePrompt = String(options.sourcePrompt || '');
        const wantsDetails = /\b(evidence|reasoning|show reason|why exactly|details?|limitations?|sources?)\b/i.test(sourcePrompt);
        const detailRows = wantsDetails
            ? [
                ...(answer.supportingEvidence || []).slice(0, 3).map((item) => ({ title: 'Evidence', detail: item })),
                ...(answer.limitations || []).slice(0, 2).map((item) => ({ title: 'Limitation', detail: item }))
            ]
            : [];
        const comparisonCard = payload.comparison ? createComparisonReportCard(payload.comparison, answer) : null;
        appendMessage('assistant', answer.answer || 'No answer returned.', [
            ...(comparisonCard ? [comparisonCard] : []),
            ...(detailRows.length ? [createDetailList(detailRows)] : [])
        ], {
            progressive: true,
            sourcePrompt,
            showReasoning: wantsDetails || Boolean(payload.comparison),
            transparency: {
                periodLabel: payload.comparison?.label || selectedPeriodLabel(),
                sources: payload.comparison
                    ? ['Existing analytics summary', 'Comparison periods', ...dataSourcesFor(`${sourcePrompt} ${answer.answer || ''}`)]
                    : dataSourcesFor(`${sourcePrompt} ${answer.answer || ''}`),
                metrics: payload.comparison?.metrics?.map((row) => row.label).slice(0, 10),
                confidence: payload.comparison?.confidence || ((answer.limitations || []).length ? 'Medium' : confidenceForResponse(answer.answer || '')),
                reasoning: payload.ai?.orchestrated
                    ? `Answered through the global AI orchestrator using detected intent ${payload.ai.intent || 'unknown'} and verified backend data.`
                    : payload.comparison
                        ? 'Compared two periods through the existing ask-analytics endpoint and existing analytics summaries. Charts were not changed.'
                        : 'Answered using the current page context, session memory and existing ask-analytics endpoint.'
            }
        });
    };

    const getConversationMemory = () => {
        const rows = getStoredConversation()
            .filter((row) => ['user', 'assistant'].includes(row.role) && row.text && row.text !== 'Thinking...')
            .slice(-6);

        if (!rows.length) return '';

        return rows.map((row) => {
            const label = row.role === 'user' ? 'User' : 'AI';
            return `${label}: ${String(row.text).replace(/\s+/g, ' ').slice(0, 130)}`;
        }).join(' | ');
    };

    const isFollowUpQuestion = (text) => {
        const normalized = String(text || '').trim().toLowerCase();
        return /^(why|how|what about|which one|tell me more|explain|so what|and then|what should i do|why is that|why\?)\??$/.test(normalized)
            || normalized.length <= 18 && /\b(why|how|more|explain)\b/.test(normalized);
    };

    const createContextPrompt = (text) => {
        const memory = getConversationMemory();
        const sessionSummary = sessionMemorySummary();
        const smartReferenceHint = /\b(that|this|it|those|them|previous one|last report|previous chart|same product|same service|same merchant|earlier)\b/i.test(text)
            ? ' Resolve references such as that, it, previous one, last report, same product, same service or same merchant using session memory.'
            : '';
        const followUpHint = isFollowUpQuestion(text) ? ' Treat this as a follow-up to the previous conversation.' : '';
        const shouldUseMemory = Boolean(smartReferenceHint || followUpHint);
        const memoryText = memory && shouldUseMemory ? ` Recent conversation: ${memory}.` : '';
        const pageDataText = formatSpinAiContext();
        const pageData = pageDataText ? ` ${pageDataText.slice(0, 240)}` : '';
        const recentMemory = shouldUseMemory ? `${memoryText} Session memory: ${sessionSummary}.`.slice(0, 260) : '';
        const prefix = `Current page: ${context.page}. Answer briefly unless the user asks for details or recommendations. Page help: ${context.help}.${pageData}${followUpHint}${smartReferenceHint}${recentMemory} User question:`;
        const availableQuestionLength = Math.max(80, 500 - prefix.length - 1);
        return `${prefix} ${String(text || '').slice(0, availableQuestionLength)}`.slice(0, 500);
    };

    const resolveCommand = (text) => {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized.startsWith('/')) return null;

        const command = normalized.split(/\s+/)[0];
        const commandMap = {
            '/summary': { intent: 'insights', prompt: `Summarise ${context.page}.` },
            '/performance': { intent: 'insights', prompt: `Review performance for ${context.page}.` },
            '/promotion': { intent: 'proposal', prompt: role === 'admin' ? 'Suggest platform campaigns.' : 'Suggest a promotion.' },
            '/inventory': { intent: role === 'merchant' ? 'proposal' : 'question', prompt: 'Review inventory, stock and product demand.' },
            '/refunds': { intent: role === 'merchant' ? 'proposal' : 'question', prompt: 'Review refund trends and refund cases that need attention.' },
            '/spin': { intent: role === 'merchant' ? 'proposal' : 'question', prompt: 'Analyse Spin & Discover wheel wins, redemptions, inventory, claim limits, conversion and campaign performance. Suggest voucher, promotion, cashback or new reward changes for merchant approval only.' },
            '/help': { intent: 'help', prompt: commandHelpText }
        };

        return commandMap[command] || { intent: 'help', prompt: `Unknown command "${command}".\n\n${commandHelpText}` };
    };

    const unifiedFormatInstruction = 'Use the unified AI response format: Summary, Key Findings, Recommendations, Confidence and Suggested Next Actions. Keep it concise and business-focused.';

    const resolveUniversalAiRoute = (text = '') => {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized) return null;

        if (/\b(presentation mode|start presentation|demo mode|walkthrough)\b/.test(normalized)) {
            return { local: 'presentation' };
        }

        if (/\b(timeline|business timeline|important events|chronological)\b/.test(normalized)) {
            return {
                local: 'timeline',
                prompt: `Explain the Business Timeline on this page. ${unifiedFormatInstruction}`
            };
        }

        if (/\b(compare|comparison|versus| vs |against)\b/.test(` ${normalized} `)) {
            let prompt = text;
            if (/\b(this|current)\s+month\b/.test(normalized) && !/\b(last|previous)\s+month\b/.test(normalized)) {
                prompt = 'Compare this month with last month.';
            } else if (/\b(this|current)\s+week\b/.test(normalized) && !/\b(last|previous)\s+week\b/.test(normalized)) {
                prompt = 'Compare this week with last week.';
            } else if (/\b(this|current)\s+year\b/.test(normalized) && !/\b(last|previous)\s+year\b/.test(normalized)) {
                const currentYear = Number(new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', year: 'numeric' }).format(new Date()));
                prompt = `Compare ${currentYear - 1} with ${currentYear}.`;
            }
            return {
                intent: 'question',
                prompt: `${prompt} ${unifiedFormatInstruction}`,
                module: 'Comparison'
            };
        }

        if (/\b(daily brief|summari[sz]e today|today'?s summary|what should i do today|biggest problem|most important today)\b/.test(normalized)) {
            return {
                intent: role === 'merchant' && /\b(remind|what should i do|problem|priority)\b/.test(normalized) ? 'reminders' : 'question',
                prompt: `Summarise today's priorities for ${context.page}. Highlight the biggest issue, key findings, recommendations and next actions. ${unifiedFormatInstruction}`,
                module: 'Daily Brief'
            };
        }

        if (/\b(how is my business|how is the business|how are we doing|business health|explain business health|health score)\b/.test(normalized)) {
            return {
                intent: 'insights',
                prompt: `Explain ${role === 'admin' ? 'platform' : 'business'} health using the Executive Dashboard and Business Health score. ${unifiedFormatInstruction}`,
                module: 'Executive Dashboard'
            };
        }

        if (/\b(explain this page|explain page|what am i looking at|explain everything|explain dashboard)\b/.test(normalized)) {
            return {
                intent: 'question',
                prompt: `Explain the current ${context.page} page using the visible dashboard context and existing analytics. ${unifiedFormatInstruction}`,
                module: 'Explain Everything'
            };
        }

        if (/\b(analy[sz]e spin|spin performance|wheel performing|reward popular|poor redemption|spin campaign)\b/.test(normalized)) {
            return {
                intent: 'question',
                prompt: `Analyse Spin & Discover performance using existing Spin intelligence, wins, redemptions, inventory, claim limits, conversion and campaign performance. Do not apply changes automatically. ${unifiedFormatInstruction}`,
                module: 'Spin Intelligence'
            };
        }

        if (/\b(revenue|sales|bookings? down|booking decline|why are bookings|service earns|top service|products? performing poorly|low inventory|refunds?|ratings?|promotion performance|loyalty|cashback)\b/.test(normalized)) {
            return {
                intent: 'question',
                prompt: text,
                module: 'Analytics'
            };
        }

        if (/\b(recommend|what should i do|next action|priority|operations|risk)\b/.test(normalized)) {
            return {
                intent: role === 'merchant' ? 'proposal' : 'question',
                prompt: `${text}. Use Operations Intelligence and existing proposal confirmation rules where action is needed. ${unifiedFormatInstruction}`,
                module: 'Operations Intelligence'
            };
        }

        return null;
    };

    const classifyIntent = (text) => {
        const normalized = String(text || '').toLowerCase();
        if (/\b(compare|comparison|versus| vs |against)\b/.test(` ${normalized} `)) return 'question';
        if (/\b(how is my business|business health|daily brief|biggest problem)\b/.test(normalized)) return 'insights';
        if (role === 'merchant' && /\b(reminder|remind)\b/.test(normalized)) return 'reminders';
        if (role === 'merchant' && /\b(spin|wheel|reward|voucher|cashback|redemption|conversion|claim\s+limit|campaign|replace)\b/.test(normalized)) return 'question';
        if (/\b(summarise|summarize|summary|performance|overview|kpi|trend)\b/.test(normalized)) return 'question';
        if (role === 'merchant' && /\b(promotion|price|restock|inventory|schedule|action|prepare|refunds?\s+need|attention)\b/.test(normalized)) return 'proposal';
        if (role === 'admin' && /\b(prepare|recommendation|review|suspend|campaign|detect|unusual|inactive|declining)\b/.test(normalized)) return 'proposal';
        return 'question';
    };

    const maybeHandleMemoryRecall = (text = '') => {
        const normalized = String(text || '').toLowerCase();
        const memory = readSessionMemory();
        if (/\b(what have we discussed|summari[sz]e.*conversation|today'?s conversation|recommendations have you given)\b/.test(normalized)) {
            const topics = Object.values(memory.topics || {}).map((topic) => topic.topic).filter(Boolean);
            const recs = trimRows(memory.recommendations, 5).map((row) => row.title).filter(Boolean);
            const reports = trimRows(memory.reports, 4).map((row) => row.title).filter(Boolean);
            const answers = trimRows(memory.answers, 3).map((row) => row.text).filter(Boolean);
            const lines = [
                topics.length ? `We discussed: ${topics.join(', ')}.` : 'We have not built up much session history yet.',
                answers.length ? `Recent answers: ${answers.map((item) => item.slice(0, 110)).join(' | ')}` : '',
                recs.length ? `Recommendations: ${recs.join('; ')}.` : '',
                reports.length ? `Reports: ${reports.join('; ')}.` : '',
                'This is session-only memory and will not be saved permanently.'
            ].filter(Boolean);
            appendMessage('assistant', lines.join('\n'));
            setStatus('Session summary ready.', 'success');
            return true;
        }

        if (/\b(show|open|explain|go back to|compare).*\b(last|previous|that|earlier)\b/.test(normalized)) {
            const item = normalized.includes('report') ? memory.lastReport
                : normalized.includes('recommend') ? memory.lastProposal
                    : normalized.includes('chart') ? { title: memory.lastExplainedChart, detail: 'Previously explained chart' }
                        : memory.lastProposal || memory.lastReport || memory.lastOpened;
            if (item?.href) {
                appendMessage('assistant', `Opening ${item.title || 'the previous item'}...`, [createNavigationCard({
                    title: item.title || 'Previous item',
                    detail: item.detail || 'Opening from session memory.',
                    href: item.href,
                    tone: 'success'
                })]);
                setTimeout(() => window.location.assign(item.href), 450);
                return true;
            }
            if (item?.title || item?.detail) {
                appendMessage('assistant', `${item.title || 'Previous item'}\n${item.detail || 'This is the latest related item from session memory.'}`);
                setStatus('Previous item recalled.', 'success');
                return true;
            }
            appendMessage('assistant', 'I do not have a previous matching item in this browser session yet.', [], { kind: 'error' });
            setStatus('No matching session memory yet.', 'error');
            return true;
        }

        return false;
    };

    const textFromAnswerPayload = (payload = {}) => {
        const answer = payload.answer || payload.fallback || {};
        return answer.answer || answer.summary || payload.message || '';
    };

    const friendlyErrorMessage = (error) => {
        const message = String(error?.message || '').toLowerCase();
        if (/timeout|timed out|abort/.test(message)) return 'The AI request timed out. Try again, or narrow the question to one dashboard area.';
        if (/csrf|verified|refresh/.test(message)) return 'Your page security token expired. Refresh the page, then try the AI assistant again.';
        if (/401|login|unauth/.test(message)) return 'Please sign in again before using the AI assistant.';
        if (/403|permission|approved|role|merchant account/.test(message)) return 'You do not have permission for that AI action on this page, or the merchant account is not approved.';
        if (/429|rate/.test(message)) return 'The AI assistant is receiving too many requests. Wait a moment, then try again.';
        if (/500|502|503|unavailable/.test(message)) return 'The AI service is unavailable right now. Please try again in a moment.';
        if (/no data|insufficient|empty/.test(message)) return 'There is not enough data for that analysis yet. Try a wider period or ask for a general workflow explanation.';
        if (/network|fetch/.test(message)) return 'The AI service could not be reached. Check the connection and try again.';
        return error?.message || 'AI is temporarily unavailable. Please try again in a moment.';
    };

    const smartSuggestionsFor = (text = '') => {
        const topic = inferTopic(text) || readSessionMemory().lastTopic || context.page.toLowerCase();
        const suggestions = {
            refunds: ['Explain your refund trend', 'Compare refunds with last month', 'Review pending refunds'],
            bookings: ['Compare booking demand', 'Explain cancellations', 'Show quiet periods'],
            inventory: ['Review low inventory', 'Find products under 10 units', 'Explain product demand'],
            services: ['Which service performs best?', 'Explain service demand', 'Suggest schedule improvements'],
            promotions: ['Suggest a promotion', 'Compare promotion performance', 'Analyse Spin rewards'],
            spin: ['Analyse Spin performance', 'Which reward is most popular?', 'Which reward has poor redemption?'],
            reports: ['Show me that report again', 'Generate weekly report', 'Compare this month'],
            analytics: ['Explain revenue', 'Compare this month', 'What changed most?']
        }[topic] || ['Summarise this page', 'Explain the previous chart', 'What should I check next?'];
        return suggestions.slice(0, 3);
    };

    const appendSmartSuggestions = (sourceText = '') => {
        const suggestions = smartSuggestionsFor(sourceText);
        if (!suggestions.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'vaniday-ai-smart-suggestions';
        const label = document.createElement('strong');
        label.textContent = 'Next';
        wrap.appendChild(label);
        suggestions.forEach((suggestion) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = suggestion;
            button.addEventListener('click', () => submitChat(suggestion));
            wrap.appendChild(button);
        });
        appendMessage('assistant', 'A few useful next steps:', [wrap]);
    };

    const showExistingTimeline = () => {
        const timeline = document.querySelector('[data-ai-business-timeline], .ai-timeline-panel');
        if (!timeline) {
            return false;
        }
        timeline.scrollIntoView({ behavior: 'smooth', block: 'center' });
        timeline.classList.add('vaniday-ai-highlight');
        setTimeout(() => timeline.classList.remove('vaniday-ai-highlight'), 2600);
        return true;
    };

    const submitChat = async (rawPrompt) => {
        const text = String(rawPrompt || '').trim();
        if (!text || inProgress) return;
        appendMessage('user', text);
        rememberSessionEvent('prompt', { question: text });
        if (input) input.value = '';
        if (/^\s*(what('| i)?s|what is|tell me|show me)?\s*(today'?s?\s+date|date today|current date|time now|current time|what day is it)\??\s*$/i.test(text)) {
            const now = new Date();
            const dateLabel = new Intl.DateTimeFormat('en-SG', {
                timeZone: 'Asia/Singapore',
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }).format(now);
            const timeLabel = new Intl.DateTimeFormat('en-SG', {
                timeZone: 'Asia/Singapore',
                hour: 'numeric',
                minute: '2-digit'
            }).format(now);
            const answer = `Today is ${dateLabel}. The current time is ${timeLabel} in Singapore.`;
            appendMessage('assistant', answer, [], {
                progressive: true,
                sourcePrompt: text,
                transparency: {
                    periodLabel: 'Asia/Singapore',
                    sources: ['Browser date and time'],
                    confidence: 'High',
                    reasoning: 'Answered locally from the current browser session; no AI request or business data lookup was needed.'
                }
            });
            rememberSessionEvent('answer', { question: text, answer });
            setStatus('Date and time shown.', 'success');
            syncButtons();
            return;
        }
        if (/^(hi|hello|hey|yo|good morning|good afternoon|good evening)$/i.test(text)) {
            const greeting = `Hi. I can help with ${context.page.toLowerCase()} questions, explain a metric, or prepare a recommendation when you ask for one.`;
            appendMessage('assistant', greeting, [], { progressive: true, sourcePrompt: text });
            rememberSessionEvent('answer', { question: text, answer: greeting });
            setStatus('Ready.', 'success');
            syncButtons();
            return;
        }
        if (maybeHandleMemoryRecall(text)) {
            syncButtons();
            return;
        }
        const command = resolveCommand(text);
        const universalRoute = command ? null : resolveUniversalAiRoute(text);
        if (universalRoute?.local === 'presentation') {
            setPresentationMode(true);
            syncButtons();
            return;
        }
        if (universalRoute?.local === 'timeline') {
            const found = showExistingTimeline();
            appendMessage('assistant', found
                ? 'I opened the Business Timeline. Expand each event to see what happened, why it happened, business impact and recommendations.'
                : 'The Business Timeline appears on dashboard and analytics pages after the AI Executive Dashboard loads. Open Analytics or Dashboard first, then ask again.', [], {
                progressive: true,
                sourcePrompt: text,
                transparency: {
                    periodLabel: 'Current page',
                    sources: ['Business Timeline', 'Existing AI Executive Dashboard'],
                    confidence: found ? 'High' : 'Medium',
                    reasoning: 'Handled locally by opening the existing timeline component; no business data was modified.'
                }
            });
            syncButtons();
            return;
        }
        if (command?.intent === 'help') {
            appendMessage('assistant', command.prompt, [], { progressive: true, sourcePrompt: text });
            rememberSessionEvent('answer', { question: text, answer: command.prompt });
            setStatus('Command help shown.', 'success');
            syncButtons();
            return;
        }
        const prefersNavigation = /^(open|show|view|manage|find|search|go to|take me to)\b/i.test(text);
        const appAction = command || (universalRoute && !prefersNavigation) ? null : resolveAppAssistantAction(text);
        if (appAction?.handled) {
            const card = createNavigationCard({
                title: appAction.title,
                detail: appAction.detail,
                href: appAction.href,
                actionLabel: appAction.navigate ? 'Open page' : 'View',
                tone: appAction.tone
            });
            appendMessage('assistant', appAction.navigate ? `${appAction.title}...` : appAction.title, [card], {
                progressive: true,
                sourcePrompt: text,
                transparency: {
                    periodLabel: 'Current page',
                    sources: ['Existing routes', 'Current page controls'],
                    confidence: appAction.tone === 'warning' ? 'Medium' : 'High',
                    reasoning: 'Handled locally using existing navigation routes and page controls; no business data was modified.'
                }
            });
            rememberSessionEvent('opened', {
                title: appAction.title,
                detail: appAction.detail,
                href: appAction.href,
                question: text
            });
            setStatus(appAction.detail, appAction.tone === 'warning' ? 'error' : 'success');
            syncButtons();
            if (appAction.navigate && appAction.href) {
                persistChat();
                setTimeout(() => {
                    window.location.assign(appAction.href);
                }, 450);
            }
            return;
        }
        inProgress = true;
        setStatus('Working on your request...', 'loading');
        syncButtons();
        const effectivePrompt = command?.prompt || universalRoute?.prompt || text;
        const intent = command?.intent || universalRoute?.intent || classifyIntent(text);
        const thinkingOptions = loadingMessages[intent] || loadingMessages.question;
        const thinkingMessage = thinkingOptions[Math.floor(Math.random() * thinkingOptions.length)];
        const typing = appendTyping(thinkingMessage);
        try {
            const selectedPeriod = period?.value || 'last30';
            const contextualPrompt = createContextPrompt(effectivePrompt);
            let response;
            let payload;

            if (intent === 'insights') {
                const url = role === 'admin' ? '/api/ai/admin/platform-insights' : '/api/ai/merchant/business-insights';
                ({ response, payload } = await fetchAiJson(url, { period: selectedPeriod }));
                if (!response.ok && !payload.fallback) throw new Error(payload.message || 'AI insights could not be generated.');
                typing?.remove();
                renderInsightsToChat(payload, { sourcePrompt: text });
                rememberSessionEvent('answer', { question: text, answer: (payload.insights || payload.fallback || {}).executiveSummary || (payload.insights || payload.fallback || {}).summary || 'AI insights generated.' });
            } else if (intent === 'reminders') {
                ({ response, payload } = await fetchAiJson('/api/ai/merchant/smart-reminders', { period: selectedPeriod }));
                if (!response.ok || !payload.success) throw new Error(payload.message || 'Smart reminders could not be loaded.');
                typing?.remove();
                const rows = (payload.reminders || []).map((reminder) => ({ title: reminder.title, detail: reminder.message, meta: `${reminder.priority || 'medium'} priority` }));
                appendMessage('assistant', rows.length ? 'Here are the smart reminders for this page context.' : 'No smart reminders for this period.', rows.length ? [createDetailList(rows)] : [], {
                    progressive: true,
                    sourcePrompt: text,
                    transparency: {
                        periodLabel: selectedPeriodLabel(),
                        sources: ['Smart reminders', 'Merchant analytics'],
                        confidence: rows.length ? 'High' : 'Medium',
                        reasoning: 'Generated through the existing smart reminder endpoint for the selected period.'
                    }
                });
                rememberSessionEvent('answer', { question: text, answer: rows.length ? rows.map((row) => row.title).join('; ') : 'No smart reminders for this period.' });
            } else if (intent === 'proposal') {
                const url = role === 'admin' ? '/api/ai/admin/action-proposal' : '/api/ai/merchant/action-proposal';
                ({ response, payload } = await fetchAiJson(url, { period: selectedPeriod, prompt: contextualPrompt }));
                if (!response.ok || !payload.success) throw new Error(payload.message || 'Action proposal could not be prepared.');
                typing?.remove();
                appendMessage('assistant', role === 'admin' ? 'I prepared a recommendation-only admin review card.' : 'I prepared a safe proposal for review.', [createProposalCard(payload.proposal)], {
                    progressive: true,
                    sourcePrompt: text,
                    transparency: {
                        periodLabel: selectedPeriodLabel(),
                        sources: ['AI proposal service', 'Current analytics context'],
                        confidence: 'Medium',
                        reasoning: 'Prepared through the existing proposal system. Confirmation is still required before any business change.'
                    }
                });
                rememberSessionEvent('recommendation', { question: text, title: payload.proposal?.title || 'AI proposal', detail: payload.proposal?.reason || 'Safe proposal prepared.' });
            } else {
                const url = role === 'admin' ? '/api/ai/admin/ask-analytics' : '/api/ai/merchant/ask-analytics';
                ({ response, payload } = await fetchAiJson(url, {
                    period: selectedPeriod,
                    question: effectivePrompt,
                    clientContext: {
                        currentPage: context.page,
                        currentPath,
                        sessionSummary: sessionMemorySummary(),
                        recentConversation: getConversationMemory()
                    }
                }));
                if (!response.ok && !payload.fallback) throw new Error(payload.message || 'AI answer could not be generated.');
                typing?.remove();
                renderAnswerToChat(payload.answer || payload.fallback || {}, { sourcePrompt: text }, payload);
                rememberSessionEvent('answer', { question: text, answer: textFromAnswerPayload(payload) || 'AI answer generated.' });
                if (/\b(explain|chart|kpi|metric|why)\b/i.test(text)) {
                    rememberSessionEvent('explained', { question: text, title: text.slice(0, 80), detail: textFromAnswerPayload(payload) || 'Chart or metric explanation generated.' });
                }
            }
            if (intent !== 'question' || /\b(next|suggest|recommend|what should|action|priority)\b/i.test(text)) {
                appendSmartSuggestions(`${text} ${textFromAnswerPayload(payload || {})}`);
            }
            setStatus('AI response ready.', 'success');
        } catch (error) {
            typing?.remove();
            const friendlyMessage = friendlyErrorMessage(error);
            appendMessage('assistant', friendlyMessage, [], {
                kind: 'error',
                progressive: true,
                sourcePrompt: text,
                transparency: {
                    periodLabel: selectedPeriodLabel(),
                    sources: ['AI assistant request'],
                    confidence: 'Low',
                    reasoning: 'The assistant could not complete the request and returned recovery guidance instead.'
                }
            });
            setStatus(friendlyMessage, 'error');
        } finally {
            inProgress = false;
            syncButtons();
        }
    };

    const renderPrompts = () => {
        if (!promptWrap) return;
        while (promptWrap.firstChild) promptWrap.removeChild(promptWrap.firstChild);
        const addPromptButton = (prompt, parent = promptWrap) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.floatingAiPrompt = prompt;
            button.className = prompt.startsWith('/') ? 'is-command-chip' : 'is-suggestion-chip';
            button.setAttribute('aria-label', prompt.startsWith('/') ? `Run command ${prompt}` : `Ask: ${prompt}`);
            button.textContent = prompt;
            button.addEventListener('click', () => {
                button.closest('details')?.removeAttribute('open');
                submitChat(prompt);
            });
            parent.appendChild(button);
        };

        context.prompts.slice(0, 3).forEach((prompt) => addPromptButton(prompt));

        const morePrompts = [...context.prompts.slice(3), '/summary', '/performance', '/promotion', '/inventory', '/refunds', '/spin', '/help'];
        if (morePrompts.length) {
            const menu = document.createElement('details');
            menu.className = 'vaniday-ai-prompt-menu';
            const summary = document.createElement('summary');
            summary.textContent = 'More prompts';
            const list = document.createElement('div');
            list.className = 'vaniday-ai-prompt-menu-list';
            morePrompts.forEach((prompt) => addPromptButton(prompt, list));
            menu.append(summary, list);
            promptWrap.appendChild(menu);
        }
    };

    const restoreChat = () => {
        if (!history) return;
        const saved = getStoredConversation();
        if (Array.isArray(saved) && saved.length) {
            saved.forEach((row) => appendMessage(row.role, row.text, [], {
                timestamp: row.timestamp,
                timeLabel: row.timestamp ? new Date(row.timestamp).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' }) : undefined,
                page: row.page,
                path: row.path,
                skipPersist: true
            }));
            persistChat();
            return;
        }
        const welcome = document.createElement('div');
        welcome.className = 'vaniday-ai-empty-state';
        const title = document.createElement('strong');
        title.textContent = `${context.page} assistant`;
        const copy = document.createElement('span');
        copy.textContent = context.help;
        welcome.append(title, copy);
        appendMessage('assistant', getWelcomeMessage(), [welcome]);
    };

    if (heading) heading.textContent = role === 'admin' ? 'Admin Copilot' : 'Merchant Copilot';
    if (pageLabel) pageLabel.textContent = context.page;
    if (pageTitle) pageTitle.textContent = `${context.page} support`;
    if (pageHelp) pageHelp.textContent = context.help;
    if (input) input.placeholder = `Ask AI about ${context.page.toLowerCase()}`;

    renderPrompts();
    restoreChat();
    renderMemoryPanel();
    syncPeriodLabel();
    setOpen(sessionStorage.getItem(openStorageKey) === 'open');
    syncButtons();

    toggle?.addEventListener('click', () => setOpen(!root.classList.contains('is-open')));
    closeButton?.addEventListener('click', () => setOpen(false));
    presentationToggle?.addEventListener('click', () => setPresentationMode(!presentationState.active));
    document.querySelectorAll('[data-ai-presentation-start]').forEach((button) => {
        button.addEventListener('click', () => setPresentationMode(true));
    });
    memoryToggle?.addEventListener('click', () => {
        const isHidden = memoryPanel?.hasAttribute('hidden');
        if (!memoryPanel) return;
        if (isHidden) {
            memoryPanel.removeAttribute('hidden');
            memoryToggle.setAttribute('aria-expanded', 'true');
            renderMemoryPanel();
        } else {
            memoryPanel.setAttribute('hidden', '');
            memoryToggle.setAttribute('aria-expanded', 'false');
        }
    });
    clearMemoryButton?.addEventListener('click', () => clearSessionConversation('Conversation memory cleared for this browser session.'));
    newConversationButton?.addEventListener('click', () => clearSessionConversation('Started a new conversation for this session.'));
    memorySearch?.addEventListener('input', () => searchConversation(memorySearch.value));
    exportButtons.forEach((button) => {
        button.addEventListener('click', () => exportConversation(button.dataset.floatingAiExport || 'text'));
    });
    period?.addEventListener('change', syncPeriodLabel);
    input?.addEventListener('input', syncButtons);
    input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitChat(input.value);
        } else if (event.key === 'ArrowUp' && !input.value.trim()) {
            const lastPrompt = getStoredConversation().filter((row) => row.role === 'user').pop();
            if (lastPrompt?.text) {
                event.preventDefault();
                input.value = lastPrompt.text;
                syncButtons();
            }
        }
    });
    sendButton?.addEventListener('click', () => submitChat(input?.value));
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === '/') {
            event.preventDefault();
            setOpen(true);
        } else if (event.key === 'Escape' && root.classList.contains('is-open')) {
            setOpen(false);
        }
    });
    window.addEventListener('vaniday:ai-daily-brief', (event) => {
        const text = String(event.detail?.text || '').trim();
        const briefKey = `${storagePrefix}:daily-brief:${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })}`;
        if (!text || sessionStorage.getItem(briefKey)) return;
        appendMessage('assistant', text);
        rememberSessionEvent('report', { title: 'Daily Business Brief', detail: text });
        sessionStorage.setItem(briefKey, 'shown');
    });

    window.addEventListener('vaniday:ai-operations-alerts', (event) => {
        const text = String(event.detail?.text || '').trim();
        const alertKey = `${storagePrefix}:operations-alerts:${currentPath}:${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })}`;
        if (!text || sessionStorage.getItem(alertKey)) return;
        appendMessage('assistant', text);
        rememberSessionEvent('recommendation', { title: 'Operations intelligence alert', detail: text });
        sessionStorage.setItem(alertKey, 'shown');
    });

    window.addEventListener('vaniday:ai-followup-question', (event) => {
        const question = String(event.detail?.question || '').trim();
        if (!question) return;
        setOpen(true);
        submitChat(question);
    });

    if (sessionStorage.getItem(presentationStorageKey) === 'on') {
        presentationState.active = true;
        root.classList.add('is-presentation-mode');
        document.body.classList.add('vaniday-ai-presentation-active');
        syncButtons();
    }
})();
