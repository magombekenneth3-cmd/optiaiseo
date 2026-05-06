-- AddIndex: Blog.siteId
-- Supports getUserBlogs and all blog queries that filter only by siteId.
CREATE INDEX IF NOT EXISTS "Blog_siteId_idx" ON "Blog"("siteId");
