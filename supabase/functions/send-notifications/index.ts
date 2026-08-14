// ================================================================
// CCPL CMMS — Send Notifications Edge Function
// Reads pending notifications, sends via configured providers,
// records results, and prevents duplicate sends.
// ================================================================
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface NotificationRecord {
  id: string;
  event_type: string;
  record_id: string;
  machine_name: string;
  recipient: string;
  channel: string;
  scheduled_at: string;
  sent_at: string | null;
  status: string;
  error_message: string;
  idempotency_key: string;
}

interface NotificationSettings {
  id: string;
  enabled: boolean;
  recipients: string[];
  amc_expiry_30d: boolean;
  amc_expiry_15d: boolean;
  amc_expiry_7d: boolean;
  amc_expiry_today: boolean;
  amc_visit_overdue: boolean;
  pm_overdue: boolean;
  breakdown_open_hours: number;
  reminder_days: number[];
}

// ── Provider Abstraction ────────────────────────────────────────

async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  // Provider: Resend (https://resend.com)
  // Set RESEND_API_KEY in Supabase Edge Function secrets
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "Email provider not configured (RESEND_API_KEY missing)" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM") || "CCPL CMMS <notifications@ccpl.com>",
        to: [to],
        subject,
        html: body,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Email API error: ${err}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Email send failed: ${e.message}` };
  }
}

async function sendWhatsApp(
  to: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  // Provider: Meta WhatsApp Business API
  // Set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID in secrets
  const token = Deno.env.get("WHATSAPP_API_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!token || !phoneNumberId) {
    return { ok: false, error: "WhatsApp provider not configured (API credentials missing)" };
  }

  try {
    const res = await fetch(
      `https://graph.facebook/v18.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to.replace(/[^0-9]/g, ""),
          type: "text",
          text: { body: message },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `WhatsApp API error: ${err}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `WhatsApp send failed: ${e.message}` };
  }
}

// ── Notification Content Builders ───────────────────────────────

function buildEmailContent(record: NotificationRecord): { subject: string; html: string } {
  const subjects: Record<string, string> = {
    AMC_EXPIRING: `⚠️ AMC Expiring Soon — ${record.machine_name}`,
    AMC_EXPIRED: `🚨 AMC Expired — ${record.machine_name}`,
    AMC_VISIT_OVERdue: `⚠️ AMC Service Visit Overdue — ${record.machine_name}`,
    PM_OVERDUE: `⚠️ PM Overdue — ${record.machine_name}`,
    BREAKDOWN_OPEN_TOO_LONG: `🚨 Prolonged Breakdown — ${record.machine_name}`,
  };

  const subject = subjects[record.event_type] || `CCPL Notification — ${record.event_type}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0F766E; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">CCPL Maintenance Hub</h2>
      </div>
      <div style="background: #1E293B; color: #E2E8F0; padding: 24px; border-radius: 0 0 8px 8px;">
        <p style="font-size: 14px; margin: 0 0 12px;">${record.event_type.replace(/_/g, " ")}</p>
        <p style="font-size: 16px; font-weight: bold; margin: 0 0 8px;">Machine: ${record.machine_name}</p>
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">Record ID: ${record.record_id}</p>
        <hr style="border: none; border-top: 1px solid #334155; margin: 16px 0;" />
        <p style="font-size: 12px; color: #64748B; margin: 0;">CCPL Maintenance & Reliability Hub — Automated Notification</p>
      </div>
    </div>`;

  return { subject, html };
}

function buildWhatsAppMessage(record: NotificationRecord): string {
  return `CCPL Maintenance Hub\n\n` +
    `${record.event_type.replace(/_/g, " ")}\n` +
    `Machine: ${record.machine_name}\n` +
    `Record: ${record.record_id}\n\n` +
    `Please check the maintenance dashboard for details.`;
}

// ── Main Handler ────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Read notification settings
    const { data: settings } = await supabase
      .from("notification_settings")
      .select("*")
      .eq("id", "default")
      .single();

    if (!settings || !settings.enabled) {
      return new Response(
        JSON.stringify({ message: "Notifications disabled or no settings found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // 2. Read pending notifications (not yet sent)
    const { data: pending, error: fetchError } = await supabase
      .from("notification_log")
      .select("*")
      .eq("status", "pending")
      .order("scheduled_at", { ascending: true })
      .limit(50);

    if (fetchError) {
      throw new Error(`Failed to fetch pending notifications: ${fetchError.message}`);
    }

    if (!pending || pending.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending notifications", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const results: { id: string; status: string; error?: string }[] = [];

    // 3. Process each notification
    for (const record of pending) {
      // 4. Check idempotency — skip if already sent
      const { data: existing } = await supabase
        .from("notification_log")
        .select("id")
        .eq("idempotency_key", record.idempotency_key)
        .eq("status", "sent")
        .single();

      if (existing) {
        results.push({ id: record.id, status: "skipped", error: "Already sent" });
        continue;
      }

      // 5. Send through configured provider
      let sendResult = { ok: false, error: "Unknown channel" };

      if (record.channel === "email") {
        const { subject, html } = buildEmailContent(record);
        sendResult = await sendEmail(record.recipient, subject, html);
      } else if (record.channel === "whatsapp") {
        const message = buildWhatsAppMessage(record);
        sendResult = await sendWhatsApp(record.recipient, message);
      } else if (record.channel === "in_app") {
        // In-app notifications are displayed client-side; mark as sent
        sendResult = { ok: true };
      }

      // 6. Record success/failure
      const newStatus = sendResult.ok ? "sent" : "failed";
      const { error: updateError } = await supabase
        .from("notification_log")
        .update({
          status: newStatus,
          sent_at: sendResult.ok ? new Date().toISOString() : null,
          error_message: sendResult.error || "",
        })
        .eq("id", record.id);

      if (updateError) {
        results.push({ id: record.id, status: "error", error: updateError.message });
      } else {
        results.push({ id: record.id, status: newStatus, error: sendResult.error });
      }
    }

    return new Response(
      JSON.stringify({
        message: `Processed ${results.length} notifications`,
        processed: results.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
