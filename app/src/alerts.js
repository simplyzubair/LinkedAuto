// Sends alerts to Telegram when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
// Every alert is also in the activity log, so this is optional.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;

export async function alert(text) {
  if (!TOKEN || !CHAT) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    console.error(`telegram alert failed: ${err.message}`);
    return false;
  }
}
