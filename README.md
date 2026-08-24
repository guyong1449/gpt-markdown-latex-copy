# gpt-markdown-latex-copy

A userscript that adds a `Copy for md Latex` button to ChatGPT assistant messages and copies the response as Markdown while preserving LaTeX and code-block formatting.

## Features

- Adds a `Copy for md Latex` button below ChatGPT assistant responses.
- Preserves inline and display LaTeX as Markdown math.
- Preserves fenced code blocks, language labels, indentation, and real line breaks.
- Converts headings, emphasis, links, blockquotes, lists, and tables to Markdown.
- Removes ChatGPT copy/UI controls from copied content.

## Install

Install a userscript manager such as Tampermonkey or Violentmonkey, then install:

`gpt-markdown-latex-copy.user.js`

After this repository is pushed to GitHub, the raw userscript URL is:

`https://raw.githubusercontent.com/guyong1449/gpt-markdown-latex-copy/main/gpt-markdown-latex-copy.user.js`

## Repository

`https://github.com/guyong1449/gpt-markdown-latex-copy`

## Push this prepared repository

This ZIP already contains a local `.git` repository with branch `main` and an initial commit. After extracting it, run:

```bash
git remote add origin https://github.com/guyong1449/gpt-markdown-latex-copy.git
git branch -M main
git push -u origin main
```
