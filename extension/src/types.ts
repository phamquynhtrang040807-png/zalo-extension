export interface CapturePayload {
  source: "tiktok_shop";
  profile_id: string | null;
  username: string;
  display_name: string | null;
  followers_raw: string | null;
  gmv_raw: string;
  phone_raw: string | null;
  reporting_period: string | null;
  profile_url: string;
  captured_at: string;
}

export interface CaptureResult {
  action: "saved_missing_phone" | "sent";
  lead_id?: string;
  job_id?: string;
  message: string;
  normalized: {
    followers: number | null;
    gmv_vnd: number | null;
    phone_local: string | null;
    phone_e164: string | null;
  };
}

export interface ExtensionConfig {
  backendUrl: string;
  apiToken: string;
}

export interface ZaloAutomationConfig {
  friend_request_message: string;
  messages: string[];
}

export interface ZaloAutomationTestResult {
  success: boolean;
  requested_phone: string;
  effective_recipient_last4: string;
  force_recipient_enabled: boolean;
  sent_count: number;
  message_ids: string[];
  message: string;
}

export type RuntimeRequest =
  | { type: "capture"; payload: CapturePayload }
  | { type: "health" }
  | { type: "google-auth-start" }
  | { type: "google-sheets-test" }
  | { type: "zalo-login-status" }
  | { type: "zalo-login-start" }
  | { type: "zalo-login-qr" }
  | { type: "zalo-automation-config-get" }
  | { type: "zalo-automation-config-save"; config: ZaloAutomationConfig }
  | { type: "zalo-automation-test"; phone: string }
  | { type: "zalo-control"; enabled: boolean };

export interface ZaloLoginStatus {
  logged_in: boolean;
  state: string;
  account: {
    user_id: string;
    display_name: string;
    phone: string;
  } | null;
  qr_ready: boolean;
  force_recipient_enabled: boolean;
  force_recipient_last4: string | null;
  error: string | null;
}

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
