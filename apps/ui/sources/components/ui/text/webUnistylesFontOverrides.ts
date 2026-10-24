export const HAPPIER_UI_FONT_SCALE_CSS_VAR = '--happier-ui-font-scale';
export const HAPPIER_UI_FONT_OVERRIDE_STYLE_ELEMENT_ID = 'happier-ui-font-scale-overrides';

export type UnistylesFontMetric = Readonly<{
    fontSize?: string;
    lineHeight?: string;
    letterSpacing?: string;
}>;

function isCssStyleRule(rule: CSSRule): rule is CSSStyleRule {
    return (rule as any)?.type === 1;
}

function isCssGroupingRule(rule: CSSRule): rule is CSSGroupingRule {
    const type = (rule as any)?.type;
    // CSSMediaRule (4), CSSSupportsRule (12), etc.
    return typeof (rule as any)?.cssRules !== 'undefined' && type !== 1;
}

function extractUnistylesClassNames(selectorText: string): string[] {
    // `.unistyles_xxx` style rules are emitted by Unistyles on web.
    // A selector may contain multiple classes and/or be a comma-separated group.
    const matches = selectorText.match(/\.unistyles_[A-Za-z0-9_-]+/g) ?? [];
    const out: string[] = [];
    for (const m of matches) {
        const cls = m.startsWith('.') ? m.slice(1) : m;
        if (cls && !out.includes(cls)) out.push(cls);
    }
    return out;
}

function isPx(value: string): boolean {
    return typeof value === 'string' && /^\s*-?\d+(\.\d+)?px\s*$/.test(value);
}

function isUnitlessNumber(value: string): boolean {
    return typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value);
}

function normalizeCssNumber(value: string): string | null {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return null;
    if (isPx(trimmed)) return trimmed.replace(/\s+/g, '');
    if (isUnitlessNumber(trimmed)) return trimmed;
    return null;
}

function pickMetricFromRule(rule: CSSStyleRule): UnistylesFontMetric | null {
    const fontSize = normalizeCssNumber(rule.style.fontSize || rule.style.getPropertyValue('font-size'));
    const lineHeight = normalizeCssNumber(rule.style.lineHeight || rule.style.getPropertyValue('line-height'));
    const letterSpacing = normalizeCssNumber(rule.style.letterSpacing || rule.style.getPropertyValue('letter-spacing'));

    if (!fontSize && !lineHeight && !letterSpacing) return null;
    return {
        ...(fontSize ? { fontSize } : null),
        ...(lineHeight ? { lineHeight } : null),
        ...(letterSpacing ? { letterSpacing } : null),
    };
}

export function scanDocumentForUnistylesFontMetrics(
    document: Document,
    cache: Map<string, UnistylesFontMetric>,
): number {
    let added = 0;
    if (!(document as any)?.styleSheets) return 0;

    const walkRules = (rules: CSSRuleList) => {
        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i] as CSSRule;
            if (isCssStyleRule(rule)) {
                const selectorText = rule.selectorText ?? '';
                if (!selectorText.includes('unistyles_')) continue;
                const metric = pickMetricFromRule(rule);
                if (!metric) continue;
                const classNames = extractUnistylesClassNames(selectorText);
                for (const cls of classNames) {
                    if (cache.has(cls)) continue;
                    cache.set(cls, metric);
                    added += 1;
                }
                continue;
            }
            if (isCssGroupingRule(rule)) {
                walkRules((rule as any).cssRules as CSSRuleList);
            }
        }
    };

    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList | null = null;
        try {
            rules = sheet.cssRules;
        } catch {
            // Some stylesheets can be cross-origin or otherwise inaccessible.
            rules = null;
        }
        if (!rules) continue;
        walkRules(rules);
    }

    return added;
}

export function ensureOverrideStyleElement(document: Document): HTMLStyleElement {
    const existing = document.getElementById(HAPPIER_UI_FONT_OVERRIDE_STYLE_ELEMENT_ID);
    if (existing && existing.tagName.toLowerCase() === 'style') {
        return existing as HTMLStyleElement;
    }

    const style = document.createElement('style');
    style.id = HAPPIER_UI_FONT_OVERRIDE_STYLE_ELEMENT_ID;
    style.setAttribute?.('data-happier', 'ui-font-scale-overrides');
    document.head.appendChild(style);
    return style;
}

function isFontMetricStyleSourceNode(node: Node | null | undefined): boolean {
    if (!node || node.nodeType !== 1) return false;
    const element = node as Element;
    if (element.id === HAPPIER_UI_FONT_OVERRIDE_STYLE_ELEMENT_ID) return false;
    const tagName = element.tagName.toLowerCase();
    return tagName === 'style' || tagName === 'link';
}

