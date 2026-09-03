---
description: Full upgrade pass on Fichero de Español — improvements, new features, and a full accuracy/functionality check, then deploy.
---

Run a complete upgrade pass on the Fichero de Español Spanish study app (repo: `jgindustries56/fichero-espanol`, deployed on Railway at the project's live domain — check `mcp__Railway__get-status` / `list-domains` if the URL isn't already in context). This is a standing command the project owner runs periodically; treat it exactly like the earlier work in this project's history, not a one-off ad hoc task.

**`index.html` at the repo root is the single source of truth for the entire app** — all HTML, CSS, and JS live inline in that one file (a vanilla-JS SPA, no build step, no framework). `server.js` is the Express backend (Google sign-in, per-user progress storage on a mounted Railway volume, and a best-effort Google Sheets mirror). There is no separate template file to keep in sync — edit `index.html` directly.

Work through these steps in order:

## 1. Look for real improvements — not filler
Read through `index.html` and `server.js` with fresh eyes. Look for:
- Genuine bugs: broken interactions, incorrect state, edge cases that crash or silently do the wrong thing.
- UX rough edges: confusing copy, inconsistent behavior between similar features, anything that would visibly jitter, flash, or feel broken in a real browser.
- Content gaps: if the user has provided new textbook pages/photos since the last upgrade, fold that content in following the existing data-driven pattern (topic → items → builder function, same shape as the existing topics). If they haven't provided anything new, don't invent grammar content from nothing.
- A small number of well-justified new features over a pile of speculative ones. Every addition should trace back to something the app or its users actually needs — not "more for the sake of more." If nothing concrete presents itself beyond polish, say so honestly rather than padding with busywork.

Do not guess wildly at open-ended asks. If "add more" doesn't point at anything concrete, do the concrete engineering work (below) and report clearly what was and wasn't done, same as the standing rule for this project.

## 2. Make the changes
Standard engineering discipline applies here same as everywhere else: no unnecessary abstractions, no comments explaining *what* code does (only non-obvious *why*), minimal diffs for bug fixes, real design-system consistency (reuse the existing CSS custom properties and component classes in `index.html` — don't invent a parallel style) for anything new.

## 3. Test before claiming anything works
This repo carries its own test suites — run them:

```
npm test
```

This runs, in order: `test-auth.js` (Google ID-token verification and Sheets service-account JWT signing, against locally generated key pairs — no live Google network needed), `test-routes.js` (Express routes: auth gating, cross-user isolation, disk persistence, session-complete), `test-app.js` (headless logic + real simulated clicks through every page, every topic, every study method, matching, history), `test-accuracy.js` (every conjugated verb form across all ~47 verbs checked against hand-verified expected forms, plus sanity checks on ser/estar, pero/sino, and negative-transform content).

If you changed `index.html`'s content data (new topics/items) or its script structure, `test-app.js`/`test-accuracy.js` may need matching updates (new topic IDs added to loop-based checks, new verbs added to the expected-forms table in `test-accuracy.js`, etc.) — update the tests alongside the feature, not after.

For anything touching layout, animation, or interaction feel (not just logic), take one real look in an actual browser before calling it done — this project has hit real bugs before that a headless harness couldn't see (a template-substitution bug that only broke in a real script parser, a full-page jitter from over-eager re-rendering). Playwright is available:

```
NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node -e "..."
# launch: chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
```

One look, fix what it shows, move on — not a screenshot loop.

## 4. Deploy
1. `git add` the changed files, commit with a message explaining *why* (not just what), push to `main`.
2. Railway auto-deploys on push. Poll `mcp__Railway__get-status` (and `get-logs` with `types:["deploy"]`) until the new deployment reaches `SUCCESS` and the container log shows the server actually starting — don't declare done on `BUILDING`/`DEPLOYING`.
3. If a build or deploy fails, read the logs, fix the real cause, and push again — don't retry blindly.

## 5. Report back
Tell the project owner, concretely: what changed and why, what was tested and how (cite specific test results, not "should work"), and the deploy status. If part of their ask was too vague to act on, say exactly what you need from them rather than guessing.
