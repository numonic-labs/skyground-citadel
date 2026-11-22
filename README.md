# Skyground Citadel

A 3D platform game that started as a single AI-generated video of a boy running across floating islands, and is being turned
into something you can play, in the open, one pass at a time.

**Play it:** https://numonic-skyground-citadel.vercel.app (a work in progress; a keyboard or a gamepad, and a desktop browser)

**Tell us what broke or bored you:** https://discord.gg/uVDQmtT66g

You are Kai, groundskeeper of the citadel. A season ago the grounds went untended (the Lapse); you are back, and the citadel
has sealed itself. Carry creatures that are out of place back to where they live, wake the dry springs with sky gems, and
make your way across six areas to the citadel gate. The gate is locked, and its key is held by Ossa, the Granmoss, too big
to carry, somewhere on the grounds. Where it is, and what it wants (company, a hoard, food or a story), is different every
playthrough: listen to the gate-keeper, to the creatures you take home and to the brambles, and keep your notes (J). If you
fall, the islands' vines catch you and you climb back. There is no clock.

## How it is made

- The level, the rules, the renderer, the music and the sound effects are code in this repository. All sound is synthesised
  in the browser; there are no audio files.
- The models and textures were generated from frames of the source video (see `ASSETS.md`).
- The code was written by an AI model (Claude) working from a design document and from human playtest notes. Each pass
  answers one playtest. Comments in the source say why things are the way they are.
- Before the first version was shown, five independent AI players that had never seen the code played it through a text interface
  (`tools/agent_play.mjs`) against pass criteria written down in advance. All five reached the gate. They found it easy.

## Run it

```
npm install
# put the assets in assets/ (see ASSETS.md)
npm run serve          # http://127.0.0.1:8137/
npm test               # the rules, in Node: no browser and no assets needed
```

There is no build step. `src/logic.mjs` is the whole game as pure, deterministic functions with no browser in it;
`src/main.js` draws it with three.js; `src/course.world.mjs` is the level as data.

`npm run build:site` writes the folder that is deployed, and `npm run check:site` loads it in a headless browser
(this needs Playwright's Chromium).

## Controls

| Keys | What they do |
| --- | --- |
| W A S D or arrows | Move |
| Space | Jump, and again in the air |
| E | Take a vine bloom's hand; Space lets go |
| X | Pick up or set down a creature, wake a spring, send a gust, or give Ossa what it wants |
| Enter at a way-crystal | Travel to a neighbouring crystal you have reached, for a coin |
| Mouse drag, R F, T G | Turn and tilt the camera (C resets it, V switches the automatic camera off and on) |
| J | Your notes: the clues you have heard |
| P, M | Pause, sound |

Each page load is a new run. Add `?run=N` to the address to play run N again (the finish card shows the number); `?bot` watches
the scripted player.

## Secrets

There are things in the game that nothing on screen points at, and one that can only be found by running the code:
`npm run riddle`. Finding them earns access, not prizes. See `SECRETS.md`, and do not post what you find in public.

## Contributing

This repository is the game's source of truth: what is merged here is what gets deployed. Pull requests are welcome; read
`CONTRIBUTING.md` first.

## Known limits

- Frame rate has not been tuned for low-end machines; the game lowers its own resolution when frames run long.
- Desktop only: there are no touch controls.
- One level. The citadel doors open at the end; what is inside is not built.

## Licence

Code: MIT (see `LICENSE`). Assets: CC BY 4.0, distributed separately (see `ASSETS.md`).

Built by [Numonic Labs](https://numonic.ai). Every version, playtest and decision behind this game was filed as it happened;
ask in the Discord if you want to see the full archive.
