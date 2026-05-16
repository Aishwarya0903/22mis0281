const axios = require('axios');

const BASE_URL =
  process.env.EVAL_BASE_URL || 'http://4.224.186.213/evaluation-service';

let token = null;
let tokenExpiresAtMs = 0;

async function getToken() {
  if (token && Date.now() < tokenExpiresAtMs - 30_000) return token;

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

async function fetchNotifications() {
  const t = await getToken();
  const { data } = await axios.get(`${BASE_URL}/notifications`, {
    headers: { Authorization: `Bearer ${t}` },
    timeout: 8000,
  });
  if (!data || !Array.isArray(data.notifications)) {
    throw new Error('Notifications API returned unexpected shape');
  }
  return data.notifications;
}

module.exports = { fetchNotifications };
