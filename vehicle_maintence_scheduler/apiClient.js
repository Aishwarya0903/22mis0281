/**
 * Thin client over the evaluation server's depot/vehicle endpoints.
 *
 * We reuse the same token-management logic as the logger by importing
 * its (unexported) getToken via a small shim. To keep things decoupled,
 * we re-implement the auth call here — it's a handful of lines and
 * avoids leaking the logger's internals.
 */

const axios = require('axios');

const BASE_URL =
  process.env.EVAL_BASE_URL || 'http://4.224.186.213/evaluation-service';

let token = null;
let tokenExpiresAtMs = 0;

async function getToken() {
  const now = Date.now();
  if (token && now < tokenExpiresAtMs - 30_000) return token;

  const { data } = await axios.post(`${BASE_URL}/auth`, {
    email:        process.env.EVAL_EMAIL,
    name:         process.env.EVAL_NAME,
    rollNo:       process.env.EVAL_ROLL_NO,
    accessCode:   process.env.EVAL_ACCESS_CODE,
    clientID:     process.env.EVAL_CLIENT_ID,
    clientSecret: process.env.EVAL_CLIENT_SECRET,
  }, { timeout: 8000 });

  token = data.access_token;
  tokenExpiresAtMs = Number(data.expires_in) * 1000;
  return token;
}

async function authedGet(path) {
  const t = await getToken();
  const { data } = await axios.get(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${t}` },
    timeout: 8000,
  });
  return data;
}

async function fetchDepots() {
  const data = await authedGet('/depots');
  // Response shape: { depots: [{ ID, MechanicHours }, ...] }
  if (!data || !Array.isArray(data.depots)) {
    throw new Error('Depot API returned unexpected shape');
  }
  return data.depots;
}

async function fetchVehicleTasks() {
  const data = await authedGet('/vehicles');
  // Response shape: { vehicles: [{ TaskID, Duration, Impact }, ...] }
  if (!data || !Array.isArray(data.vehicles)) {
    throw new Error('Vehicles API returned unexpected shape');
  }
  return data.vehicles;
}

module.exports = { fetchDepots, fetchVehicleTasks };
