const axios = require('axios');

// Shared AiSensy sender for every WhatsApp business notification in this
// app (same account already used for mobile OTP and the plan-ending
// reminder). WhatsApp only allows pre-approved templates — there's no
// free-text send — so each event type gets its own campaign-name env var.
// Quietly no-ops (never throws) until that env var is set, so a new
// notification type ships safely ahead of its template's approval and
// activates the moment the env var is configured, no redeploy needed.
const sendWhatsAppMessage = async ({ campaignEnvVar, mobileNumber, customerName, templateParams }) => {
  const campaignName = process.env[campaignEnvVar];
  if (!campaignName) return false;
  if (!mobileNumber || !process.env.AISENSY_URL || !process.env.AISENSY_API_KEY) {
    console.error(`Missing AISENSY configuration or mobile number for ${campaignEnvVar}`);
    return false;
  }
  try {
    await axios({
      method: 'POST',
      url: process.env.AISENSY_URL,
      data: {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName,
        destination: mobileNumber,
        userName: customerName || 'User',
        templateParams
      }
    });
    return true;
  } catch (error) {
    console.error(`WhatsApp send failed for ${campaignEnvVar} (campaign "${campaignName}"):`, error.message);
    return false;
  }
};

module.exports = { sendWhatsAppMessage };
