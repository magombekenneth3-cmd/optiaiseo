/**
 * src/lib/schema/serviceSchema.ts
 *
 * Generates Service JSON-LD schema for entity-dedicated service pages.
 * Used by entity page generator, blog pipeline, and KG builder.
 */

export interface ServiceSchemaOpts {
    name: string;
    domain: string;
    slug: string;
    description: string;
    location?: string | null;
    priceRange?: string;
}

/**
 * generateServiceSchema
 *
 * Returns a JSON string of Service schema markup.
 * Each service entity gets its own @id so the KG can reference it.
 */
export function generateServiceSchema(opts: ServiceSchemaOpts): string {
    const schema: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": "Service",
        "@id": `https://${opts.domain}/services/${opts.slug}#service`,
        "name": opts.name,
        "description": opts.description,
        "url": `https://${opts.domain}/services/${opts.slug}`,
        "provider": {
            "@type": "Organization",
            "@id": `https://${opts.domain}/#organization`,
        },
    };

    if (opts.location) {
        schema["areaServed"] = {
            "@type": "Place",
            "name": opts.location,
        };
    }

    if (opts.priceRange) {
        schema["offers"] = {
            "@type": "Offer",
            "priceSpecification": {
                "@type": "UnitPriceSpecification",
                "description": opts.priceRange,
            },
        };
    }

    return JSON.stringify(schema, null, 2);
}
