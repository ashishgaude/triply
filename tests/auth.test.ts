import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountStorageKey,
  authRedirectUrl,
  isPasswordRecovery,
} from "../src/auth-utils.ts";

test("workspace storage is isolated by signed-in user", () => {
  assert.notEqual(accountStorageKey("user-one"), accountStorageKey("user-two"));
  assert.notEqual(accountStorageKey("user-one"), "triply-workspace-v2");
  assert.throws(() => accountStorageKey(""));
});

test("recovery links support the reference project's query and hash formats", () => {
  assert.ok(
    isPasswordRecovery(
      "http://localhost:5173/?mode=reset-password&code=example",
    ),
  );
  assert.ok(isPasswordRecovery("http://localhost:5173/#type=recovery"));
  assert.ok(isPasswordRecovery("http://localhost:5173/?type=recovery"));
  assert.equal(isPasswordRecovery("http://localhost:5173/?type=signup"), false);
});

test("auth redirects respect a deployed app base path", () => {
  assert.equal(
    authRedirectUrl("https://example.com", "/triply/"),
    "https://example.com/triply/",
  );
  assert.equal(
    authRedirectUrl("https://example.com", "/triply/", true),
    "https://example.com/triply/?mode=reset-password",
  );
});
