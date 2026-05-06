// Next.js Route Handlers do not support native WebSockets directly yet in the App Router without a custom server.
// Since we are using exactly that (a custom server.ts listening for 'upgrade' events on /api/voice),
// this GET route simply serves as a fallback or documentation endpoint if accessed via pure HTTP.

import { NextResponse } from "next/server";

export async function GET(_request: Request) {
    return NextResponse.json(
        {
            error: "This endpoint requires a WebSocket connection.",
            message: "Please connect using wss://.../api/voice"
        },
        { status: 426 }
    );
}
