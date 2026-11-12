// The developers' secret. `node tools/riddle.mjs` prints the riddle; `node tools/riddle.mjs "<answer>"` checks an answer.
// Only a hash of the answer is stored here, so reading this file does not give it away: you have to run the rules.
import crypto from 'node:crypto';

const RIDDLE = `THE STEWARD WHO STOOD STILL

The game's rules are pure functions in src/logic.mjs: no browser, no clock, no randomness you cannot reproduce.

Start the world level (src/course.world.mjs). Kai never moves and never presses a key. Step the rules exactly 36,000 times
(ten minutes of game time at sixty steps a second). The creatures get on with their lives without him.

  1. How many creatures live in the grounds at the end?
  2. How many of them are kits?
  3. On which island was the last kit born? (the island's id in the level data)
  4. On which step was it born? (the first step is step 1)

Answer with the four values separated by spaces, for example:   node tools/riddle.mjs "12 1 B 400"

The answer belongs to the rules as they were when this riddle was written (riddle 1). If the creatures' rules change, the
riddle is retired and a new one takes its place.`;

// sha256('skyground-citadel:riddle-1:' + the answer, lower-cased, single spaces)
const ANSWER_HASH = 'a95948c90c98029891c24e3850420e7590f6f0b61353fed681f9699625c67dbf';

const given = process.argv.slice(2).join(' ').trim().toLowerCase().replace(/\s+/g, ' ');
if (!given) {
  console.log(RIDDLE);
} else {
  const hash = crypto.createHash('sha256').update('skyground-citadel:riddle-1:' + given).digest('hex');
  if (hash === ANSWER_HASH) {
    console.log('Yes. That is what the grounds do when nobody is watching.');
    console.log('Your answer is your proof: send it privately (see SECRETS.md), and say how you got it.');
  } else {
    console.log('No. The creatures disagree.');
    process.exitCode = 1;
  }
}
