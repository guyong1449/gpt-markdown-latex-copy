// ==UserScript==
// @name         Copy for md Latex
// @namespace    https://github.com/guyong1449/gpt-markdown-latex-copy
// @version      0.5.6
// @description  将 ChatGPT 回答复制为 Markdown，保留 LaTeX 与代码块真实换行，避免视觉自动折行被误复制成换行
// @homepageURL  https://github.com/guyong1449/gpt-markdown-latex-copy
// @supportURL   https://github.com/guyong1449/gpt-markdown-latex-copy/issues
// @updateURL    https://raw.githubusercontent.com/guyong1449/gpt-markdown-latex-copy/main/copy-for-md-latex.user.js
// @downloadURL  https://raw.githubusercontent.com/guyong1449/gpt-markdown-latex-copy/main/copy-for-md-latex.user.js
// @match        https://chatgpt.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_WRAPPER_CLASS = 'copy-for-md-latex-wrapper';
    const BUTTON_CLASS = 'copy-for-md-latex-button';
    const TURN_PROCESSED_ATTR = 'data-copy-for-md-latex-turn-ready';
    const TEMP_CODE_ATTR = 'data-copy-for-md-latex-temp-code-id';
    const TEMP_MATH_ATTR = 'data-copy-for-md-latex-temp-math-id';

    let codeIdCounter = 0;
    let mathIdCounter = 0;

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

    const COPY_UI_SELECTOR = [
        'button',
        '[data-testid^="copy-code-block"]',
        '[data-testid^="copy-turn-action-button"]',
        '[data-qa="copy-code"]'
    ].join(',');


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
                '[Copy for md Latex] Clipboard API 失败，尝试备用方式：',
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
                    '[Copy for md Latex] execCommand(copy) 失败：',
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
     * Code
     * ============================================================
     */

    function normalizeCodeText(text) {
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


    function countNewlines(text) {
        return (
            text.match(/\n/g) ||
            []
        ).length;
    }


    function codeSignature(text) {
        return normalizeCodeText(
            text
        ).replace(
            /\s+/g,
            ''
        );
    }


    function languageFromLabel(text) {
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


    function looksLikeCopyUiText(text) {
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
     * ============================================================
     * Detect code language
     * ============================================================
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
         * 有些 ChatGPT 代码块结构：
         *
         * Python
         * Copy
         * <pre>...</pre>
         *
         * 语言标签不在 pre 内部，
         * 因此从 wrapper 剩余文本中识别。
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
     * Find pure code wrapper
     * ============================================================
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
     * Structural code extraction
     * ============================================================
     *
     * 非常重要：
     *
     * 此版本不再使用：
     *
     *     getBoundingClientRect()
     *     rect.top
     *     字符视觉位置
     *
     * 来判断换行。
     *
     * 因此浏览器因为窗口宽度产生的：
     *
     *     soft wrap
     *
     * 不会被误认为源码里的：
     *
     *     \n
     *
     * 只根据真正 DOM 结构：
     *
     *     <br>
     *     <div>
     *     <p>
     *     <li>
     *     <tr>
     *
     * 恢复缺失的真实行。
     * ============================================================
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


            /*
             * 只使用明确 DOM 块结构。
             *
             * 不使用 computedStyle，
             * 更不使用元素屏幕坐标。
             */

            const blockLike =
                node !== source &&
                [
                    'div',
                    'p',
                    'li',
                    'tr'
                ].includes(
                    tag
                );


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
     * Final Code Extraction
     * ============================================================
     *
     * 修复重点：
     *
     * 旧版本：
     *
     * raw
     * innerText
     * structural
     * visual
     *
     * 然后：
     *
     *     谁换行最多选谁
     *
     * 这是错误的。
     *
     * 因为 visual 会把页面 soft wrap
     * 当成真正换行。
     *
     *
     * 新版本：
     *
     * ① textContent 已经有真实换行
     *      ↓
     *    直接使用
     *
     * ② textContent 完全没有换行
     *      ↓
     *    才尝试 innerText / structural
     *
     * ③ 完全禁止视觉坐标制造换行
     * ============================================================
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


        const signature =
            codeSignature(
                raw
            );


        const validCandidate =
            text =>
                text !== '' &&
                (
                    !signature ||
                    codeSignature(
                        text
                    ) ===
                    signature
                );


        /*
         * 默认直接相信 textContent。
         */

        let best =
            raw;


        /*
         * 只有 raw 一条真实换行都没有，
         * 才允许其它 DOM 方法帮助恢复。
         */

        if (
            countNewlines(
                raw
            ) === 0
        ) {
            const candidates = [
                rendered,
                structural
            ].filter(
                validCandidate
            );


            for (
                const candidate of
                candidates
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
        }


        /*
         * DOM 有时在代码末尾额外生成一个换行。
         *
         * 只删最后一个。
         *
         * 不能 trim()：
         *
         * 因为代码前导空格、缩进、空行都有意义。
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


        console.log(
            '[Copy for md Latex][Code Debug]',
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
         * 如果代码自己包含：
         *
         * ```
         *
         * 外层自动使用更多反引号。
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
     * Freeze Code Blocks
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
                'copy-for-md-latex-code-' +
                (++codeIdCounter);


            const placeholder =
                '@@COPY_FOR_MD_LATEX_CODE_BLOCK_' +
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


        for (
            const node of nodes
        ) {
            const id =
                node.getAttribute(
                    TEMP_CODE_ATTR
                );


            const info =
                metadata.get(
                    id
                );


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
        }
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
     * Math
     * ============================================================
     */

    function getElement(
        node
    ) {
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
            getElement(
                node
            );


        if (!element) {
            return null;
        }


        /*
         * KaTeX / MathML annotation
         */

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
                const value = (
                    element.textContent ||
                    ''
                ).trim();


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
                    const value = (
                        annotation.textContent ||
                        ''
                    ).trim();


                    if (value) {
                        return value;
                    }
                }
            }
        }


        /*
         * 自定义 LaTeX attributes
         */

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


        /*
         * aria-label fallback
         */

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
                    value.includes(
                        '\\'
                    ) ||
                    /[_^{}]/.test(
                        value
                    )
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
            getElement(
                node
            );


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
            element.closest(
                'math'
            );


        if (math) {
            return math;
        }


        return element;
    }


    function detectDisplayMath(
        wrapper
    ) {
        if (!wrapper) {
            return false;
        }


        /*
         * KaTeX display
         */

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


        /*
         * MathJax display
         */

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


        /*
         * MathML
         */

        const math =
            wrapper.matches &&
            wrapper.matches(
                'math'
            )
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


        /*
         * Custom display classes
         */

        const displaySelector =
            [
                '.math-display',
                '.math-block',
                '.display-math',
                '[data-math-display="true"]'
            ].join(',');


        return Boolean(
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
        );
    }


    function prepareMathMetadata(
        contentRoot
    ) {
        const metadata =
            new Map();


        const wrapperSet =
            new Set();


        const candidates = [
            ...contentRoot
                .querySelectorAll(
                    [
                        'annotation',
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
            const candidate of
            candidates
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


            const id =
                'copy-for-md-latex-math-' +
                (++mathIdCounter);


            const display =
                detectDisplayMath(
                    wrapper
                );


            wrapper.setAttribute(
                TEMP_MATH_ATTR,
                id
            );


            wrapperSet.add(
                wrapper
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


    /*
     * ============================================================
     * Replace Math
     * ============================================================
     *
     * 行内：
     *
     *     $x^2$
     *
     * 独立公式：
     *
     *     $$
     *     x^2
     *     $$
     * ============================================================
     */

    function replacePreparedMath(
        clone,
        metadata
    ) {
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
                metadata.get(
                    id
                );


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


            node.replaceWith(
                document.createTextNode(
                    markdown
                )
            );
        }
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
                node.textContent ||
                ''
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


        /*
         * Ignore UI
         */

        if (
            [
                'button',
                'svg',
                'script',
                'style',
                'noscript'
            ].includes(
                tag
            )
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


        /*
         * BR
         */

        if (
            tag === 'br'
        ) {
            return '\n';
        }


        /*
         * HR
         */

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
         * Fallback pre
         *
         * 正常情况下真正代码块已经提前变成 placeholder。
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
         * UL / OL
         */

        if (
            tag === 'ul' ||
            tag === 'ol'
        ) {
            const ordered =
                tag === 'ol';


            const start =
                ordered
                    ? (
                        Number(
                            node.getAttribute(
                                'start'
                            )
                        ) ||
                        1
                    )
                    : 1;


            const items = [
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
                            ordered,
                            listLevel,
                            start +
                            index
                        )
                )
                .join('');


            return (
                '\n' +
                items +
                '\n'
            );
        }


        /*
         * Table
         */

        if (
            tag === 'table'
        ) {
            return tableToMarkdown(
                node
            );
        }


        /*
         * Generic container
         */

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


        /*
         * list item 正文中的段落空行压成空格。
         */

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


        /*
         * Nested list
         */

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
            const row of
            parsedRows
        ) {
            while (
                row.length <
                columnCount
            ) {
                row.push('');
            }
        }


        const output =
            [];


        /*
         * Header
         */

        output.push(
            '| ' +
            parsedRows[0]
                .join(
                    ' | '
                ) +
            ' |'
        );


        /*
         * Separator
         */

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


        /*
         * Body
         */

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
     * 此时代码块已经被替换成 placeholder。
     *
     * 因此这里压缩普通正文空行，
     * 不会破坏代码内部换行。
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

            /*
             * 修复你提到的：
             *
             * “每次会换很多很多行”
             *
             * 普通 Markdown 正文最多只保留：
             *
             * 一个空白行
             *
             * 即：
             *
             * \n\n
             *
             * 而不是以前可能出现的：
             *
             * \n\n\n
             */

            .replace(
                /\n{3,}/g,
                '\n\n'
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
         * 代码块必须优先冻结。
         */

        const preparedCode =
            prepareCodeMetadata(
                liveRoot
            );


        /*
         * 然后冻结数学公式。
         */

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
             * 清除真实页面上的临时 attributes。
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
         * 从 clone 中移除按钮/UI。
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
         * 代码块：
         *
         * ↓
         *
         * placeholder
         */

        replacePreparedCodeWithPlaceholders(
            clone,
            preparedCode.metadata
        );


        /*
         * LaTeX：
         *
         * ↓
         *
         * $...$
         *
         * 或：
         *
         * $$
         * ...
         * $$
         */

        replacePreparedMath(
            clone,
            preparedMath.metadata
        );


        /*
         * DOM → Markdown
         */

        let markdown =
            cleanupMarkdown(
                nodeToMarkdown(
                    clone
                )
            );


        /*
         * 最后恢复代码块。
         *
         * 这意味着 cleanupMarkdown()
         * 永远不会修改代码内部换行。
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
     * Convert Assistant Turn
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
            '[Copy for md Latex] 当前正文节点：',
            root
        );


        let markdown =
            convertRootToMarkdown(
                root
            );


        /*
         * fallback
         */

        if (
            !markdown &&
            root !== turn
        ) {
            console.warn(
                '[Copy for md Latex] 主正文为空，退回整个 Assistant turn。'
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
                        '[Copy for md Latex] 转换后的 Markdown：\n\n' +
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
                        '[Copy for md Latex] 复制失败：',
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


            /*
             * 已经处理过。
             */

            if (
                turn.getAttribute(
                    TURN_PROCESSED_ATTR
                ) === 'true'
            ) {
                /*
                 * 如果意外存在多个按钮，
                 * 删除多余按钮。
                 */

                existing
                    .slice(1)
                    .forEach(
                        node =>
                            node.remove()
                    );


                continue;
            }


            /*
             * 删除残留旧按钮。
             */

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
        '[Copy for md Latex] Copy for md Latex v0.5.6 已加载。'
    );

})();
