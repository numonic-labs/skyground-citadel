# Contributing

This repository is the game's source of truth. Changes made here are what gets deployed.

## Before you open a pull request

- `npm test` passes. The rules in `src/logic.mjs` are pure and deterministic, and most changes to them need a test in
  `test/`. A change to how the level plays should come with a test that would have failed before it.
- Keep `src/logic.mjs` free of the browser: no DOM, no three.js, no clock, no `Math.random()`. The tests, the scripted
  player and the AI playtest all run it in Node.
- Say what a player will notice. "The raft waits a second longer at the dock" is a better description than "tweak raft".
- One change per pull request. Small ones are read sooner.
- If your change alters how the creatures live, say so: the riddle in `tools/riddle.mjs` depends on those rules and will
  need to be retired.

## What we are looking for

Bug fixes, clearer feedback to the player, performance on modest machines, touch controls, and new secrets. Large changes
to the level or to Kai's abilities are best raised in the Discord first (https://discord.gg/tejSd5SkeD), so you do not
build something that cannot be merged.

## Licences

By contributing code you agree that it is released under the MIT licence in `LICENSE`. Models, textures and other assets
are not kept in this repository; if you want to contribute one, raise it in the Discord. Contributed assets are released
under CC BY 4.0 like the rest (see `ASSETS.md`).

## How pull requests are handled

They are read by a person, in the order they arrive, except that people who have solved the riddle are read first (see
`SECRETS.md`). There is a small team behind this, so an answer can take a week.
