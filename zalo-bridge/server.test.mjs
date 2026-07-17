import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
const { effectiveRecipient, normalizeVietnamPhone, parseBoolean } = await import("./server.mjs");


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
