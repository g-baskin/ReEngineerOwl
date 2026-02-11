#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadPostmanModule() {
  const filePath = path.join(__dirname, "..", "re-recorder", "utils", "postman.js");
  const source = fs.readFileSync(filePath, "utf8");
  const transformed = `${source
    .replace(/export function templatePathForPostman/g, "function templatePathForPostman")
    .replace(/export function buildPostmanCollection/g, "function buildPostmanCollection")
    .replace(/export function buildPostmanEnvironment/g, "function buildPostmanEnvironment")}\nmodule.exports = { templatePathForPostman, buildPostmanCollection, buildPostmanEnvironment };`;

  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    URL,
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" }
  };

  vm.createContext(sandbox);
  const script = new vm.Script(transformed, { filename: filePath });
  script.runInContext(sandbox);
  return sandbox.module.exports;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const { templatePathForPostman, buildPostmanCollection, buildPostmanEnvironment } = loadPostmanModule();

  const mockEntries = [
    {
      method: "GET",
      endpoint: "https://api.example.com/users/123?include=roles",
      queryParams: { include: "roles" },
      requestHeaders: [
        { name: "Accept", value: "application/json" },
        { name: "Authorization", value: "Bearer secret" }
      ],
      requestBody: ""
    },
    {
      method: "POST",
      endpoint: "https://api.example.com/users",
      queryParams: {},
      requestHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "Cookie", value: "session=abc" }
      ],
      requestBody: { email: "test@example.com", role: "admin" }
    },
    {
      method: "PUT",
      endpoint: "https://auth.example.com/sessions/550e8400-e29b-41d4-a716-446655440000",
      queryParams: {},
      requestHeaders: [{ name: "Accept", value: "application/json" }],
      requestBody: JSON.stringify({ active: true })
    }
  ];

  const templated = templatePathForPostman(mockEntries[0].endpoint);
  assert(templated === "/users/:id", "Expected numeric path segment to be templated as :id");

  const collection = buildPostmanCollection(mockEntries);
  const environment = buildPostmanEnvironment(mockEntries);

  JSON.parse(JSON.stringify(collection));
  JSON.parse(JSON.stringify(environment));

  assert(collection.info.schema.includes("v2.1.0"), "Expected Postman collection schema v2.1");
  assert(Array.isArray(collection.item) && collection.item.length === 2, "Expected host folders in collection");

  const firstRequest = collection.item[0].item[0].item[0];
  assert(firstRequest.request.url && firstRequest.request.method, "Expected request.url and request.method");

  const allHeaders = JSON.stringify(collection);
  assert(!allHeaders.toLowerCase().includes("authorization"), "Authorization header should not be exported");
  assert(!allHeaders.toLowerCase().includes("cookie"), "Cookie header should not be exported");

  assert(Array.isArray(environment.values), "Expected environment values");
  assert(environment.values.some((v) => v.key === "baseUrl_api_example_com"), "Expected per-host baseUrl variable");
}

try {
  main();
  process.stdout.write("postman_smoke_test passed\n");
} catch (error) {
  console.error(`postman_smoke_test failed: ${error.message}`);
  process.exit(1);
}
