/**
 * Delivery channels for reports. Each activates when its env vars are set:
 *
 *   Telegram: TELEGRAM_BOT_TOKEN (from @BotFather) + TELEGRAM_CHAT_ID
 *   Email:    RESEND_API_KEY + REPORT_EMAIL_TO (+ optional REPORT_EMAIL_FROM)
 */

export function channelsConfigured(): { telegram: boolean; email: boolean } {
  return {
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    email: Boolean(process.env.RESEND_API_KEY && process.env.REPORT_EMAIL_TO),
  };
}

export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  // Telegram messages cap at 4096 chars.
  for (let i = 0; i < text.length; i += 4000) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + 4000) }),
    });
    if (!res.ok) {
      console.error("[reports] Telegram send failed:", await res.text());
      return false;
    }
  }
  return true;
}

export async function sendEmail(subject: string, text: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_EMAIL_TO;
  if (!apiKey || !to) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.REPORT_EMAIL_FROM ?? "Nut Analytics <onboarding@resend.dev>",
      to: to.split(",").map((s) => s.trim()),
      subject,
      text,
    }),
  });
  if (!res.ok) {
    console.error("[reports] Email send failed:", await res.text());
    return false;
  }
  return true;
}

export async function deliver(subject: string, text: string): Promise<{ telegram: boolean; email: boolean }> {
  const [telegram, email] = await Promise.all([sendTelegram(text), sendEmail(subject, text)]);
  return { telegram, email };
}
