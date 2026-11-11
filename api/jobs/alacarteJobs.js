const cron = require('node-cron');
const { IST_ZONE } = require('../utils/dateUtils');
const { expirePendingOrders } = require('../utils/alacarteService');

let running = false;

const tick = async () => {
  if (running) return;
  running = true;
  try {
    await expirePendingOrders();
  } catch (error) {
    console.error('À la carte job tick failed:', error);
  } finally {
    running = false;
  }
};

cron.schedule('*/5 * * * *', tick, { timezone: IST_ZONE });

module.exports = { tick };
