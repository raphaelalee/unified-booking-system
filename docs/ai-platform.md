# Vaniday AI Platform

## Purpose

The AI platform is a unified frontend experience for merchant and admin decision support. It brings together the floating assistant, executive dashboard, AI chart explanations, reports, operations intelligence, Spin intelligence, navigation commands, session memory and proposal cards without changing the underlying business workflows.

## Architecture

- `routes/aiRoutes.js` protects all AI HTTP endpoints with the existing role and approved-merchant checks.
- `controllers/aiController.js` validates requests, builds analytics context and delegates model calls.
- `services/analyticsAiDataService.js` builds merchant/admin analytics summaries from existing SQL and dashboard rules.
- `services/groqService.js` keeps the Groq integration.
- `services/aiActionProposalService.js` normalises proposals and keeps confirmation controlled.
- `public/js/ai-ui-components.js` provides shared AI UI primitives.
- `public/js/floating-ai-assistant.js` owns the floating chat, session memory, navigation commands, response actions and conversation export.
- `public/js/ai-executive-dashboard.js` owns executive summaries, health score, widget explanations, operations intelligence and report generation.

## Shared Frontend Components

`window.VanidayAIUI` exposes:

- `confidenceBadge(confidence)`: standard High, Medium and Low confidence display.
- `statusBadge(label, tone)`: standard status badge using the AI colour vocabulary.
- `reasoningPanel(options)`: shared collapsed reasoning panel with data sources, metrics, time period, confidence and reason.
- `loadingState(message, tone)`: shared loading state.
- `emptyState(title, detail)`: shared empty state.
- `sectionList(sections)`: standard response sections.
- `actionButton(label, handler, options)`: standard AI action button.

Use these helpers before adding one-off AI UI controls.

## Response Lifecycle

1. The user asks a question, clicks a suggestion or uses a smart command.
2. The assistant resolves safe local actions first, such as navigation, filtering, search or export.
3. If AI is needed, the request is sent through the existing AI endpoint for the current role.
4. The response is rendered progressively in the chat.
5. Each assistant response receives:
   - response actions,
   - a collapsed reasoning panel,
   - confidence,
   - data sources,
   - selected time period.
6. The response is recorded in browser session memory only.

## Standard Response Format

AI output should use these sections where relevant:

- Summary
- Key Findings
- Insights
- Recommendations
- Potential Risks
- Confidence
- Data Sources
- Time Period
- Suggested Next Actions

Do not show empty sections.

## Data Flow

The AI layer reuses existing dashboard and analytics data. It must not duplicate SQL or invent business totals. Merchant scope is derived from the authenticated session through the existing backend services. Admin scope remains protected by existing admin route guards.

## Recommendation Generation

Recommendations that may change business data must go through the proposal system:

- Generate proposal through the existing action-proposal endpoint.
- Display a proposal card.
- Require the existing confirmation endpoint.
- Never apply promotion, price, schedule, inventory, merchant or refund changes directly from chat.

## Reasoning Panel

Every AI response or card should expose a collapsed reasoning panel. It should show:

- Data Sources
- Metrics Used
- Time Period
- Why Generated
- Confidence

Reasoning is for transparency, not hidden chain-of-thought. Keep it concise and business-readable.

## Colour Vocabulary

- Green: positive or healthy signal.
- Blue: information.
- Orange: recommendation or watch item.
- Red: warning or risk.
- Grey: historical or neutral context.

## Future Extension Guidelines

- Add frontend AI UI through `VanidayAIUI` where possible.
- Reuse existing analytics endpoints and proposal endpoints.
- Keep memory in browser session storage only.
- Keep reasoning panels collapsed by default.
- Avoid new dashboards unless a business page already exists for that purpose.
- Keep AI wording professional, concise and decision-focused.
- Preserve merchant ownership, admin permissions, CSRF and proposal confirmation.

## Presentation Mode

Presentation Mode is a frontend-only layer inside the shared floating assistant. Merchant and Admin dashboards expose a `Presentation Mode` button, and the assistant header exposes a `Present`/`Normal AI` toggle. The walkthrough reads visible page content, highlights the matching dashboard section, and appends short presenter-style explanations to the existing chat.

Presentation Mode must not call write endpoints, change business data, bypass proposal confirmation, or replace normal AI chat. New walkthrough steps should be added to `buildPresentationSteps` in `public/js/floating-ai-assistant.js` and should target existing dashboard selectors before falling back to generic page text.
