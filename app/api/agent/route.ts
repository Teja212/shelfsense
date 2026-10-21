import { runAgent, type AgentInput } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the agent makes several Qloo + LLM calls per run

// Streams the agent's reasoning as newline-delimited JSON so the UI can show
// each step the moment it happens.
export async function POST(req: Request) {
  const input = (await req.json().catch(() => ({}))) as AgentInput;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        for await (const ev of runAgent(input)) send(ev);
      } catch (e) {
        send({ type: "error", text: e instanceof Error ? e.message : "agent failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
