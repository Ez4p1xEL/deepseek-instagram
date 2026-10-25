// In-process test runner.
//
// `node --test` spawns one child process per file; inside the DSH file sandbox that
// spawn fails (named pipe EPERM), so we import every test file into this single process
// instead. node:test still registers and reports the tests, and the process exits
// non-zero when anything fails.
import './usage.test.mjs';
import './content.test.mjs';
import './safety.test.mjs';
import './dshusage.test.mjs';
import './tools.test.mjs';
import './apply.test.mjs';
import './client.test.mjs';
import './persona.test.mjs';
import './reply.test.mjs';
import './singleflight.test.mjs';
import './plan.test.mjs';
import './commands.test.mjs';
import './actions.test.mjs';
import './unread.test.mjs';
import './pricing.test.mjs';
import './spend.test.mjs';
import './features.test.mjs';
