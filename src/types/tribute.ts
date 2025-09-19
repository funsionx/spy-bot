export interface TributeWebhookPayload {
  event: "new_subscription" | "cancelled_subscription";
  user: {
    id: number; // Telegram User ID
    first_name: string;
    last_name?: string;
    username?: string;
  };
  subscription: {
    plan_id: string;
    status: "active" | "canceled";
    created_at: string;
    expires_at: string | null;
  };
}
