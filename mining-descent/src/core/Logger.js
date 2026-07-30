// =============================================================================
// Logger — structured logging with levels. Global threshold controls verbosity.
// =============================================================================

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 };

let _threshold = LEVELS.INFO; // can be overridden via query param ?log=debug

export const Logger = {
  LEVELS,

  setThreshold(level) {
    _threshold = typeof level === 'string' ? (LEVELS[level.toUpperCase()] ?? LEVELS.INFO) : level;
    console.log(`[Logger] threshold set to ${_threshold === 0 ? 'DEBUG' : _threshold === 1 ? 'INFO' : _threshold === 2 ? 'WARN' : 'ERROR'}`);
  },

  debug(tag, msg, data) {
    if (_threshold <= LEVELS.DEBUG) console.debug(`[DBG:${tag}]`, msg, data !== undefined ? data : '');
  },

  info(tag, msg, data) {
    if (_threshold <= LEVELS.INFO) console.log(`[${tag}]`, msg, data !== undefined ? data : '');
  },

  warn(tag, msg, data) {
    if (_threshold <= LEVELS.WARN) console.warn(`[WARN:${tag}]`, msg, data !== undefined ? data : '');
  },

  error(tag, msg, data) {
    if (_threshold <= LEVELS.ERROR) console.error(`[ERR:${tag}]`, msg, data !== undefined ? data : '');
  },
};
