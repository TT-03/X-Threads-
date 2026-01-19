import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendAlertEmail(subject: string, text: string) {
  const to = process.env.ALERT_TO_EMAIL;
  const from = process.env.ALERT_FROM_EMAIL;
  if (!to || !from) return;

  await resend.emails.send({
    from,
    to,
    subject,
    text,
  });
}
