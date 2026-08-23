import { ref } from "vue";
import { io, Socket } from "socket.io-client";
import { backendSocketUrl } from "./backendUrl";

export interface SocketEventMap {
  getPlanData: (data: any, callback: (response: any) => void) => void;
  setPlanData: (data: any) => void;
  getFlowData: (data: any, callback: (response: any) => void) => void;
  setFlowData: (data: any) => void;
  message: string;
  setKeyScript: { scriptId: number; key: string };
  stop: string;
  textMessage: { type: "start" | "content" | "end"; messageId: string; delta: string | null; role: "assistant"; name: string };
  systemMessage: { messageId: string; content: string };
  thinkMessage: { type: "start" | "content" | "end"; messageId: string; delta: string | null; role: "assistant"; name: string };
}

export function useSocket<T extends SocketEventMap = SocketEventMap>(url = backendSocketUrl(), authOptions?: Record<string, any>) {
  let socket: Socket | null = null;
  const connected = ref(false);
  const lastError = ref("");

  const currentAuth = () => ({
    token: localStorage.getItem("token") || "",
    ...(authOptions || {}),
  });

  const refreshAuth = () => {
    if (socket) socket.auth = currentAuth();
  };

  const connect = () => {
    if (socket) {
      refreshAuth();
      if (socket.disconnected) socket.connect();
      return;
    }

    socket = io(url, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      auth: currentAuth(),
    });

    socket.io.on("reconnect_attempt", refreshAuth);
    socket.on("connect", () => {
      connected.value = true;
      lastError.value = "";
    });
    socket.on("disconnect", () => {
      connected.value = false;
    });
    socket.on("connect_error", (exception: any) => {
      connected.value = false;
      lastError.value = String(exception?.message || "Socket 连接失败");
    });
  };

  const disconnect = () => {
    socket?.disconnect();
    connected.value = false;
  };

  const send = <E extends keyof T & string>(event: E, ...args: T[E] extends void ? [] : [T[E]]) => socket?.emit(event, ...args);
  const on = <E extends keyof T & string>(event: E, callback: T[E] extends (...args: any[]) => any ? T[E] : (data: T[E]) => void) =>
    socket?.on(event, callback as any);
  const off = <E extends keyof T & string>(event: E, callback?: T[E] extends (...args: any[]) => any ? T[E] : (data: T[E]) => void) =>
    socket?.off(event, callback as any);

  return { connected, lastError, socket: { connect, disconnect, send, on, off } };
}
