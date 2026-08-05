"use client";

import { useState } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { Button } from "@/components/ui/Button";

const PRICE_IDS: Record<"starter" | "growth" | "pro", Record<"monthly" | "yearly", string | undefined>> = {
  starter: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER,
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER_YEARLY,
  },
  growth: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH,
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH_YEARLY,
  },
  pro: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO,
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY,
  },
};

export function CheckoutButton({
  plan,
  cycle,
  userId,
  label,
}: {
  plan: "starter" | "growth" | "pro";
  cycle: "monthly" | "yearly";
  userId: string;
  label: string;
}) {
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

      const priceId = PRICE_IDS[plan][cycle];
      if (!priceId) {
        alert(
          `Set NEXT_PUBLIC_PADDLE_PRICE_${plan.toUpperCase()}${cycle === "yearly" ? "_YEARLY" : ""} in your environment first.`
        );
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
