import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAuthMiddleware } from "../services/localAuth.mjs";

function request(path, token = "") {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  let nextCalled = false;
  const req = {
    path,
    get(name) {
      if (name === "x-studio-token") return token;
      return "";
    },
  };
  createLocalAuthMiddleware({ token: "secret-token" })(req, response, () => { nextCalled = true; });
  return { response, nextCalled };
}

test("local auth keeps readiness status public", () => {
  const result = request("/status");
  assert.equal(result.nextCalled, true);
  assert.equal(result.response.statusCode, 200);
});

test("local auth rejects missing and invalid tokens", () => {
  assert.equal(request("/videos").response.statusCode, 401);
  assert.equal(request("/videos", "wrong-token").response.statusCode, 403);
});

test("local auth accepts the configured token", () => {
  const result = request("/videos", "secret-token");
  assert.equal(result.nextCalled, true);
  assert.equal(result.response.statusCode, 200);
});
