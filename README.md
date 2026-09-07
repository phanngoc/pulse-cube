# Pulse Cube

An original one-button auto-running platformer. The cube runs on its own and
never stops; you have exactly one input — jump. Three hand-built levels, a
backing track generated in the browser at each level's own tempo, and a
practice mode with checkpoints for the parts that keep killing you.

Plays on desktop (mouse or keyboard) and on phones (touch). No install, no
backend, no accounts, no ads.

![Desktop gameplay](docs/desktop-play.png)

| Menu | Death | Cleared | Phone |
| --- | --- | --- | --- |
| ![menu](docs/desktop-menu.png) | ![death](docs/desktop-over.png) | ![cleared](docs/desktop-clear.png) | ![mobile](docs/mobile-play.png) |

## Gameplay

The cube moves right at a fixed 10.4 cubes per second. Pressing the button
jumps; holding it jumps again the instant you land, which is how you take a run
of obstacles without perfect timing on each one.

- **Spikes** kill on contact.
- **Ledges** are thin: at floor level the cube runs *underneath* them, but
  clouting the **side** of one mid-jump is fatal. Landing on top is how you
  climb.
- **Pads** (yellow) fling the cube higher and further than any jump can reach.
  Long gaps are built around them.
- Falling into a **gap** ends the run.

Two modes:

- **Normal** — one life. Dying restarts the level from the beginning, and your
  furthest run through that level is saved to your browser.
- **Practice** — checkpoint flags along the level become live. Dying puts you
  back at the last flag you passed, and the attempt counter keeps climbing.
  Practice runs never write a best score, because starting from the middle is
  not comparable to a clean run.

The bar across the top is how far through the level you are. The percentage you
died at is the score.

### The three levels

| # | Name | BPM | Length | What is new |
| --- | --- | --- | --- | --- |
| 1 | First Light | 128 | 186 | One obstacle at a time, always with a long run-up. Never two jumps back to back. |
| 2 | Split Signal | 140 | 224 | Gaps and platforms in the same breath, spike pairs, the first two-tier climb, one pad. |
| 3 | Overdrive | 152 | 262 | Triple spikes, back-to-back climbs, spikes standing on platforms, pads over gaps no jump reaches. |

Every obstacle is placed by hand against the actual jump arc, and the test
suite re-derives that arc and then **plays each level with a bot** — so a level
that is not beatable fails the build rather than shipping.

### The beat

There are no audio files. The backing track is scheduled onto the WebAudio
clock — kick on every beat, hat on the off-beat, a bass line over an 8-beat
pattern — at the level's own BPM, and the whole scene (background, spikes,
platform edges, the cube) pulses on the same beat. Because level time is
derived from position (`time = x / SPEED`), a checkpoint respawn drops you back
in on the correct bar instead of restarting the bar at 1.

## Controls

| Action | Desktop | Touch | Keyboard |
| --- | --- | --- | --- |
| Jump | click anywhere | tap anywhere | `Space`, `↑`, `W` or `Enter` |
| Continue / restart | click, or the button | tap, or the button | any jump key |
| Pause / resume | `P` or `Esc`, or the Pause button | Pause button | `P` / `Esc` |
| Mute | `M`, or the Sound button | Sound button | `M` |

The jump button is also "continue" on every non-playing screen, so one finger
drives the whole game.

## Install, dev, build

Requires Node 20+.

```bash
npm ci          # install exactly what the lockfile pins
npm run dev     # http://localhost:5173
npm run build   # tsc --noEmit && vite build  ->  dist/
npm run preview # serve the production build on :4173
npm test        # 31 unit tests (vitest, no browser)
npm run smoke   # 64 browser checks (Playwright); writes docs/*.png
```

`npm run smoke` needs a Chromium: `npx playwright install chromium`.

## Architecture

```
src/
  main.ts            wires DOM elements into Game, exposes window.pulseCube
  style.css          responsive HUD / progress bar / overlay chrome
  game/
    types.ts         state shapes
    config.ts        every tunable number - speed, gravity, jump, camera
    levels.ts        the three levels, as hand-placed geometry
    logic.ts         THE SIMULATION - pure, no DOM, no canvas, no timers
    render.ts        canvas drawing; reads state, writes nothing back
    input.ts         one button, from keyboard and pointer
    audio.ts         WebAudio synthesis + the scheduled beat (no audio files)
    storage.ts       localStorage best-per-level / mute, failure-tolerant
    game.ts          shell: rAF loop, HUD, overlay, pause, level/mode picking
```

