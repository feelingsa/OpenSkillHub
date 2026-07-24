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
      if (request.url?.startsWith("/session/ses_test/message") && request.method === "POST") {
        response.end(JSON.stringify({ info: { id: "msg_test" }, parts: [] }));
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
      mode: "connect", url: new URL(`http://127.0.0.1:${address.port}`), command: "opencode", args: [], workingDirectory: process.cwd(), configDirectory: "config", dataDirectory: "data", lockFilePath: "lock", logFilePath: "log", startTimeoutMs: 1000, skillRoots: [], model: { providerID: "xingwan", id: "gpt-5.6-terra", variant: "medium" },
    }, { debug() {}, info() {}, warn() {}, error() {} });
    const received: string[] = [];
    const handle = await provider.startRun({ title: "Example", prompt: "Run it", directory: "C:/run", onEvent: (event) => received.push(String(event.properties?.delta ?? "")) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle.sessionId).toBe("ses_test");
    expect(received.filter(Boolean)).toEqual(["READY"]);
    expect(requests.some((request) => request.url?.startsWith("/session/ses_test/message?directory="))).toBe(true);
    const sessionRequest = requests.find((request) => request.url === "/session" && request.method === "POST");
    const promptRequest = requests.find((request) => request.url?.startsWith("/session/ses_test/message") && request.method === "POST");
    expect(JSON.parse(sessionRequest?.body ?? "{}")).toMatchObject({ model: { providerID: "xingwan", id: "gpt-5.6-terra", variant: "medium" } });
    expect(JSON.parse(promptRequest?.body ?? "{}")).toMatchObject({ model: { providerID: "xingwan", modelID: "gpt-5.6-terra" }, variant: "medium" });
    await handle.abort();
    await handle.done;
    eventResponse?.end();
    expect(requests.some((request) => request.url === "/session/ses_test/abort")).toBe(true);
  });
});
