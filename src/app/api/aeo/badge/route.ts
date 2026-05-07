import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function buildSvg(score: number, grade: string): string {
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 18;
  const dash = (score / 100) * circumference;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="64" role="img" aria-label="AEO Score ${score}/100 — Verified by OptiAISEO">
  <title>AEO Score ${score}/100</title>
  <rect width="200" height="64" rx="10" fill="#111111"/>
  <rect x="1" y="1" width="198" height="62" rx="9" fill="none" stroke="#1f2937" stroke-width="1"/>
  <g transform="translate(16,12)">
    <circle cx="20" cy="20" r="18" fill="none" stroke="#1f2937" stroke-width="3.5"/>
    <circle cx="20" cy="20" r="18" fill="none" stroke="${color}" stroke-width="3.5"
      stroke-linecap="round"
      stroke-dasharray="${dash} ${circumference}"
      transform="rotate(-90 20 20)"/>
    <text x="20" y="25" font-family="-apple-system,sans-serif" font-size="11" font-weight="800"
      fill="${color}" text-anchor="middle">${score}</text>
  </g>
  <text x="60" y="24" font-family="-apple-system,sans-serif" font-size="11" font-weight="700" fill="#ffffff">AEO Score</text>
  <text x="60" y="40" font-family="-apple-system,sans-serif" font-size="16" font-weight="800" fill="${color}">${score}<tspan font-size="11" fill="#6b7280">/100 · ${grade}</tspan></text>
  <text x="60" y="56" font-family="-apple-system,sans-serif" font-size="9" fill="#6b7280">Verified by OptiAISEO</text>
</svg>`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token || token.length < 20) {
    return new NextResponse("Invalid token", { status: 400 });
  }

  const site = await prisma.site.findFirst({
    where: { aeoPublicToken: token },
    select: {
      id: true,
      aeoReports: {
        where: { status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { score: true, grade: true },
      },
    },
  });

  if (!site) {
    return new NextResponse("Not found", { status: 404 });
  }

  const report = site.aeoReports[0];
  const score = report?.score ?? 0;
  const grade = report?.grade ?? "N/A";

  return new NextResponse(buildSvg(score, grade), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