function mutationHasFontMetricStyleSource(mutation: MutationRecord): boolean {
    if (mutation.type !== 'childList') return false;
    for (const node of Array.from(mutation.addedNodes ?? [])) {
        if (isFontMetricStyleSourceNode(node)) return true;
    }
    for (const node of Array.from(mutation.removedNodes ?? [])) {
        if (isFontMetricStyleSourceNode(node)) return true;
    }
    return false;
}

function readRootInlineFontSize(document: Document): string {
    return String(document.documentElement?.style?.fontSize ?? '').trim();
}

export function observeWebUnistylesFontMetricSources(
    document: Document,
    onChange: () => void,
): () => void {
    if (typeof MutationObserver !== 'function') return () => {};
    const observers: MutationObserver[] = [];
    const styleTextObservers = new Map<HTMLStyleElement, MutationObserver>();

    const observeStyleTextSources = () => {
        const sources = new Set(Array.from(document.head.querySelectorAll('style'))
            .filter(isFontMetricStyleSourceNode));
        for (const [source, observer] of styleTextObservers) {
            if (sources.has(source)) continue;
            observer.disconnect();
            styleTextObservers.delete(source);
        }
        for (const source of sources) {
            if (styleTextObservers.has(source)) continue;
            // Unistyles replaces innerText on its existing style element when lazy
            // components register classes. Observe only stylesheet text, never app DOM.
            const observer = new MutationObserver(onChange);
            observer.observe(source, { childList: true, characterData: true, subtree: true });
            styleTextObservers.set(source, observer);
        }
    };

    if (document.head) {
        observeStyleTextSources();
        const headObserver = new MutationObserver((mutations) => {
            if (!mutations.some(mutationHasFontMetricStyleSource)) return;
            observeStyleTextSources();
            onChange();
        });
        headObserver.observe(document.head, { childList: true });
        observers.push(headObserver);
    }

    if (document.documentElement) {
        let lastRootFontSize = readRootInlineFontSize(document);
        const rootObserver = new MutationObserver((mutations) => {
            const hasRootStyleMutation = mutations.some((mutation) => (
                mutation.type === 'attributes'
                && mutation.target === document.documentElement
                && mutation.attributeName === 'style'
            ));
            if (!hasRootStyleMutation) return;
            const nextRootFontSize = readRootInlineFontSize(document);
            if (nextRootFontSize === lastRootFontSize) return;
            lastRootFontSize = nextRootFontSize;
            onChange();
        });
        rootObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['style'],
        });
        observers.push(rootObserver);
    }

    return () => {
        for (const observer of observers) {
            observer.disconnect();
        }
        for (const observer of styleTextObservers.values()) {
            observer.disconnect();
        }
        styleTextObservers.clear();
    };
}

function getInjectedSet(styleEl: HTMLStyleElement): Set<string> {
    const anyEl = styleEl as any;
    if (!anyEl.__happierInjectedUnistylesFontClasses) {
        anyEl.__happierInjectedUnistylesFontClasses = new Set<string>();
    }
    return anyEl.__happierInjectedUnistylesFontClasses as Set<string>;
}

function buildOverrideRule(className: string, metric: UnistylesFontMetric): string {
    const parts: string[] = [];
    if (metric.fontSize) {
        parts.push(`font-size: calc(${metric.fontSize} * var(${HAPPIER_UI_FONT_SCALE_CSS_VAR})) !important;`);
    }
    if (metric.lineHeight) {
        parts.push(`line-height: calc(${metric.lineHeight} * var(${HAPPIER_UI_FONT_SCALE_CSS_VAR})) !important;`);
    }
    if (metric.letterSpacing) {
        parts.push(`letter-spacing: calc(${metric.letterSpacing} * var(${HAPPIER_UI_FONT_SCALE_CSS_VAR})) !important;`);
    }
    if (parts.length === 0) return '';
    return `.${className} { ${parts.join(' ')} }\n`;
}

export function syncOverrideStyleElement(
    styleEl: HTMLStyleElement,
    cache: Map<string, UnistylesFontMetric>,
): number {
    const injected = getInjectedSet(styleEl);
    let appended = 0;
    let next = styleEl.textContent ?? '';

    for (const [className, metric] of cache.entries()) {
        if (injected.has(className)) continue;
        const rule = buildOverrideRule(className, metric);
        if (!rule) continue;
        injected.add(className);
        next += rule;
        appended += 1;
    }

    if (appended > 0) {
        styleEl.textContent = next;
    }

    return appended;
}

export function setRootCssVar(document: Document, scale: number): void {
    const root = (document as any)?.documentElement;
    if (!root?.style?.setProperty) return;
    const value =
        typeof scale === 'number' && Number.isFinite(scale)
            ? String(scale)
            : '1';
    root.style.setProperty(HAPPIER_UI_FONT_SCALE_CSS_VAR, value);
}
