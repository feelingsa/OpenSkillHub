import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeProvider } from "../src/providers/opencode/provider.js";

let closeServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
});

describe("OpenCodeProvider run API", () => {
  it("creates a session, sends an async prompt, parses SSE events, and aborts upstream", async () => {
    let eventResponse: ServerResponse | undefined;
    const requests: Array<{ method?: string; url?: string; body: string }> = [];
    const server = createServer(async (request, response) => {
      if (request.url === "/global/health") return void response.end(JSON.stringify({ healthy: true }));
      if (request.url === "/event") {
        eventResponse = response;
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(": connected\n\n");
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push({ method: request.method, url: request.url, body });
      if (request.url === "/session" && request.method === "POST") return void response.end(JSON.stringify({ id: "ses_test" }));
      if (request.url?.startsWith("/session/ses_test/prompt_async") && request.method === "POST") {
        response.writeHead(204).end();
        eventResponse?.write('data: {"type":"session.next.text.delta","properties":{"sessionID":"ses_test","delta":"READY"}}\n\n');
        return;
      }
      if (request.url === "/session/ses_test/abort" && request.method === "POST") return void response.end(JSON.stringify(true));
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not listen");
    closeServer = async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const provider = new OpenCodeProvider({
      mode: "connect", url: new URL(`http://127.0.0.1:${address.port}`), command: "opencode", args: [], workingDirectory: process.cwd(), configDirectory: "config", dataDirectory: "data", lockFilePath: "lock", logFilePath: "log", startTimeoutMs: 1000, skillRoots: [],
    }, { debug() {}, info() {}, warn() {}, error() {} });
    const received: string[] = [];
    const handle = await provider.startRun({ title: "Example", prompt: "Run it", directory: "C:/run", onEvent: (event) => received.push(String(event.properties?.delta ?? "")) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle.sessionId).toBe("ses_test");
    expect(received).toEqual(["READY"]);
    expect(requests.some((request) => request.url?.startsWith("/session/ses_test/prompt_async?directory="))).toBe(true);
    await handle.abort();
    await handle.done;
    eventResponse?.end();
    expect(requests.some((request) => request.url === "/session/ses_test/abort")).toBe(true);
  });
});