The numbers everything else is built on, all in `config.ts`:

```
SPEED   10.4 cubes/s      jump peak      2.60 cubes
GRAVITY 127               jump air time  0.405 s
JUMP_V  25.7              jump covers    4.21 cubes of ground
PAD_V   33.5              pad covers     5.48 cubes
```

Platform tops therefore sit at 2 (reachable from the floor) and 4 (reachable
from a platform at 2); floor gaps stay at or under 2.8 cubes, and only a pad is
ever asked to clear more. Retuning any of those numbers without re-running the
bot test will silently break a level.

Three details worth knowing before changing anything:

- **Collision runs on fixed 1/240s slices**, not on the frame. At 10.4 cubes/s
  a 50ms frame moves the cube half its own width, which is enough to clip the
  corner of a spike or skip a landing entirely.
- **Solid geometry is tested against the exact cube; only spikes get a
  forgiving inset.** Insetting the cube for blocks too leaves a sliver of air
  under it that gravity cannot close within one slice, and the cube falls
  through its own floor. That was a real bug here, caught by the tests.
- **The camera scale is uniform on both axes.** The width is clamped to keep
  the road ahead readable and the height is *derived* from the real aspect
  ratio — fixing both independently stretches the pixels, and a stretched cube
  is a rectangle. That was the second real bug, caught by looking at a phone
  screenshot.

`step()` clamps a single frame delta to 1/20s so a backgrounded tab cannot
resume by teleporting the cube through a wall.

## Verification

Run on macOS (arm64), Node v24.13.0:

```
$ npm test
 Test Files  1 passed (1)
      Tests  31 passed (31)

$ npm run build
✓ built in 87ms      dist/assets/index-*.js 21.0 kB │ gzip 7.6 kB

$ npm run smoke
64/64 checks passed
```

The unit tests cover the jump arc, no double-jumping, the input buffer and
coyote window, all three death causes, checkpoint ordering, practice-vs-normal
respawn, attempt counting, progress and clearing, the camera clamp and uniform
scale, and the frame-delta clamp. They also **play every level with a
one-button lookahead bot** and assert that each one is completable, and that
jumps-per-cube strictly increases from level 1 to 3.

The smoke test drives the real production build in Chromium at 1280×800 and at
an iPhone 13 viewport, asserting against live simulation state rather than
pixels: the cube auto-runs, the progress bar advances, `Space` and a real
click/tap both jump, pause freezes the cube and hides the level picker, dying
throws debris and shows the percentage, normal mode restarts from the start,
reaching the finish clears the level, practice mode respawns exactly at the
last checkpoint and keeps counting attempts, mute round-trips, and no console
errors occur.

## Source reference

Inspired by **Geometry Dash Lite** (RobTop Games) —
<https://apps.apple.com/us/app/geometry-dash-lite/id698255242> — as a genre
reference only. This project shares no code, art, audio, level data, names or
branding with it. The levels, the music and every pixel here were written from
scratch for this repository.

## Assets and licence

There are no asset files. Every block, spike, pad, flag and particle is drawn
with Canvas 2D primitives at run time, and every sound — including the backing
track — is synthesised with WebAudio oscillators and generated noise buffers.
Nothing is downloaded, so there is nothing to attribute.

Code: MIT, see [LICENSE](LICENSE).

## Known limitations

- **Portrait phones show a lot of empty sky.** Keeping the pixel scale uniform
  and the road ahead wide enough to react to forces it; landscape is the better
  orientation on a phone. Letterboxing the playfield would fix it and is not
  done.
- **Three levels, no editor.** There is no level format on disk and no way to
  add a level without editing `levels.ts` and re-running the bot test.
- No coins, no ship/wave sections, no speed portals — the mechanic set stops at
  jump, land, pad.
- Best progress is per-browser `localStorage`, per level, no accounts or
  leaderboard. Private-browsing modes that block storage fall back to
  session-only bests.
- The beat is generated but the *level* is not generated from it: obstacles are
  spaced to feel on-tempo, not snapped to a grid derived from the BPM.
- Audio needs a user gesture to start (browser autoplay policy), so the track
  begins on the first tap or key press.
- `npm audit` reports two advisories, both devDependency-only and neither
  reachable from the shipped bundle: `esbuild` via Vite 5's dev server, and
  Playwright's `<1.55` downloader. They are left unforced rather than pinned
  past what the lockfile resolves.
