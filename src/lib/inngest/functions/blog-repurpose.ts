import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { repurposeBlog } from "@/lib/blog/rules";
import type { RepurposeJobData } from "@/lib/blog/rules";

export const repurposeBlogFn = inngest.createFunction(
    {
        id: "blog-repurpose",
        name: "Repurpose Blog Post",
        retries: 3,
        throttle: { limit: 5, period: "1m" },
        triggers: [{ event: "blog/repurpose" }],
    },
    async ({ event }) => {
        const { blogId, formats } = event.data as RepurposeJobData;

        const blog = await prisma.blog.findUnique({
            where: { id: blogId },
            include: { site: true },
        });
        if (!blog) throw new Error(`Blog not found: ${blogId}`);

        const repurposed = await repurposeBlog(blog, formats);

        await prisma.repurposedResult.upsert({
            where: { blogId },
            create: { blogId, siteId: blog.siteId, data: repurposed as object, status: "completed" },
            update: { data: repurposed as object, status: "completed", updatedAt: new Date() },
        });

        return repurposed;
    }
);
