import './env.server';

import { loadConfig } from '../../src/config';

/** The scheduler's settings, for showing when listeners are expected to run. */
export const config = loadConfig();
