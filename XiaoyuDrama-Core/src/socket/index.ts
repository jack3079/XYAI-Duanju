import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import u from "@/utils";
import productionAgent from "./routes/productionAgent";
import scriptAgent from "./routes/scriptAgent";

async function authenticateSocket(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
    const tokenKey = String(setting?.value || "").trim();
    if (!tokenKey) return next(new Error("服务器秘钥未配置"));

    const authToken = String(socket.handshake.auth?.token || "").trim();
    const headerToken = String(socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const token = authToken || headerToken;
    if (!token) return next(new Error("未提供登录凭证"));

    const user = jwt.verify(token, tokenKey);
    socket.data.user = user;
    next();
  } catch (exception) {
    console.warn(`[Socket] 拒绝未授权连接 ${socket.handshake.address}:`, exception instanceof Error ? exception.message : String(exception));
    next(new Error("登录状态已失效，请重新登录"));
  }
}

export default (io: Server) => {
  const routes: Record<string, (nsp: ReturnType<Server["of"]>) => void> = {
    productionAgent,
    scriptAgent,
  };

  for (const [name, handler] of Object.entries(routes)) {
    const nsp = io.of(`/api/socket/${name}`);
    nsp.use((socket, next) => void authenticateSocket(socket, next));
    handler(nsp);
    console.log(`[Socket] 注册命名空间并启用 JWT 鉴权: /api/socket/${name}`);
  }
};
