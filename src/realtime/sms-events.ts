import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

export type SmsUpdatedPayload = {
  reason:
    | "inbound"
    | "thread_started"
    | "thread_claimed"
    | "message_sent"
    | "thread_resolved";
  threadId?: string;
  messageId?: string;
};

let smsSocketServer: WebSocketServer | null = null;

export function attachSmsRealtime(server: HttpServer): void {
  if (smsSocketServer) return;

  smsSocketServer = new WebSocketServer({
    server,
    path: "/api/sms/socket",
  });

  smsSocketServer.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        event: "SMS_CONNECTED",
        data: { path: "/api/sms/socket" },
        emittedAt: new Date().toISOString(),
      })
    );
  });
}

export function emitSmsUpdated(payload: SmsUpdatedPayload): void {
  if (!smsSocketServer) return;

  const message = JSON.stringify({
    event: "SMS_UPDATED",
    data: payload,
    emittedAt: new Date().toISOString(),
  });

  for (const client of smsSocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
