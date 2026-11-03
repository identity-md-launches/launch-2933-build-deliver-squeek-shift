# Squeek Shift design system

## Overview

Squeek Shift is a compact hamster platform arcade for the Squeekchain community. Its visual idea is a small golden hamster moving through a greenhouse garden that becomes a lavender moonlit dream. The game, HUD and action panel take priority; the wallet, wheel readings and personal records are secondary. This revision preserves the existing illustration and layout.

The implementation lives in `index.html`, `src/style.css` and the native Canvas renderer in `src/render.ts`. There is no component framework, external image generation or font download. The share card and favicon are local assets in `public/`, copied into `dist/` during build.

## Colors

Canonical interface tokens are declared in `src/style.css`:

| Token | Value | Role |
| --- | --- | --- |
| `--ivory` | `#f5f7ed` | Warm page background; primary button text |
| `--surface` | `#fbfcf6` | Cards and dialogs |
| `--ink` / `--focus` | `#253c30` | Main text, primary buttons, focus ring |
| `--ink-soft` | `#4a5f52` | Notes, labels and secondary text |
| `--lime` | `#d0e87b` | Jump, selected mode, shop test-coin statement |
| `--lime-deep` | `#a9c94a` | Settled-block progress fill |
| `--line` | `rgba(37, 60, 48, 0.16)` | Card boundaries and separators |
| `--danger` | `#b8401f` | Hearts, signal failures and consequential notes |
| `--lavender` | `#c9c0ea` | Dream palette reference |

The renderer uses day sky `#e6f0d2`, dream sky `#c9c0ea` to `#ece6fb`, hamster fur `#e9a65b` / `#fbe3c0`, spikes `#e2552b` / `#f39a3a`, and coins `#f2c230` with `#b7860f` edges. Status dots also have text labels; game hazards have distinct geometry, not color alone. The subtle page texture is an 18px dot grid, using the ink color at 7% opacity.

The measured solid-background text pairs passed taste@1 contrast checks. The probe explicitly excludes ten boxes over textured/canvas backgrounds; no contrast ratio is claimed for those. The UI has one intentionally light page theme; the dream is a game environment, not a separate page theme.

## Typography

`--font` is `ui-rounded, 'SF Pro Rounded', 'Nunito', 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif`. These are system fallbacks, not bundled or remotely loaded font files. The exact face can vary across platforms.

The five-token scale is `--fs-1` 0.875rem (14px labels/notes), `--fs-2` 1rem (16px body/controls), `--fs-3` 1.125rem (18px card titles/results/primary actions), `--fs-4` 1.375rem (22px tagline, balance and Jump), and `--fs-5` 1.75rem (28px desktop wordmark). Requested weights are 400, 700 and 800. Body line height is 1.5; wordmark 1.1; tagline 1.2; card headings 1.3. Display letter spacing is −0.02em for the wordmark and −0.01em for the tagline. Headings use balanced wrapping. `.num` uses tabular numerals for changing values.

## Layout

Spacing tokens are 4, 8, 12, 16 and 24px. Header, main grid and footer align within a 1200px maximum width. The desktop main grid has a flexible game column and a 320px secondary column, separated by 16px. Cards have 16px padding; their internal groups generally use 8–12px gaps.

At 900px and below, the main grid becomes a single column; secondary cards use an auto-fitting grid with a 260px minimum. At 520px and below, card padding becomes 12px, outer main padding 8px, header logo 32px, wordmark 22px and tagline 18px. At 360px and below, the wordmark becomes 18px. Results use three columns on desktop and two on phones. Actions wrap rather than clipping. The canvas stage retains a 16:10 aspect ratio and scales a fixed logical game world, so phone play uses the same clearable patterns.

At the measured 390×844 viewport, the scene starts at 238px and the free-claim button ends at 651px. Product and main action are visible together. The checked 320, 390 and 1440 widths have no horizontal overflow.

## Elevation and depth

Surfaces are flat, with a low-opacity border and no card shadows. Native modal dialogs use a 45%-opacity forest-green backdrop to separate them from the inert page. The world tag is a translucent ivory label; the temporary game toast uses the dark primary surface.

## Shapes

Cards and dialogs use 20px radii; controls and the scene use 14px; selected mode buttons use 10px within their segmented container; tags and progress tracks use pill radii. The hamster, hearts, coins and scenery are native Canvas/SVG shapes. Keep hazards visually larger than or equal to their collision bounds.

## Components and states

- **Primary action:** dark filled, at least 52px tall. Claim is a separate deliberate operation; after claiming, the same control shows the 1,000-coin start cost. Disabled live entry has an adjacent explanation.
- **Secondary/utility controls:** bordered secondary buttons, underlined header utilities, 44px minimum height. Jump has chartreuse fill and a 64px minimum height. Hover changes the background; press uses scale 0.97; keyboard focus has a 3px ink outline with 2px offset.
- **Mode control:** native buttons with radio semantics and arrow-key support; chartreuse marks the selected mode. Practice is always labelled simulated.
- **Game:** HUD, illustrated stage, then ready/running/paused/results panel. Engine hearts, active timer, score, coins and difficulty remain distinct. Results show authoritative best combo. An unsuccessful ledger finish has an explicit status note and labels its coins uncredited.
- **Wallet/records:** device-local balance and storage notice; separate Live and Practice record rows. If storage stops working, the notice changes to tab-only persistence.
- **Telemetry:** connection text and dot, compact labelled values and settled-block progress. Failure preserves the last validated reading with historical labels and pauses live play.
- **Shop/help:** native dialogs with clear headings and native keyboard behavior. Opening either during play pauses the run; closing does not resume it. Shop packs say Simulate purchase and prominently disclose that there is no real payment.

Transitions name only background color and transform, at 120ms. CSS transitions are minimized under reduced motion. The ready Canvas scene uses both time zero and distance zero with that preference; deliberate gameplay retains necessary movement. Hit shake is suppressed under reduced motion.

## Consistency and review

Reuse the existing tokens and native controls. Keep instructions beside controls, use sentence case, and keep consequential errors explicit. Preserve game-first ordering and the distinction between score, test coins and historical telemetry. Do not add real payment, wallet connections, global rankings or claims of onchain records.

The six-domain review, reproduced defects, fixes, rendered evidence and unperformed checks are recorded in [artifacts/validation.md](artifacts/validation.md). Guidance consulted: Jakub Krehel's [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface) (MIT), and Paul Bakaus's [Impeccable documentation method](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md) (Apache-2.0).
