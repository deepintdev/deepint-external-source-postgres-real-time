// Text utils

"use strict";

import Crypto from "crypto";

export function secureStringCompare(a: string, b: string): boolean {
    try {
        return Crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch (ex) {
        return false;
    }
}

/**
 * Converts query template to pg-compatible
 * @param queryTemplate Original template
 * @returns PostgreSQL template
 */
export function toPostgresTemplate(queryTemplate: string): string {
    let i = 1;
    while (queryTemplate.indexOf("?") >= 0) {
        queryTemplate = queryTemplate.replace("?", "$" + i);
        i++;
    }
    return queryTemplate;
}

