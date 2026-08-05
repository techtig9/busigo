import { Resend } from "resend";
import type { StepHandler } from "../types";
import { resolveConfig } from "../merge-fields";

// TESTING: onboarding@resend.dev needs no domain verification, but Resend will only
// deliver mail sent from it to the email address your Resend account itself is signed
// up with — every "to" address routes there regardless of what a workflow step sets.
// Once you own and verify a real domain, swap this back to your own address
// (e.g. "alerts@yourdomain.com") to send to real recipients.
const SENDING_DOMAIN = "onboarding@resend.dev"; // was: "alerts@busigo.app" — see Hard Constraint (no per-user SMTP today)

export const sendEmailStep: StepHandler = async ({ step, ctx }) => {
  const config = resolveConfig(step.config, ctx.data) as {
    to: string;
    subject: string;
    body: string;
  };

  if (!config.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.to)) {
    return { status: "failed", output: null, error: `Invalid recipient email: "${config.to}"` };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { data, error } = await resend.emails.send({
      from: SENDING_DOMAIN,
      to: config.to,
      subject: config.subject || "(no subject)",
      text: config.body || "",
    });

    if (error) {
      return { status: "failed", output: null, error: error.message };
    }
    // Output = the provider's real message ID — a step is only ever marked success because
    // the email API actually accepted the send, never optimistically.
    return { status: "success", output: { messageId: data?.id } };
  } catch (e: any) {
    return { status: "failed", output: null, error: e.message };
  }
};

// Used by Phase 1.6's failure-alert email — same provider, same fixed sending domain,
// but not billed as a workflow step since it's a system notification, not a user-configured action.
export async function sendAlertEmail(to: string, subject: string, body: string) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send({ from: SENDING_DOMAIN, to, subject, text: body });
}
