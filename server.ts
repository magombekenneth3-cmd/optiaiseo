import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { validateEnv } from "./src/lib/env";
import { prisma } from "./src/lib/prisma";
import { logger } from "./src/lib/logger";
import { getToken } from "next-auth/jwt";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";

// Ensure all environment variables are present before starting
validateEnv();

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0"; 
const port = parseInt(process.env.PORT || "3000", 10);

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        logger.info("[Server] Database connection healthy.");
    } catch (dbErr: any) {
        // Warn instead of crashing — Railway Postgres is sometimes briefly
        // unreachable at container start. Routes handle DB errors gracefully.
        logger.warn("[Server] Database health-check failed at startup (non-fatal). Will retry on first request.", {
            error: dbErr?.message || dbErr,
        });
    }

    const server = createServer(async (req, res) => {
        try {
            const parsedUrl = parse(req.url!, true);
            await handle(req, res, parsedUrl);
        } catch (err: any) {
           
            if (err?.message?.includes("Cannot read properties of undefined (reading 'workers')")) {
                logger.warn("[Server] Next.js server action worker pool error (known Next.js 15 bug):", {
                    error: err?.message,
                    digest: err?.digest,
                });
                if (!res.headersSent) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: "Server action worker pool error. Please hard-refresh the page." }));
                }
                return;
            }
            logger.error("[Server] Unhandled request error:", { error: err?.message || err });
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end("Internal server error");
            }
        }
    });

   
    const nextUpgradeHandler = app.getUpgradeHandler();

    const wsHandler = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        try {
           
            if (req.url?.startsWith("/_next/")) {
                nextUpgradeHandler(req, socket, head);
                return;
            }

            const token = await getToken({
                req: req as any,
                secret: process.env.NEXTAUTH_SECRET,
            });

            if (!token?.id) {
                logger.warn("[Server/WS] Rejected unauthenticated WebSocket upgrade attempt.", {
                    url: req.url,
                    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress,
                });
                socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized");
                socket.destroy();
                return;
            }

            logger.debug("[Server/WS] Authenticated WebSocket upgrade.", { userId: token.id, url: req.url });
            nextUpgradeHandler(req, socket, head);
        } catch (err: any) {
            logger.error("[Server/WS] Error during WebSocket auth check:", { error: err?.message || err });
            socket.write("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
            socket.destroy();
        }
    };

    server.on("upgrade", wsHandler);

    server.listen(port, () => {
        logger.info(`[Server] Ready on http://${hostname}:${port}`);
    });
});
