

const axios = require('axios');

const BASE_URL =
  process.env.EVAL_BASE_URL || 'http://4.224.186.213/evaluation-service';

// Valid enums from the spec. Lower-case only.
const STACKS = new Set(['backend', 'frontend']);
const LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const BACKEND_PKGS = new Set([
  'cache', 'controller', 'cron_job', 'db', 'domain',
  'handler', 'repository', 'route', 'service',
]);
const FRONTEND_PKGS = new Set([
  'api', 'component', 'hook', 'page', 'state', 'style',
]);
const SHARED_PKGS = new Set(['auth', 'config', 'middleware', 'utils']);

// ---- Token cache ---------------------------------------------------------

let tokenCache = {
  value: null,
  expiresAtMs: 0,
  inflight: null,   
};

const TOKEN_SAFETY_WINDOW_MS = 30_000;   

function readCredentials() {
  const creds = {
    email:        process.env.EVAL_EMAIL,
    name:         process.env.EVAL_NAME,
    rollNo:       process.env.EVAL_ROLL_NO,
    accessCode:   process.env.EVAL_ACCESS_CODE,
    clientID:     process.env.EVAL_CLIENT_ID,
    clientSecret: process.env.EVAL_CLIENT_SECRET,
  };

  const missing = Object.entries(creds)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    const err = new Error(
      `Missing env vars for logging middleware: ${missing.join(', ')}`
    );
    err.code = 'EVAL_CREDS_MISSING';
    throw err;
  }
  return creds;
}

async function fetchFreshToken() {
  const creds = readCredentials();
  const { data } = await axios.post(`${BASE_URL}/auth`, creds, {
    timeout: 8000,
  });

 
  const expiresAtMs = Number(data.expires_in) * 1000;

  return {
    value: data.access_token,
    expiresAtMs,
  };
}

async function getToken() {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAtMs - TOKEN_SAFETY_WINDOW_MS) {
    return tokenCache.value;
  }

  // If a refresh is already in flight, ride along on it.
  if (tokenCache.inflight) {
    return tokenCache.inflight;
  }

  tokenCache.inflight = (async () => {
    try {
      const fresh = await fetchFreshToken();
      tokenCache.value = fresh.value;
      tokenCache.expiresAtMs = fresh.expiresAtMs;
      return fresh.value;
    } finally {
      tokenCache.inflight = null;
    }
  })();

  return tokenCache.inflight;
}



function validate(stack, level, pkg) {
  if (!STACKS.has(stack)) {
    throw new Error(`Invalid stack "${stack}". Must be one of: ${[...STACKS].join(', ')}`);
  }
  if (!LEVELS.has(level)) {
    throw new Error(`Invalid level "${level}". Must be one of: ${[...LEVELS].join(', ')}`);
  }

  const allowed =
    stack === 'backend'
      ? new Set([...BACKEND_PKGS, ...SHARED_PKGS])
      : new Set([...FRONTEND_PKGS, ...SHARED_PKGS]);

  if (!allowed.has(pkg)) {
    throw new Error(
      `Invalid package "${pkg}" for stack "${stack}". ` +
      `Allowed: ${[...allowed].sort().join(', ')}`
    );
  }
}



async function Log(stack, level, pkg, message) {
  try {
    validate(stack, level, pkg);
  } catch (validationError) {
  
    return { ok: false, reason: 'validation', error: validationError.message };
  }

  let token;
  try {
    token = await getToken();
  } catch (authError) {
    return { ok: false, reason: 'auth', error: authError.message };
  }

  try {
    const { data } = await axios.post(
      `${BASE_URL}/logs`,
      { stack, level, package: pkg, message: String(message) },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      },
    );
    return { ok: true, data };
  } catch (err) {
    
    if (err.response && err.response.status === 401) {
      tokenCache = { value: null, expiresAtMs: 0, inflight: null };
    }
    return {
      ok: false,
      reason: 'request',
      status: err.response && err.response.status,
      error: err.message,
    };
  }
}

module.exports = { Log };
