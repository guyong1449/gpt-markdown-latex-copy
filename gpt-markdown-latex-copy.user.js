// ==UserScript==
// @name         GPT Markdown LaTeX Copy
// @namespace    https://github.com/guyong1449/gpt-markdown-latex-copy
// @version      0.5.3
// @description  将 ChatGPT 回答复制为 Markdown，并保留 LaTeX、代码块真实换行，同时排除语言标签与复制按钮 UI
// @homepageURL  https://github.com/guyong1449/gpt-markdown-latex-copy
// @supportURL   https://github.com/guyong1449/gpt-markdown-latex-copy/issues
// @updateURL    https://raw.githubusercontent.com/guyong1449/gpt-markdown-latex-copy/main/gpt-markdown-latex-copy.user.js
// @downloadURL  https://raw.githubusercontent.com/guyong1449/gpt-markdown-latex-copy/main/gpt-markdown-latex-copy.user.js
// @match        https://chatgpt.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_WRAPPER_CLASS = 'copyformd-wrapper';
    const BUTTON_CLASS = 'copyformd-button';
    const TURN_PROCESSED_ATTR = 'data-copyformd-turn-ready';

    const TEMP_MATH_ATTR = 'data-copyformd-temp-math-id';
    const TEMP_CODE_ATTR = 'data-copyformd-temp-code-id';

    let mathIdCounter = 0;
    let codeIdCounter = 0;

    const COPY_UI_SELECTOR = [
        'button',
        '[data-testid^="copy-code-block"]',
        '[data-testid^="copy-turn-action-button"]',
        '[data-qa="copy-code"]'
    ].join(',');

    const LANGUAGE_MAP = new Map([
        ['python', 'python'],
        ['py', 'python'],

        ['javascript', 'javascript'],
        ['js', 'javascript'],

        ['typescript', 'typescript'],
        ['ts', 'typescript'],

        ['java', 'java'],

        ['c', 'c'],

        ['c++', 'cpp'],
        ['cpp', 'cpp'],

        ['c#', 'csharp'],
        ['csharp', 'csharp'],

        ['go', 'go'],
        ['rust', 'rust'],

        ['bash', 'bash'],
        ['shell', 'bash'],
        ['sh', 'bash'],

        ['powershell', 'powershell'],

        ['sql', 'sql'],

        ['html', 'html'],
        ['css', 'css'],

        ['json', 'json'],

        ['yaml', 'yaml'],
        ['yml', 'yaml'],

        ['xml', 'xml'],

        ['markdown', 'markdown'],
        ['md', 'markdown'],

        ['latex', 'latex'],
        ['tex', 'latex'],

        ['text', 'text'],
        ['plaintext', 'text']
    ]);


    /*
     * ============================================================
     * Clipboard
     * ============================================================
     */

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;

        } catch (error) {
            console.warn(
                '[copyformd] Clipboard API 失败，尝试备用方式：',
                error
            );

            const textarea =
                document.createElement('textarea');

            textarea.value = text;

            textarea.style.position = 'fixed';
            textarea.style.left = '-99999px';
            textarea.style.top = '-99999px';
            textarea.style.opacity = '0';

            document.body.appendChild(textarea);

            textarea.focus();
            textarea.select();

            let ok = false;

            try {
                ok =
                    document.execCommand('copy');

            } catch (fallbackError) {
                console.error(
                    '[copyformd] execCommand(copy) 失败：',
                    fallbackError
                );
            }

            textarea.remove();

            return ok;
        }
    }


    /*
     * ============================================================
     * Assistant Turn
     * ============================================================
     */

    function findAssistantTurns() {
        const turns = new Set();

        document
            .querySelectorAll(
                '[data-message-author-role="assistant"]'
            )
            .forEach(node => {
                turns.add(
                    node.closest('article') ||
                    node
                );
            });

        if (turns.size === 0) {
            document
                .querySelectorAll(
                    'article[data-turn="assistant"], [data-turn="assistant"]'
                )
                .forEach(
                    node =>
                        turns.add(node)
                );
        }

        return [...turns];
    }


    function contentScore(node) {
        if (!node) {
            return -1;
        }

        const textLength = (
            node.innerText ||
            node.textContent ||
            ''
        )
            .trim()
            .length;

        const mathCount =
            node.querySelectorAll
                ? node.querySelectorAll(
                    [
                        'annotation',
                        'math',
                        '.katex',
                        '.katex-display',
                        'mjx-container',
                        '[data-latex]',
                        '[data-tex]',
                        '[role="math"]'
                    ].join(',')
                ).length
                : 0;

        return (
            textLength +
            mathCount * 200
        );
    }


    function getBestContentRoot(turn) {
        if (!turn) {
            return null;
        }

        const selectorTiers = [
            '.markdown',
            '[class*="prose"]',
            '[data-message-author-role="assistant"]'
        ];

        for (
            const selector of selectorTiers
        ) {
            const candidates =
                new Set();

            if (
                turn.matches &&
                turn.matches(selector)
            ) {
                candidates.add(turn);
            }

            if (
                turn.querySelectorAll
            ) {
                turn
                    .querySelectorAll(
                        selector
                    )
                    .forEach(
                        node =>
                            candidates.add(
                                node
                            )
                    );
            }

            let best = null;
            let bestScore = 0;

            for (
                const candidate of candidates
            ) {
                const score =
                    contentScore(
                        candidate
                    );

                if (
                    score > bestScore
                ) {
                    best =
                        candidate;

                    bestScore =
                        score;
                }
            }

            if (
                best &&
                bestScore > 0
            ) {
                return best;
            }
        }

        return turn;
    }


    /*
     * ============================================================
     * Math
     * ============================================================
     */

    function getElement(node) {
        if (!node) {
            return null;
        }

        return (
            node.nodeType ===
                Node.ELEMENT_NODE
                ? node
                : node.parentElement
        );
    }


    function extractLatexFromMathNode(
        node
    ) {
        const element =
            getElement(node);

        if (!element) {
            return null;
        }

        if (
            element.matches &&
            element.matches(
                'annotation'
            )
        ) {
            const encoding = (
                element.getAttribute(
                    'encoding'
                ) ||
                ''
            ).toLowerCase();

            if (
                encoding.includes(
                    'tex'
                ) ||
                encoding.includes(
                    'latex'
                )
            ) {
                const value =
                    element.textContent
                        .trim();

                if (value) {
                    return value;
                }
            }
        }


        if (
            element.querySelectorAll
        ) {
            for (
                const annotation of
                element.querySelectorAll(
                    'annotation'
                )
            ) {
                const encoding = (
                    annotation.getAttribute(
                        'encoding'
                    ) ||
                    ''
                ).toLowerCase();

                if (
                    encoding.includes(
                        'tex'
                    ) ||
                    encoding.includes(
                        'latex'
                    )
                ) {
                    const value =
                        annotation
                            .textContent
                            .trim();

                    if (value) {
                        return value;
                    }
                }
            }
        }


        const attrs = [
            'data-latex',
            'data-tex',
            'data-math',
            'data-formula',
            'alttext'
        ];

        let current =
            element;

        for (
            let depth = 0;
            current &&
            depth < 8;
            depth++,
            current =
                current.parentElement
        ) {
            for (
                const attr of attrs
            ) {
                const value =
                    current.getAttribute &&
                    current.getAttribute(
                        attr
                    );

                if (
                    value &&
                    value.trim()
                ) {
                    return value.trim();
                }
            }
        }


        current =
            element;

        for (
            let depth = 0;
            current &&
            depth < 6;
            depth++,
            current =
                current.parentElement
        ) {
            const aria =
                current.getAttribute &&
                current.getAttribute(
                    'aria-label'
                );

            if (aria) {
                const value =
                    aria.trim();

                if (
                    value.includes('\\') ||
                    /[_^{}]/.test(value)
                ) {
                    return value;
                }
            }
        }

        return null;
    }


    function findMathWrapper(
        node
    ) {
        const element =
            getElement(node);

        if (!element) {
            return null;
        }


        const katexDisplay =
            element.closest &&
            element.closest(
                '.katex-display'
            );

        if (katexDisplay) {
            return katexDisplay;
        }


        const katex =
            element.closest &&
            element.closest(
                '.katex'
            );

        if (katex) {
            return katex;
        }


        const mjx =
            element.closest &&
            element.closest(
                'mjx-container'
            );

        if (mjx) {
            return mjx;
        }


        const custom =
            element.closest &&
            element.closest(
                [
                    '[data-latex]',
                    '[data-tex]',
                    '[data-math]',
                    '[data-formula]',
                    '[role="math"]',
                    '.math-display',
                    '.math-block',
                    '.display-math',
                    '.math-inline',
                    '.inline-math'
                ].join(',')
            );

        if (custom) {
            return custom;
        }


        const math =
            element.closest &&
            element.closest('math');

        if (math) {
            return math;
        }

        return element;
    }


    function hasMeaningfulContent(
        node
    ) {
        if (!node) {
            return false;
        }

        if (
            node.nodeType ===
            Node.TEXT_NODE
        ) {
            return (
                node.textContent
                    .trim() !== ''
            );
        }

        if (
            node.nodeType !==
            Node.ELEMENT_NODE
        ) {
            return false;
        }

        const tag =
            node.tagName
                .toLowerCase();

        if (
            tag === 'br' ||
            tag === 'wbr'
        ) {
            return false;
        }

        if (
            node.getAttribute &&
            node.getAttribute(
                'aria-hidden'
            ) === 'true'
        ) {
            return false;
        }

        return (
            node.textContent ||
            ''
        ).trim() !== '';
    }


    function isOnlyMeaningfulChild(
        parent,
        child
    ) {
        if (
            !parent ||
            !child
        ) {
            return false;
        }

        for (
            const sibling of
            parent.childNodes
        ) {
            if (
                sibling === child
            ) {
                continue;
            }

            if (
                hasMeaningfulContent(
                    sibling
                )
            ) {
                return false;
            }
        }

        return true;
    }


    function paragraphHasOtherContent(
        wrapper
    ) {
        const paragraph =
            wrapper.closest &&
            wrapper.closest('p');

        if (!paragraph) {
            return false;
        }

        if (
            isOnlyMeaningfulChild(
                paragraph,
                wrapper
            )
        ) {
            return false;
        }

        let current =
            wrapper;

        for (
            let depth = 0;
            current &&
            current.parentElement &&
            depth < 5;
            depth++
        ) {
            const parent =
                current.parentElement;

            if (
                parent === paragraph
            ) {
                return (
                    !isOnlyMeaningfulChild(
                        paragraph,
                        current
                    )
                );
            }

            if (
                parent.tagName
                    .toLowerCase() !==
                'span'
            ) {
                break;
            }

            if (
                !isOnlyMeaningfulChild(
                    parent,
                    current
                )
            ) {
                return true;
            }

            current =
                parent;
        }

        return true;
    }


    function hasExplicitDisplayMath(
        wrapper
    ) {
        if (!wrapper) {
            return false;
        }


        if (
            (
                wrapper.matches &&
                wrapper.matches(
                    '.katex-display'
                )
            ) ||
            (
                wrapper.closest &&
                wrapper.closest(
                    '.katex-display'
                )
            )
        ) {
            return true;
        }


        if (
            (
                wrapper.matches &&
                wrapper.matches(
                    'mjx-container[display="true"]'
                )
            ) ||
            (
                wrapper.closest &&
                wrapper.closest(
                    'mjx-container[display="true"]'
                )
            )
        ) {
            return true;
        }


        const math =
            wrapper.matches &&
            wrapper.matches('math')
                ? wrapper
                : (
                    wrapper.querySelector
                        ? wrapper.querySelector(
                            'math'
                        )
                        : null
                );

        if (
            math &&
            math.getAttribute(
                'display'
            ) === 'block'
        ) {
            return true;
        }


        const displaySelector =
            [
                '.math-display',
                '.math-block',
                '.display-math',
                '[data-math-display="true"]'
            ].join(',');


        if (
            (
                wrapper.matches &&
                wrapper.matches(
                    displaySelector
                )
            ) ||
            (
                wrapper.closest &&
                wrapper.closest(
                    displaySelector
                )
            )
        ) {
            return true;
        }

        return false;
    }


    function hasBlockLikeCSS(
        wrapper
    ) {
        if (
            !wrapper ||
            !wrapper.isConnected
        ) {
            return false;
        }

        const style =
            window.getComputedStyle(
                wrapper
            );

        if (
            [
                'block',
                'flex',
                'grid',
                'table'
            ].includes(
                style.display
            )
        ) {
            return true;
        }


        let parent =
            wrapper.parentElement;

        for (
            let depth = 0;
            parent &&
            depth < 3;
            depth++,
            parent =
                parent.parentElement
        ) {
            const parentStyle =
                window.getComputedStyle(
                    parent
                );

            if (
                parentStyle.textAlign ===
                    'center' &&
                isOnlyMeaningfulChild(
                    parent,
                    wrapper
                )
            ) {
                return true;
            }
        }

        return false;
    }


    function looksCenteredOnPage(
        wrapper,
        contentRoot
    ) {
        if (
            !wrapper ||
            !contentRoot ||
            !wrapper.isConnected ||
            !contentRoot.isConnected
        ) {
            return false;
        }

        const formulaRect =
            wrapper
                .getBoundingClientRect();

        const contentRect =
            contentRoot
                .getBoundingClientRect();

        if (
            formulaRect.width <= 0 ||
            formulaRect.height <= 0 ||
            contentRect.width <= 0
        ) {
            return false;
        }

        const formulaCenter =
            formulaRect.left +
            formulaRect.width / 2;

        const contentCenter =
            contentRect.left +
            contentRect.width / 2;

        const difference =
            Math.abs(
                formulaCenter -
                contentCenter
            );

        const centered =
            difference <
            contentRect.width * 0.08;

        if (!centered) {
            return false;
        }

        if (
            paragraphHasOtherContent(
                wrapper
            )
        ) {
            return false;
        }

        return true;
    }


    function detectDisplayMath(
        wrapper,
        contentRoot
    ) {
        if (
            hasExplicitDisplayMath(
                wrapper
            )
        ) {
            return true;
        }

        if (
            paragraphHasOtherContent(
                wrapper
            )
        ) {
            return false;
        }

        if (
            hasBlockLikeCSS(
                wrapper
            )
        ) {
            return true;
        }

        if (
            looksCenteredOnPage(
                wrapper,
                contentRoot
            )
        ) {
            return true;
        }


        let current =
            wrapper;

        for (
            let depth = 0;
            current &&
            current.parentElement &&
            depth < 4;
            depth++
        ) {
            const parent =
                current.parentElement;

            const tag =
                parent.tagName
                    .toLowerCase();

            if (
                [
                    'p',
                    'div',
                    'figure'
                ].includes(tag)
            ) {
                if (
                    isOnlyMeaningfulChild(
                        parent,
                        current
                    )
                ) {
                    return true;
                }

                return false;
            }

            if (
                tag !== 'span'
            ) {
                break;
            }

            if (
                !isOnlyMeaningfulChild(
                    parent,
                    current
                )
            ) {
                return false;
            }

            current =
                parent;
        }

        return false;
    }


    function prepareMathMetadata(
        contentRoot
    ) {
        const metadata =
            new Map();

        const wrapperSet =
            new Set();


        const annotations = [
            ...contentRoot
                .querySelectorAll(
                    'annotation'
                )
        ];


        for (
            const annotation of annotations
        ) {
            const encoding = (
                annotation.getAttribute(
                    'encoding'
                ) ||
                ''
            ).toLowerCase();

            if (
                !encoding.includes(
                    'tex'
                ) &&
                !encoding.includes(
                    'latex'
                )
            ) {
                continue;
            }


            const latex =
                annotation
                    .textContent
                    .trim();

            if (!latex) {
                continue;
            }


            const wrapper =
                findMathWrapper(
                    annotation
                );

            if (
                !wrapper ||
                wrapperSet.has(
                    wrapper
                )
            ) {
                continue;
            }


            wrapperSet.add(
                wrapper
            );

            const id =
                'copyformd-math-' +
                (++mathIdCounter);

            const display =
                detectDisplayMath(
                    wrapper,
                    contentRoot
                );

            wrapper.setAttribute(
                TEMP_MATH_ATTR,
                id
            );

            metadata.set(
                id,
                {
                    latex,
                    display
                }
            );
        }


        const candidates = [
            ...contentRoot
                .querySelectorAll(
                    [
                        '.katex',
                        '.katex-display',
                        'mjx-container',
                        'math',
                        '[data-latex]',
                        '[data-tex]',
                        '[data-math]',
                        '[data-formula]',
                        '[role="math"]',
                        '.math-display',
                        '.math-block',
                        '.display-math',
                        '.math-inline',
                        '.inline-math'
                    ].join(',')
                )
        ];


        for (
            const candidate of candidates
        ) {
            const wrapper =
                findMathWrapper(
                    candidate
                );

            if (
                !wrapper ||
                wrapperSet.has(
                    wrapper
                )
            ) {
                continue;
            }


            const latex =
                extractLatexFromMathNode(
                    candidate
                );

            if (!latex) {
                continue;
            }


            wrapperSet.add(
                wrapper
            );

            const id =
                'copyformd-math-' +
                (++mathIdCounter);

            const display =
                detectDisplayMath(
                    wrapper,
                    contentRoot
                );

            wrapper.setAttribute(
                TEMP_MATH_ATTR,
                id
            );

            metadata.set(
                id,
                {
                    latex,
                    display
                }
            );
        }


        return {
            metadata,
            markedWrappers: [
                ...wrapperSet
            ]
        };
    }


    function replacePreparedMath(
        clone,
        metadata
    ) {
        let inlineCount = 0;
        let displayCount = 0;

        const nodes = [
            ...clone.querySelectorAll(
                '[' +
                TEMP_MATH_ATTR +
                ']'
            )
        ];


        for (
            const node of nodes
        ) {
            const id =
                node.getAttribute(
                    TEMP_MATH_ATTR
                );

            const info =
                metadata.get(id);

            if (!info) {
                continue;
            }


            const latex =
                info.latex.trim();

            const markdown =
                info.display
                    ? (
                        '\n\n$$\n' +
                        latex +
                        '\n$$\n\n'
                    )
                    : (
                        '$' +
                        latex +
                        '$'
                    );


            if (
                info.display
            ) {
                displayCount++;
            } else {
                inlineCount++;
            }


            node.replaceWith(
                document.createTextNode(
                    markdown
                )
            );
        }


        console.log(
            '[copyformd] 数学公式：独立 ' +
            displayCount +
            ' 个；行内 ' +
            inlineCount +
            ' 个。'
        );
    }


    /*
     * ============================================================
     * Normal Text
     * ============================================================
     */

    function normalizeText(text) {
        return (text || '')
            .replace(
                /\u00a0/g,
                ' '
            )
            .replace(
                /\u200b/g,
                ''
            )
            .replace(
                /[ \t]+\n/g,
                '\n'
            );
    }


    /*
     * ============================================================
     * Code Blocks
     * ============================================================
     */

    function normalizeCodeText(
        text
    ) {
        return (text || '')
            .replace(
                /\r\n?/g,
                '\n'
            )
            .replace(
                /\u00a0/g,
                ' '
            )
            .replace(
                /\u200b/g,
                ''
            );
    }


    function countNewlines(
        text
    ) {
        return (
            text.match(
                /\n/g
            ) ||
            []
        ).length;
    }


    function codeSignature(
        text
    ) {
        return normalizeCodeText(
            text
        ).replace(
            /\s+/g,
            ''
        );
    }


    function languageFromLabel(
        text
    ) {
        const normalized = (
            text ||
            ''
        )
            .trim()
            .toLowerCase();

        return (
            LANGUAGE_MAP.get(
                normalized
            ) ||
            ''
        );
    }


    function looksLikeCopyUiText(
        text
    ) {
        const normalized = (
            text ||
            ''
        )
            .replace(
                /\s+/g,
                ' '
            )
            .trim()
            .toLowerCase();

        if (!normalized) {
            return true;
        }

        return (
            /^(copy|copy code|copied|复制|复制代码|已复制|edit|编辑)$/
                .test(
                    normalized
                )
        );
    }


    /*
     * 从 class / data attribute / wrapper 顶部文字识别语言。
     */
    function detectCodeLanguage(
        pre,
        wrapper
    ) {
        const code =
            pre.querySelector(
                'code'
            );

        const nodes = [
            code,
            pre
        ].filter(Boolean);


        for (
            const node of nodes
        ) {
            const className =
                typeof node.className ===
                    'string'
                    ? node.className
                    : '';


            const match =
                className.match(
                    /(?:language|lang)-([a-zA-Z0-9_+#.-]+)/i
                );


            if (match) {
                return (
                    languageFromLabel(
                        match[1]
                    ) ||
                    match[1]
                        .toLowerCase()
                );
            }


            for (
                const attr of [
                    'data-language',
                    'data-lang'
                ]
            ) {
                const value =
                    node.getAttribute &&
                    node.getAttribute(
                        attr
                    );

                if (
                    value &&
                    value.trim()
                ) {
                    return (
                        languageFromLabel(
                            value
                        ) ||
                        value
                            .trim()
                            .toLowerCase()
                    );
                }
            }
        }


        /*
         * 如果语言标签在 <pre> 外面：
         *
         * LaTeX
         * Python
         * JavaScript
         *
         * 则从 wrapper 中识别。
         */
        if (wrapper) {
            const clone =
                wrapper.cloneNode(
                    true
                );


            clone
                .querySelectorAll(
                    'pre, code, ' +
                    COPY_UI_SELECTOR +
                    ', svg'
                )
                .forEach(
                    node =>
                        node.remove()
                );


            const residue = (
                clone.innerText ||
                clone.textContent ||
                ''
            )
                .split(
                    /\n+/
                )
                .map(
                    line =>
                        line.trim()
                )
                .filter(Boolean);


            for (
                const line of residue
            ) {
                const lang =
                    languageFromLabel(
                        line
                    );

                if (lang) {
                    return lang;
                }
            }
        }


        return '';
    }


    /*
     * ============================================================
     * 找真正的代码块 wrapper
     * ============================================================
     *
     * 这是修复：
     *
     * LaTeX\int...
     *
     * 的关键。
     *
     * 不能简单向上找一个 div。
     *
     * 我们必须验证：
     *
     * candidate
     *     │
     *     ├── LaTeX
     *     ├── Copy
     *     └── <pre>...</pre>
     *
     * 删除 pre / button / svg 后，
     * 如果只剩语言标签，那么它才是纯代码 wrapper。
     *
     * 如果剩下：
     *
     * "下面是一个例子"
     *
     * 那么它不是代码 wrapper，
     * 不能整个删除。
     */


    function isPureCodeWrapper(
        candidate
    ) {
        if (
            !candidate ||
            candidate
                .querySelectorAll(
                    'pre'
                )
                .length !== 1
        ) {
            return false;
        }


        const clone =
            candidate.cloneNode(
                true
            );


        clone
            .querySelectorAll(
                'pre, ' +
                COPY_UI_SELECTOR +
                ', svg'
            )
            .forEach(
                node =>
                    node.remove()
            );


        const residue = (
            clone.innerText ||
            clone.textContent ||
            ''
        )
            .split(
                /\n+/
            )
            .map(
                line =>
                    line
                        .replace(
                            /\s+/g,
                            ' '
                        )
                        .trim()
            )
            .filter(Boolean);


        return residue.every(
            line =>
                languageFromLabel(
                    line
                ) ||
                looksLikeCopyUiText(
                    line
                )
        );
    }


    function findPureCodeWrapper(
        pre,
        contentRoot
    ) {
        let best =
            pre;

        let current =
            pre;


        for (
            let depth = 0;
            current &&
            depth < 8;
            depth++
        ) {
            if (
                isPureCodeWrapper(
                    current
                )
            ) {
                best =
                    current;
            }


            if (
                current ===
                contentRoot
            ) {
                break;
            }


            current =
                current.parentElement;


            if (
                !current ||
                !contentRoot.contains(
                    current
                )
            ) {
                break;
            }
        }


        return best;
    }


    /*
     * ============================================================
     * DOM structural code extraction
     * ============================================================
     *
     * <br>
     * div
     * p
     * block element
     *
     * 都尝试恢复成真正的 \n。
     */


    function extractStructuralCodeText(
        source
    ) {
        if (!source) {
            return '';
        }


        let output = '';


        const newline = () => {
            if (
                output &&
                !output.endsWith(
                    '\n'
                )
            ) {
                output += '\n';
            }
        };


        const walk = node => {
            if (
                node.nodeType ===
                Node.TEXT_NODE
            ) {
                output +=
                    node.textContent ||
                    '';

                return;
            }


            if (
                node.nodeType !==
                Node.ELEMENT_NODE
            ) {
                return;
            }


            const tag =
                node.tagName
                    .toLowerCase();


            if (
                tag === 'br'
            ) {
                newline();

                return;
            }


            let blockLike =
                false;


            if (
                node !== source
            ) {
                if (
                    [
                        'div',
                        'p',
                        'li',
                        'tr'
                    ].includes(tag)
                ) {
                    blockLike =
                        true;

                } else if (
                    node.isConnected
                ) {
                    try {
                        const display =
                            window
                                .getComputedStyle(
                                    node
                                )
                                .display;

                        blockLike =
                            [
                                'block',
                                'list-item',
                                'table-row'
                            ].includes(
                                display
                            );

                    } catch (_) {
                        blockLike =
                            false;
                    }
                }
            }


            if (
                blockLike
            ) {
                newline();
            }


            for (
                const child of
                node.childNodes
            ) {
                walk(child);
            }


            if (
                blockLike
            ) {
                newline();
            }
        };


        for (
            const child of
            source.childNodes
        ) {
            walk(child);
        }


        return normalizeCodeText(
            output
        );
    }


    /*
     * ============================================================
     * Visual character-level line reconstruction
     * ============================================================
     *
     * 这是 v0.5.3 最重要的修改。
     *
     * 旧算法：
     *
     *     一个 Text Node
     *          ↓
     *     一个整体 Range
     *
     * 如果这个 Text Node 横跨三行，
     * 仍可能被判断成一个整体。
     *
     *
     * 新算法：
     *
     *      字符 1
     *      字符 2
     *      字符 3
     *        ↓
     *     每个字符单独 Range
     *        ↓
     *     getBoundingClientRect()
     *        ↓
     *     比较 top
     *
     *
     * 例如：
     *
     * \mathbf{A}        top = 500
     *
     * =                  top = 524
     *
     * \begin{bmatrix}   top = 548
     *
     *
     * top 改变：
     *
     *     自动加入 \n
     */


    function extractVisualCodeText(
        source
    ) {
        if (
            !source ||
            !source.isConnected
        ) {
            return '';
        }


        const walker =
            document.createTreeWalker(
                source,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode(
                        node
                    ) {
                        return (
                            (
                                node.textContent ||
                                ''
                            ).length
                                ? NodeFilter
                                    .FILTER_ACCEPT
                                : NodeFilter
                                    .FILTER_REJECT
                        );
                    }
                }
            );


        let output = '';

        let previousTop =
            null;

        let detectedVisualBreak =
            false;

        let textNode;


        while (
            (
                textNode =
                    walker.nextNode()
            )
        ) {
            const text =
                textNode.textContent ||
                '';


            /*
             * 逐字符，而不是逐 text node。
             */
            for (
                let i = 0;
                i < text.length;
                i++
            ) {
                const ch =
                    text[i];


                /*
                 * Windows CR 忽略。
                 */
                if (
                    ch === '\r'
                ) {
                    continue;
                }


                /*
                 * DOM 本身已经有真实换行。
                 */
                if (
                    ch === '\n'
                ) {
                    if (
                        !output.endsWith(
                            '\n'
                        )
                    ) {
                        output += '\n';
                    }

                    previousTop =
                        null;

                    continue;
                }


                let top =
                    null;


                try {
                    const range =
                        document
                            .createRange();


                    range.setStart(
                        textNode,
                        i
                    );


                    range.setEnd(
                        textNode,
                        i + 1
                    );


                    const rect =
                        range
                            .getBoundingClientRect();


                    if (
                        rect &&
                        (
                            rect.width > 0 ||
                            rect.height > 0
                        )
                    ) {
                        top =
                            rect.top;
                    }

                } catch (_) {
                    top =
                        null;
                }


                /*
                 * Y 坐标发生明显变化：
                 *
                 * 浏览器已经把下一个字符放到下一行。
                 *
                 * 自动恢复 \n。
                 */
                if (
                    top !== null &&
                    previousTop !== null &&
                    Math.abs(
                        top -
                        previousTop
                    ) > 3 &&
                    !output.endsWith(
                        '\n'
                    )
                ) {
                    output += '\n';

                    detectedVisualBreak =
                        true;
                }


                output += ch;


                if (
                    top !== null
                ) {
                    previousTop =
                        top;
                }
            }
        }


        return (
            detectedVisualBreak
                ? normalizeCodeText(
                    output
                )
                : ''
        );
    }


    /*
     * ============================================================
     * Final Code Extraction
     * ============================================================
     *
     * 同时比较：
     *
     * 1. textContent
     * 2. innerText
     * 3. DOM structural
     * 4. character-level visual
     *
     * 然后选择：
     *
     *     内容一致
     *     且
     *     换行最多
     *
     * 的那个版本。
     */


    function extractCodeBlockText(
        pre
    ) {
        const code =
            pre.querySelector(
                'code'
            );


        const source =
            code ||
            pre;


        const raw =
            normalizeCodeText(
                source.textContent ||
                ''
            );


        const rendered =
            normalizeCodeText(
                source.innerText ||
                ''
            );


        const structural =
            extractStructuralCodeText(
                source
            );


        const visual =
            extractVisualCodeText(
                source
            );


        /*
         * 去掉 whitespace 后检查文本内容是否一致。
         *
         * 防止视觉提取误把 UI 或其它文字放进代码。
         */
        const signature =
            codeSignature(
                raw
            );


        const candidates = [
            raw,
            rendered,
            structural,
            visual
        ]
            .filter(
                text =>
                    text !== ''
            )
            .filter(
                text =>
                    !signature ||
                    codeSignature(
                        text
                    ) === signature
            );


        let best =
            raw;


        for (
            const candidate of candidates
        ) {
            if (
                countNewlines(
                    candidate
                ) >
                countNewlines(
                    best
                )
            ) {
                best =
                    candidate;
            }
        }


        /*
         * 只删除代码 DOM 最后额外产生的一个换行。
         *
         * 不使用 trim()。
         *
         * 因为：
         *
         *     缩进
         *     内部空行
         *     前导空格
         *
         * 对代码有意义。
         */
        if (
            best.endsWith(
                '\n'
            )
        ) {
            best =
                best.slice(
                    0,
                    -1
                );
        }


        /*
         * 调试信息。
         *
         * F12 -> Console
         *
         * 可以看到四种算法各自识别了多少行。
         */
        console.log(
            '[copyformd][Code Debug]',
            {
                rawLines:
                    countNewlines(
                        raw
                    ),

                renderedLines:
                    countNewlines(
                        rendered
                    ),

                structuralLines:
                    countNewlines(
                        structural
                    ),

                visualLines:
                    countNewlines(
                        visual
                    ),

                selectedLines:
                    countNewlines(
                        best
                    ),

                raw,
                selected:
                    best
            }
        );


        return best;
    }


    /*
     * ============================================================
     * Markdown fenced code
     * ============================================================
     */


    function buildFencedCodeMarkdown(
        text,
        language
    ) {
        const backtickRuns =
            text.match(
                /`+/g
            ) ||
            [];


        const longestRun =
            backtickRuns.reduce(
                (
                    max,
                    run
                ) =>
                    Math.max(
                        max,
                        run.length
                    ),
                0
            );


        /*
         * 如果代码本身有 ```
         * 外层自动改成 ````
         */
        const fence =
            '`'.repeat(
                Math.max(
                    3,
                    longestRun + 1
                )
            );


        return (
            fence +
            (
                language ||
                ''
            ) +
            '\n' +
            text +
            '\n' +
            fence
        );
    }


    /*
     * ============================================================
     * Freeze code blocks
     * ============================================================
     */


    function prepareCodeMetadata(
        contentRoot
    ) {
        const metadata =
            new Map();

        const wrappers =
            new Set();


        const pres = [
            ...contentRoot
                .querySelectorAll(
                    'pre'
                )
        ];


        for (
            const pre of pres
        ) {
            /*
             * 找经过验证的 wrapper。
             *
             * wrapper 可以包含：
             *
             * LaTeX
             * Copy
             * <pre>
             *
             * 但不能包含其它正文。
             */
            const wrapper =
                findPureCodeWrapper(
                    pre,
                    contentRoot
                );


            if (
                wrappers.has(
                    wrapper
                )
            ) {
                continue;
            }


            const text =
                extractCodeBlockText(
                    pre
                );


            const language =
                detectCodeLanguage(
                    pre,
                    wrapper
                );


            const id =
                'copyformd-code-' +
                (++codeIdCounter);


            const placeholder =
                '@@COPYFORMD_CODE_BLOCK_' +
                codeIdCounter +
                '@@';


            const markdown =
                buildFencedCodeMarkdown(
                    text,
                    language
                );


            wrapper.setAttribute(
                TEMP_CODE_ATTR,
                id
            );


            wrappers.add(
                wrapper
            );


            metadata.set(
                id,
                {
                    placeholder,
                    markdown,
                    language
                }
            );
        }


        return {
            metadata,
            markedWrappers: [
                ...wrappers
            ]
        };
    }


    function replacePreparedCodeWithPlaceholders(
        clone,
        metadata
    ) {
        const nodes = [
            ...clone.querySelectorAll(
                '[' +
                TEMP_CODE_ATTR +
                ']'
            )
        ];


        let count = 0;


        for (
            const node of nodes
        ) {
            const id =
                node.getAttribute(
                    TEMP_CODE_ATTR
                );


            const info =
                metadata.get(id);


            if (!info) {
                continue;
            }


            node.replaceWith(
                document.createTextNode(
                    '\n\n' +
                    info.placeholder +
                    '\n\n'
                )
            );


            count++;
        }


        console.log(
            '[copyformd] 代码块：' +
            count +
            ' 个。'
        );
    }


    function restorePreparedCode(
        markdown,
        metadata
    ) {
        let result =
            markdown;


        for (
            const info of
            metadata.values()
        ) {
            result =
                result
                    .split(
                        info.placeholder
                    )
                    .join(
                        info.markdown
                    );
        }


        return result;
    }


    /*
     * ============================================================
     * DOM → Markdown
     * ============================================================
     */


    function nodeToMarkdown(
        node,
        listLevel = 0
    ) {
        if (
            node.nodeType ===
            Node.TEXT_NODE
        ) {
            return normalizeText(
                node.textContent
            );
        }


        if (
            node.nodeType !==
            Node.ELEMENT_NODE
        ) {
            return '';
        }


        const tag =
            node.tagName
                .toLowerCase();


        if (
            [
                'button',
                'svg',
                'script',
                'style',
                'noscript'
            ].includes(tag)
        ) {
            return '';
        }


        const children =
            () =>
                [
                    ...node.childNodes
                ]
                    .map(
                        child =>
                            nodeToMarkdown(
                                child,
                                listLevel
                            )
                    )
                    .join('');


        /*
         * Heading
         */
        if (
            /^h[1-6]$/.test(
                tag
            )
        ) {
            const level =
                Number(
                    tag.slice(1)
                );


            const content =
                children()
                    .trim();


            return (
                content
                    ? (
                        '\n\n' +
                        '#'.repeat(
                            level
                        ) +
                        ' ' +
                        content +
                        '\n\n'
                    )
                    : ''
            );
        }


        /*
         * Paragraph
         */
        if (
            tag === 'p'
        ) {
            const content =
                children()
                    .trim();


            return (
                content
                    ? (
                        '\n\n' +
                        content +
                        '\n\n'
                    )
                    : '\n'
            );
        }


        /*
         * Bold
         */
        if (
            tag === 'strong' ||
            tag === 'b'
        ) {
            const content =
                children()
                    .trim();


            return (
                content
                    ? (
                        '**' +
                        content +
                        '**'
                    )
                    : ''
            );
        }


        /*
         * Italic
         */
        if (
            tag === 'em' ||
            tag === 'i'
        ) {
            const content =
                children()
                    .trim();


            return (
                content
                    ? (
                        '*' +
                        content +
                        '*'
                    )
                    : ''
            );
        }


        /*
         * Strike
         */
        if (
            tag === 'del' ||
            tag === 's'
        ) {
            const content =
                children()
                    .trim();


            return (
                content
                    ? (
                        '~~' +
                        content +
                        '~~'
                    )
                    : ''
            );
        }


        if (
            tag === 'br'
        ) {
            return '\n';
        }


        if (
            tag === 'hr'
        ) {
            return (
                '\n\n---\n\n'
            );
        }


        /*
         * Link
         */
        if (
            tag === 'a'
        ) {
            const text =
                children()
                    .trim();


            const href =
                node.getAttribute(
                    'href'
                ) ||
                '';


            if (!href) {
                return text;
            }


            return (
                text
                    ? (
                        '[' +
                        text +
                        '](' +
                        href +
                        ')'
                    )
                    : href
            );
        }


        /*
         * Inline code
         */
        if (
            tag === 'code' &&
            (
                !node.parentElement ||
                node.parentElement
                    .tagName
                    .toLowerCase() !==
                'pre'
            )
        ) {
            const codeText =
                node.textContent ||
                '';


            return (
                codeText.includes(
                    '`'
                )
                    ? (
                        '`` ' +
                        codeText +
                        ' ``'
                    )
                    : (
                        '`' +
                        codeText +
                        '`'
                    )
            );
        }


        /*
         * Fallback.
         *
         * 正常情况下代码块已经被冻结成 placeholder，
         * 不会执行到这里。
         */
        if (
            tag === 'pre'
        ) {
            const text =
                extractCodeBlockText(
                    node
                );


            const language =
                detectCodeLanguage(
                    node,
                    node.parentElement
                );


            return (
                '\n\n' +
                buildFencedCodeMarkdown(
                    text,
                    language
                ) +
                '\n\n'
            );
        }


        /*
         * Blockquote
         */
        if (
            tag === 'blockquote'
        ) {
            const content =
                children()
                    .trim()
                    .split(
                        '\n'
                    )
                    .map(
                        line =>
                            line
                                ? (
                                    '> ' +
                                    line
                                )
                                : '>'
                    )
                    .join(
                        '\n'
                    );


            return (
                '\n\n' +
                content +
                '\n\n'
            );
        }


        /*
         * UL
         */
        if (
            tag === 'ul'
        ) {
            return (
                '\n' +
                [
                    ...node.children
                ]
                    .filter(
                        child =>
                            child.tagName &&
                            child.tagName
                                .toLowerCase() ===
                            'li'
                    )
                    .map(
                        li =>
                            listItemToMarkdown(
                                li,
                                false,
                                listLevel
                            )
                    )
                    .join('') +
                '\n'
            );
        }


        /*
         * OL
         */
        if (
            tag === 'ol'
        ) {
            const start =
                Number(
                    node.getAttribute(
                        'start'
                    )
                ) ||
                1;


            return (
                '\n' +
                [
                    ...node.children
                ]
                    .filter(
                        child =>
                            child.tagName &&
                            child.tagName
                                .toLowerCase() ===
                            'li'
                    )
                    .map(
                        (
                            li,
                            index
                        ) =>
                            listItemToMarkdown(
                                li,
                                true,
                                listLevel,
                                start +
                                index
                            )
                    )
                    .join('') +
                '\n'
            );
        }


        if (
            tag === 'table'
        ) {
            return tableToMarkdown(
                node
            );
        }


        return children();
    }


    /*
     * ============================================================
     * Lists
     * ============================================================
     */


    function listItemToMarkdown(
        li,
        ordered,
        level,
        index = 1
    ) {
        const indent =
            '    '.repeat(
                level
            );


        const prefix =
            ordered
                ? (
                    index +
                    '. '
                )
                : '- ';


        let text = '';


        for (
            const child of
            li.childNodes
        ) {
            if (
                child.nodeType ===
                    Node.ELEMENT_NODE &&
                [
                    'ul',
                    'ol'
                ].includes(
                    child.tagName
                        .toLowerCase()
                )
            ) {
                continue;
            }


            text +=
                nodeToMarkdown(
                    child,
                    level + 1
                );
        }


        text =
            text
                .replace(
                    /\n{2,}/g,
                    ' '
                )
                .trim();


        let result =
            indent +
            prefix +
            text +
            '\n';


        for (
            const child of
            li.children
        ) {
            if (
                [
                    'ul',
                    'ol'
                ].includes(
                    child.tagName
                        .toLowerCase()
                )
            ) {
                result +=
                    nodeToMarkdown(
                        child,
                        level + 1
                    );
            }
        }


        return result;
    }


    /*
     * ============================================================
     * Tables
     * ============================================================
     */


    function tableToMarkdown(
        table
    ) {
        const rows = [
            ...table.querySelectorAll(
                'tr'
            )
        ];


        if (
            !rows.length
        ) {
            return '';
        }


        const parsedRows =
            rows.map(
                row =>
                    [
                        ...row.querySelectorAll(
                            ':scope > th, :scope > td'
                        )
                    ].map(
                        cell =>
                            nodeToMarkdown(
                                cell
                            )
                                .trim()
                                .replace(
                                    /\n+/g,
                                    '<br>'
                                )
                                .replace(
                                    /\|/g,
                                    '\\|'
                                )
                    )
            );


        const columnCount =
            Math.max(
                ...parsedRows.map(
                    row =>
                        row.length
                )
            );


        for (
            const row of parsedRows
        ) {
            while (
                row.length <
                columnCount
            ) {
                row.push('');
            }
        }


        const output = [];


        output.push(
            '| ' +
            parsedRows[0]
                .join(
                    ' | '
                ) +
            ' |'
        );


        output.push(
            '| ' +
            Array(
                columnCount
            )
                .fill(
                    '---'
                )
                .join(
                    ' | '
                ) +
            ' |'
        );


        for (
            let i = 1;
            i <
            parsedRows.length;
            i++
        ) {
            output.push(
                '| ' +
                parsedRows[i]
                    .join(
                        ' | '
                    ) +
                ' |'
            );
        }


        return (
            '\n\n' +
            output.join(
                '\n'
            ) +
            '\n\n'
        );
    }


    /*
     * ============================================================
     * Markdown Cleanup
     * ============================================================
     *
     * 注意：
     *
     * 此时代码块已经变成 placeholder。
     *
     * 所以这里修改普通 Markdown 的空白字符时，
     * 不可能影响代码块内部：
     *
     *     换行
     *     缩进
     *     空行
     */


    function cleanupMarkdown(
        text
    ) {
        return (text || '')
            .replace(
                /\r\n?/g,
                '\n'
            )
            .replace(
                /[ \t]+\n/g,
                '\n'
            )
            .replace(
                /\n[ \t]+\n/g,
                '\n\n'
            )
            .replace(
                /\n{4,}/g,
                '\n\n\n'
            )
            .replace(
                /\n[ \t]+(?=#{1,6} )/g,
                '\n'
            )
            .trim();
    }


    /*
     * ============================================================
     * Convert Root
     * ============================================================
     */


    function convertRootToMarkdown(
        liveRoot
    ) {
        if (!liveRoot) {
            return '';
        }


        /*
         * 代码先处理。
         *
         * 必须在 LIVE DOM 上运行，
         * 因为字符位置恢复依赖：
         *
         * getBoundingClientRect()
         */
        const preparedCode =
            prepareCodeMetadata(
                liveRoot
            );


        const preparedMath =
            prepareMathMetadata(
                liveRoot
            );


        let clone;


        try {
            clone =
                liveRoot.cloneNode(
                    true
                );

        } finally {
            /*
             * 清理真实 ChatGPT DOM 上的临时 attribute。
             */
            for (
                const wrapper of
                preparedCode.markedWrappers
            ) {
                wrapper.removeAttribute(
                    TEMP_CODE_ATTR
                );
            }


            for (
                const wrapper of
                preparedMath.markedWrappers
            ) {
                wrapper.removeAttribute(
                    TEMP_MATH_ATTR
                );
            }
        }


        /*
         * 删除所有 UI。
         */
        clone
            .querySelectorAll(
                [
                    '.' +
                    BUTTON_WRAPPER_CLASS,

                    '.' +
                    BUTTON_CLASS,

                    '[data-testid^="copy-turn-action-button"]',

                    '[data-testid^="copy-code-block"]',

                    '[data-qa="copy-code"]',

                    'button',

                    'script',

                    'style',

                    'noscript'
                ].join(',')
            )
            .forEach(
                node =>
                    node.remove()
            );


        /*
         * 代码块整体：
         *
         * LaTeX
         * Copy
         * <pre>
         *
         * ↓
         *
         * @@COPYFORMD_CODE_BLOCK_1@@
         */
        replacePreparedCodeWithPlaceholders(
            clone,
            preparedCode.metadata
        );


        /*
         * 公式转 Markdown。
         */
        replacePreparedMath(
            clone,
            preparedMath.metadata
        );


        /*
         * 普通正文转换。
         *
         * 此时不会碰到真正的代码内容。
         */
        let markdown =
            cleanupMarkdown(
                nodeToMarkdown(
                    clone
                )
            );


        /*
         * 最后把代码块原样放回来。
         */
        markdown =
            restorePreparedCode(
                markdown,
                preparedCode.metadata
            );


        return (
            markdown.trim()
        );
    }


    /*
     * ============================================================
     * Convert Turn
     * ============================================================
     */


    function convertTurnToMarkdown(
        turn
    ) {
        const root =
            getBestContentRoot(
                turn
            );


        console.log(
            '[copyformd] 当前正文节点：',
            root
        );


        console.log(
            '[copyformd] 正文评分：',
            contentScore(
                root
            )
        );


        let markdown =
            convertRootToMarkdown(
                root
            );


        if (
            !markdown &&
            root !== turn
        ) {
            console.warn(
                '[copyformd] 主正文为空，退回整个 Assistant turn。'
            );


            markdown =
                convertRootToMarkdown(
                    turn
                );
        }


        return markdown;
    }


    /*
     * ============================================================
     * Copy Button
     * ============================================================
     */


    function createButton(
        turn
    ) {
        const wrapper =
            document.createElement(
                'div'
            );


        wrapper.className =
            BUTTON_WRAPPER_CLASS;


        wrapper.style.cssText = `
            margin-top: 10px;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        `;


        const button =
            document.createElement(
                'button'
            );


        button.type =
            'button';


        button.className =
            BUTTON_CLASS;


        button.textContent =
            'Copy for md Latex';


        button.style.cssText = `
            padding: 6px 12px;
            border: 1px solid rgba(128,128,128,.45);
            border-radius: 8px;
            background: transparent;
            color: inherit;
            cursor: pointer;
            font-size: 13px;
            line-height: 20px;
            font-family: inherit;
        `;


        button.addEventListener(
            'mouseenter',
            () => {
                button.style.background =
                    'rgba(128,128,128,.12)';
            }
        );


        button.addEventListener(
            'mouseleave',
            () => {
                button.style.background =
                    'transparent';
            }
        );


        button.addEventListener(
            'click',
            async event => {
                event.preventDefault();

                event.stopPropagation();


                const normalLabel =
                    'Copy for md Latex';


                try {
                    button.textContent =
                        'Converting...';


                    const markdown =
                        convertTurnToMarkdown(
                            turn
                        );


                    if (
                        !markdown
                    ) {
                        throw new Error(
                            '转换结果为空。'
                        );
                    }


                    console.log(
                        '[copyformd] 转换后的 Markdown：\n\n' +
                        markdown
                    );


                    const ok =
                        await copyText(
                            markdown
                        );


                    if (!ok) {
                        throw new Error(
                            '无法写入剪贴板。'
                        );
                    }


                    button.textContent =
                        'Copied ✓';


                    setTimeout(
                        () => {
                            button.textContent =
                                normalLabel;
                        },
                        1500
                    );

                } catch (error) {
                    console.error(
                        '[copyformd] 复制失败：',
                        error
                    );


                    button.textContent =
                        'Copy failed';


                    setTimeout(
                        () => {
                            button.textContent =
                                normalLabel;
                        },
                        2500
                    );
                }
            }
        );


        wrapper.appendChild(
            button
        );


        return wrapper;
    }


    /*
     * ============================================================
     * Install Buttons
     * ============================================================
     */


    function addButtons() {
        const turns =
            findAssistantTurns();


        for (
            const turn of turns
        ) {
            const existing = [
                ...turn.querySelectorAll(
                    '.' +
                    BUTTON_WRAPPER_CLASS
                )
            ];


            if (
                turn.getAttribute(
                    TURN_PROCESSED_ATTR
                ) === 'true'
            ) {
                existing
                    .slice(1)
                    .forEach(
                        node =>
                            node.remove()
                    );


                continue;
            }


            existing.forEach(
                node =>
                    node.remove()
            );


            turn.setAttribute(
                TURN_PROCESSED_ATTR,
                'true'
            );


            turn.appendChild(
                createButton(
                    turn
                )
            );
        }
    }


    /*
     * ============================================================
     * Cleanup Older Version
     * ============================================================
     */


    document
        .querySelectorAll(
            '.' +
            BUTTON_WRAPPER_CLASS
        )
        .forEach(
            node =>
                node.remove()
        );


    document
        .querySelectorAll(
            '[' +
            TURN_PROCESSED_ATTR +
            ']'
        )
        .forEach(
            node =>
                node.removeAttribute(
                    TURN_PROCESSED_ATTR
                )
        );


    /*
     * ============================================================
     * Observe Dynamic ChatGPT DOM
     * ============================================================
     */


    let scheduled =
        false;


    const observer =
        new MutationObserver(
            () => {
                if (
                    scheduled
                ) {
                    return;
                }


                scheduled =
                    true;


                requestAnimationFrame(
                    () => {
                        scheduled =
                            false;


                        addButtons();
                    }
                );
            }
        );


    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );


    /*
     * Initial scan
     */
    addButtons();


    console.log(
        '[copyformd] GPT Markdown LaTeX Copy v0.5.3 已加载。'
    );

})();