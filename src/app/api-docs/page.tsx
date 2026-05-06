/**
 * /api-docs — Public API documentation page.
 *
 * Renders the Swagger UI for the OptiAISEO REST API.
 * Intentionally kept noindex until all endpoints are documented.
 *
 * The openapi spec lives at /public/openapi.yaml and is served
 * as a static asset via Next.js. Expand it over time as new
 * endpoints become stable enough to advertise.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "API Reference — OptiAISEO",
    description: "REST API documentation for OptiAISEO developer integrations. AEO scoring, SEO analysis, and more.",
    // Keep out of search results until the spec is fully documented.
    robots: "noindex, nofollow",
};

export default function ApiDocsPage() {
    return (
        <>
            {/* eslint-disable-next-line @next/next/no-head-element */}
            <link
                rel="stylesheet"
                href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
            />
            <div id="swagger-ui" style={{ minHeight: "100vh" }} />
            {/* Swagger UI bundle — loaded after the div is in the DOM */}
            <script
                src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"
                defer
            />
            <script
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Swagger UI initialisation requires inline JS
                dangerouslySetInnerHTML={{
                    __html: `
window.addEventListener('load', function () {
    if (typeof SwaggerUIBundle === 'undefined') return;
    SwaggerUIBundle({
        url: '/openapi.yaml',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        deepLinking: true,
        defaultModelsExpandDepth: -1,
    });
});
                    `.trim(),
                }}
            />
        </>
    );
}
