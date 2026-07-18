import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
const {
    effectiveRecipient,
    isAlreadyFriendError,
    normalizeVietnamPhone,
    parseBoolean,
    sessionCredentialsFromContext,
} = await import("./server.mjs");


test("normalizes Vietnamese phone numbers", () => {
    assert.equal(normalizeVietnamPhone("+84 961 382 006"), "0961382006");
    assert.equal(normalizeVietnamPhone("0961382006"), "0961382006");
    assert.equal(normalizeVietnamPhone("invalid"), null);
});


test("forced recipient overrides the requested recipient", () => {
    assert.equal(
        effectiveRecipient("0912345678", true, "0961382006"),
        "0961382006",
    );
    assert.equal(
        effectiveRecipient("0912345678", false, "0961382006"),
        "0912345678",
    );
});


test("boolean environment values are parsed safely", () => {
    assert.equal(parseBoolean("true"), true);
    assert.equal(parseBoolean("false", true), false);
    assert.equal(parseBoolean(undefined, true), true);
});


test("treats Zalo code 225 as an idempotent friend-request success", () => {
    assert.equal(isAlreadyFriendError({ code: 225 }), true);
    assert.equal(isAlreadyFriendError({ error_code: "225" }), true);
    assert.equal(isAlreadyFriendError({ code: 215 }), false);
});


test("builds restorable credentials from the resolved API context", () => {
    const cookie = [{ key: "zpw_sek", value: "session-value" }];
    const credentials = sessionCredentialsFromContext({
        cookie: { toJSON: () => ({ cookies: cookie }) },
        imei: "generated-imei",
        userAgent: "test-agent",
        language: "vi",
    });

    assert.deepEqual(credentials, {
        cookie,
        imei: "generated-imei",
        userAgent: "test-agent",
        language: "vi",
    });
});


test("rejects a context that cannot restore a Zalo session", () => {
    assert.throws(
        () => sessionCredentialsFromContext({ cookie: [] }),
        /without restorable session credentials/,
    );
});
