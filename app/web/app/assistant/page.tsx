"use client";
/* Chat Bot: the operations copilot for hub staff. Answers questions about the ten main vehicles, today's lanes and
   queue, inspections and findings, reports, appointments, history, fleet health trends and the inspection rules, from
   the platform's own data (components/copilot.tsx, /api/copilot). Deep links: ?c=<conversation> opens one, ?plate=<plate> picks a vehicle, ?q=<question> asks it straight away. */
import { CopilotChat } from "@/components/copilot";
import { Shell } from "@/components/Shell";

export default function AssistantPage() {
  return (
    <Shell>
      <CopilotChat />
    </Shell>
  );
}
