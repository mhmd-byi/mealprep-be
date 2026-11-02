const axios = require('axios');
const DeviceToken = require('../models/deviceTokenModel');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

const isExpoToken = (token) => /^(Exponent|Expo)PushToken\[.+\]$/.test(token || '');

const chunk = (list, size) => {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
};

const postToExpo = async (messages) => {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const response = await axios.post(EXPO_PUSH_URL, messages, { headers, timeout: 30000 });
  return Array.isArray(response.data && response.data.data) ? response.data.data : [];
};

const interpretTickets = (messages, tickets) =>
  messages.map((message, index) => {
    const ticket = tickets[index];
    return {
      token: message.to,
      userId: message.userId,
      ok: Boolean(ticket && ticket.status === 'ok'),
      unregistered: Boolean(ticket && ticket.details && ticket.details.error === 'DeviceNotRegistered')
    };
  });

const summariseByUser = (userIds, outcomes, tokensByUser) => {
  const statusByUser = new Map();
  userIds.forEach((userId) => {
    const key = String(userId);
    if (!tokensByUser.has(key)) {
      statusByUser.set(key, 'no-device');
      return;
    }
    const mine = outcomes.filter((outcome) => String(outcome.userId) === key);
    statusByUser.set(key, mine.some((outcome) => outcome.ok) ? 'sent' : 'failed');
  });
  return statusByUser;
};

const sendPushMessages = async (items, transport = postToExpo) => {
  const userIds = [...new Set(items.map((item) => String(item.userId)))];
  const devices = await DeviceToken.find({ userId: { $in: userIds } }, 'userId token').lean();
  const tokensByUser = new Map();
  devices
    .filter((device) => isExpoToken(device.token))
    .forEach((device) => {
      const key = String(device.userId);
      tokensByUser.set(key, [...(tokensByUser.get(key) || []), device.token]);
    });

  const messages = [];
  items.forEach((item) => {
    (tokensByUser.get(String(item.userId)) || []).forEach((token) => {
      messages.push({
        to: token,
        userId: String(item.userId),
        title: item.title,
        body: item.body,
        data: item.data || {},
        sound: 'default',
        priority: 'high',
        channelId: 'default'
      });
    });
  });

  const outcomes = [];
  for (const group of chunk(messages, CHUNK_SIZE)) {
    try {
      const tickets = await transport(group.map(({ userId, ...message }) => message));
      outcomes.push(...interpretTickets(group, tickets));
    } catch (error) {
      console.error('Expo push request failed:', error.message);
      group.forEach((message) => outcomes.push({ token: message.to, userId: message.userId, ok: false, unregistered: false }));
    }
  }

  const stale = outcomes.filter((outcome) => outcome.unregistered).map((outcome) => outcome.token);
  if (stale.length > 0) await DeviceToken.deleteMany({ token: { $in: stale } });

  return summariseByUser(userIds, outcomes, tokensByUser);
};

module.exports = { sendPushMessages, interpretTickets, summariseByUser, isExpoToken, chunk };
