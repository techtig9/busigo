import { cn } from "@/lib/utils";

type Tone = "signal" | "pulse" | "danger" | "warn" | "slate";

const TONE_CLASSES: Record<Tone, string> = {
  signal: "bg-signal/10 text-signal",
  pulse: "bg-pulse/10 text-pulse",
  danger: "bg-danger/10 text-danger",
  warn: "bg-warn/10 text-warn",
  slate: "bg-surface text-slate",
};

export function Badge({ tone = "slate", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-semibold", TONE_CLASSES[tone])}>
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "success":
      return "signal";
    case "running":
      return "pulse";
    case "failed":
      return "danger";
    case "stopped_by_filter":
      return "warn";
    case "waiting":
      return "warn";
    default:
      return "slate";
  }
}
