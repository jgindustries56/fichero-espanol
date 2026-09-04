---
description: Full upgrade pass on Fichero de Español — psychology-backed improvements, replacements and new features across every area, fully tested, then deployed.
---

Run a complete upgrade pass on the Fichero de Español Spanish study app (repo: `jgindustries56/fichero-espanol`, deployed on Railway at the project's live domain — check `mcp__Railway__get-status` / `list-domains` if the URL isn't already in context). This is a standing command the project owner runs periodically; treat it exactly like the earlier work in this project's history, not a one-off ad hoc task.

**`index.html` at the repo root is the single source of truth for the entire app** — all HTML, CSS, and JS live inline in that one file (a vanilla-JS SPA, no build step, no framework). `server.js` is the Express backend (Google sign-in, per-user progress storage on a mounted Railway volume, and a best-effort Google Sheets mirror). There is no separate template file to keep in sync — edit `index.html` directly.

## 0. The two standing rules

**Rule 1 — never add language content on your own initiative.** Do not add, invent, or "fill in" Spanish vocabulary, verbs, conjugations, grammar rules, example sentences, passages, or exercise content unless the owner has explicitly asked for it in this session. Every deck, drill, exam, and reference sheet must be a *re-cut of the cards that already exist*, not new material. If a feature idea can only work with new content (cloze passages, reading comprehension, listening scripts), build nothing and say plainly what content you'd need from him instead. `test-app.js` enforces this with a card-count and topic-count assertion — if that test fails, content was added; do not "fix" it by editing the expected number unless the owner asked for the content.

**Rule 2 — when he *does* ask for new content, it goes everywhere.** New vocabulary, verbs or grammar must be wired into every part of the app it can reach, not just one page: its own topic entry and builder function, a `RULES` entry so Guided Exercises and the Reference Sheet both work, flashcards, quiz/test pools, matching, typed and multiple-choice rendering, the listening and full-sentence decks where the answer shape qualifies, the Report Card breakdowns, and the expected-forms table in `test-accuracy.js`. A topic that only shows up in one place is a half-finished topic.

**Every change gets a reason from learning science.** Not decoration — the mechanism should actually be why the feature is shaped the way it is (spacing and retrieval practice, the generation effect, desirable difficulties, dual coding, interleaving, worked examples, goal-setting, implementation intentions, loss aversion, self-referenced feedback, cognitive load). Say which effect and, where it is a specific published finding, name it. If a feature has no defensible mechanism behind it, it does not ship. Be honest about the limits too: note where an effect is contested, where it only applies under certain conditions (speed pressure helps *mastered* material and hurts new material), and where a design could backfire (social comparison demotivating whoever is behind).

## 1. Sweep every area, in one pass
"Do it in one go, across every possible area" is the standing scope. Work through all of these each time rather than picking one:

- **Study modes / decks** — new ways to practise the existing cards, and replacements for anything weaker.
- **Home** — what makes opening the app today an obvious thing to do.
- **History / Report Card** — can he see whether he is actually improving.
- **Settings** — is the difficulty, length, and cadence his to tune.
- **Reference / printables** — the non-quizzing use of the same data.
- **Visual and layout** — real contrast measurement (compute the ratios, do not eyeball them), breakpoints including tablet and landscape-mobile, icons, spacing.
- **Correctness** — genuine bugs, broken interactions, silent wrong behaviour, edge cases.
- **Backend** — sync-conflict handling, atomic writes, session lifetime, anything in `server.js` that could lose or corrupt his progress.

Quality over volume: a small number of well-justified changes beats a pile of speculative ones, and "nothing concrete presents itself here beyond polish" is an acceptable, expected answer for any one area. Never pad with busywork, and never guess wildly at an open-ended ask — do the concrete engineering and report clearly what was and was not done.

## 2. Make the changes
Standard engineering discipline: no unnecessary abstractions, no comments explaining *what* code does (only non-obvious *why*), minimal diffs for bug fixes, and real design-system consistency — reuse the existing CSS custom properties and component classes in `index.html` rather than inventing a parallel style. Anything new must degrade gracefully when a capability is missing (no speech synthesis, no `Blob`, no `documentElement`) rather than throwing.

## 3. Test before claiming anything works
```
npm test
```
Runs, in order: `test-auth.js` (Google ID-token verification and Sheets service-account JWT signing against locally generated key pairs), `test-routes.js` (auth gating, cross-user isolation, disk persistence, session-complete), `test-app.js` (headless logic plus real simulated clicks through every page, topic, and study method), `test-accuracy.js` (every conjugated form across all ~47 verbs against hand-verified expected forms, plus ser/estar, pero/sino, and negative-transform checks).

Every feature you add gets its own test in the same pass — not afterwards. Gated features get two: one proving the gate holds when the deck is empty or unsupported, one proving it opens when it should no longer be gated.

Then take one real look in a browser — this project has hit bugs a headless harness cannot see (a template-substitution bug that only broke in a real script parser, a full-page jitter from over-eager re-rendering). Playwright is available:

```
npm i -D playwright   # if not already present
# launch: chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
```

Load the local `index.html` over `file://`, seed `localStorage` so the data-driven surfaces are not empty, screenshot each page, check for console and page errors, and check at least one tablet width and one landscape-mobile viewport. One look, fix what it shows, move on — not a screenshot loop.

## 4. Deploy
1. `git add` the changed files, commit with a message explaining *why*, push to `main`.
2. Railway auto-deploys on push. Poll `mcp__Railway__get-status` (and `get-logs` with `types:["deploy"]`) until the new deployment reaches `SUCCESS` and the container log shows the server actually starting — do not declare done on `BUILDING`/`DEPLOYING`.
3. If a build or deploy fails, read the logs, fix the real cause, and push again — do not retry blindly.
4. If the environment has no push credentials, say so immediately and hand over the exact commands he needs to run, rather than reporting the work as deployed.

## 5. Report back
Concretely: what changed and the mechanism behind each change, what was tested and how (cite specific test results, not "should work"), the contrast numbers if colours moved, and the deploy status. Say explicitly what you deliberately did **not** build and why — especially anything blocked by Rule 1 — and what you would need from him to unblock it. If part of the ask was too vague to act on, say exactly what you need rather than guessing.

Finish with a plain-English summary of the whole pass.
