"use client";

import { useState } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { Button } from "@/components/ui/Button";

const PRICE_IDS: Record<"starter" | "growth" | "pro", string | undefined> = {
  starter: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER,
  growth: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH,
  pro: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO,
};

export function CheckoutButton({ plan, userId, label }: { plan: "starter" | "growth" | "pro"; userId: string; label: string }) {
  const [loading, setLoading] = useState(false);
  const [paddle, setPaddle] = useState<Paddle | undefined>();

  const openCheckout = async () => {
    setLoading(true);
    try {
      let instance = paddle;
      if (!instance) {
        instance = await initializePaddle({
          environment: "production",
          token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || "",
        });
        setPaddle(instance);
      }

      const priceId = PRICE_IDS[plan];
      if (!priceId) {
        alert(`Set NEXT_PUBLIC_PADDLE_PRICE_${plan.toUpperCase()} in your environment first.`);
        return;
      }

      instance?.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customData: { user_id: userId },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={openCheckout} disabled={loading}>
      {loading ? "Loading..." : label}
    </Button>
  );
}
