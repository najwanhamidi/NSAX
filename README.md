# NSA Pacer — Norwegian Singles Approach calculator & workout analyzer

Two builds of the same app, generated from one codebase (`src/`):

| Folder | What it is |
|---|---|
| `mobile/` | Mobile-first PWA (bottom tab bar, installable, works offline). **Host this on GitHub Pages.** |
| `desktop/NSA-Pacer-Desktop.html` | Single self-contained file (sidebar layout, wide charts). Double-click to open in Chrome/Edge/Firefox — no install, no internet needed (internet only for the optional AI coach). |

## What it does
- **Inputs (saved on device):** LTHR, optional max HR, units (min/km or min/mi), one or more recent race results (1500 m → marathon, or custom distance), pace model.
- **Paces:** VDOT from your race → sub-threshold pace for 3 / 6 / 10-min sessions, **plus any rep length** (custom time or distance calculator, tables by duration and by distance), recovery windows, easy-run HR cap and pace range, LTHR zones, race equivalents.
- **Heart-rate targets from LTHR:** end-of-rep HR progression (early reps 10–15 bpm below LTHR → later reps approach LTHR), expected average HR per rep (HR lag), easy cap ≈ 70 % HRmax (estimated from LTHR if not entered), never-exceed LTHR.
- **Workout analysis:** upload `.fit`, `.gpx`, `.tcx` (or `.gz`). Detects warm-up, every rep, every rest and cool-down automatically — **any rep length, ladders, custom sets**. Uses workout steps/laps when the file has them, otherwise pace changes. Scores 0–100 against *your* LTHR and race-derived targets (pace 35, HR 25, consistency 20, recoveries 10, structure 10), with rule-based insights and suggestions. Easy runs are scored on HR cap, pace, time over cap and cardiac drift.
- **AI coach (optional):** bring your own API key (Anthropic, OpenAI, Gemini or any OpenAI-compatible endpoint). Only a numeric summary is sent (no GPS). No key? Use **Copy prompt** and paste it into any chat app.
- **History** of scores with a trend chart; **Export/Import** backup.

## Publish the mobile version on GitHub Pages
1. Create a GitHub repository (e.g. `nsa-pacer`).
2. Upload the **contents of the `mobile/` folder** to the repo root (include the hidden `.nojekyll` file if your uploader shows it; it's optional).
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
4. Open `https://<your-username>.github.io/nsa-pacer/` on your phone → browser menu → **Add to Home Screen**.

(Alternatively put the files in a `/docs` folder and choose `/docs` in Pages.)

## Rebuild after editing the source
```
node build.js        # regenerates out/mobile and out/desktop
```
Source files: `src/core.js` (pace/HR model), `parsers.js` (FIT/GPX/TCX), `analyze.js` (detection + scoring), `ai.js`, `ui.js`, `style.css`.

## Method & sources
- Norwegian Singles guide — https://norwegiansingles.run/section1_core_principles.html : rep guide (≈3 min ↔ 12–15K pace, ≈6 min ↔ 20K/HM pace, ≈10 min ↔ 25–30K pace), recoveries 60 s / 60–90 s / 90–120 s, early reps finish 10–15 bpm under LTHR, easy HR ≲ 70 % HRmax, sub-threshold ≈ 20–25 % of weekly time.
- Copeland/Zimmerman *Norwegian Singles Method* 5K-based pace table (3/6/10-min reps + easy pace), as published in https://fwdmotionsthlm-newsletter.beehiiv.com/p/norwegian-singles-explained
- https://marathonhandbook.com/norwegian-singles-training/ (lactate ranges, session examples)
- Daniels & Gilbert VDOT equations; Friel %LTHR running zones.

Pace for an arbitrary rep duration = pace of the equivalent race distance on the guide curve (log-interpolated through the 3/6/10-minute anchors, clamped between 10K and marathon pace), averaged with the Copeland table in "Blend" mode (the two agree within ~3–10 s/km for 15–30 min 5K runners).

## Privacy
Everything runs in your browser. Inputs/history live in `localStorage`. Workout files are never uploaded. AI requests (only if you press the button) go directly from your device to the provider you chose; your key is stored only on your device (untick "Remember key" to avoid that).

*Guidance only, not medical or coaching advice.*
