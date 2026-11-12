# Skyground Citadel

A 3D platform game that started as a single AI-generated video of a boy running across floating islands, and is being turned
into something you can play, in the open, one pass at a time.

**Play it:** https://numonic-skyground-citadel.vercel.app (a work in progress; a keyboard or a gamepad, and a desktop browser)

**Tell us what broke or bored you:** https://discord.gg/tejSd5SkeD

You are Kai, steward of the citadel grounds. Carry creatures that are out of place back to where they live, wake the dry
springs with sky gems, and make your way across six areas to the citadel gate. If you fall, the islands' vines catch you and
you climb back.

## How it is made

- The level, the rules, the renderer, the music and the sound effects are code in this repository. All sound is synthesised
  in the browser; there are no audio files.
- The models and textures were generated from frames of the source video (see `ASSETS.md`).
- The code was written by an AI model (Claude) working from a design document and from human playtest notes. Each pass
  answers one playtest. Comments in the source say why things are the way they are.
- Before it was shown, five independent AI players that had never seen the code played it through a text interface
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
| X | Pick up or set down a creature, wake a spring, or send a gust |
| Enter at a way-crystal | Travel to a neighbouring crystal you have reached, for a coin |
| Mouse drag, R F, T G | Turn and tilt the camera |
| P, M | Pause, sound |

## Known limits

- Frame rate has not been tuned for low-end machines; the game lowers its own resolution when frames run long.
- Desktop only: there are no touch controls.
- One level. The citadel doors open at the end; what is inside is not built.

## Licence

Code: MIT (see `LICENSE`). Assets: CC BY 4.0, distributed separately (see `ASSETS.md`).

Built by [Numonic Labs](https://numonic.ai). Every version, playtest and decision behind this game was filed as it happened;
ask in the Discord if you want to see the full archive.
