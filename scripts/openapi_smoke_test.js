#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadOpenApiModule() {
  const filePath = path.join(__dirname, "..", "re-recorder", "utils", "openapi.js");
  const source = fs.readFileSync(filePath, "utf8");
  const transformed = `${source
    .replace(/export function buildOpenApiSpec/g, "function buildOpenApiSpec")
    .replace(/export function toYamlString/g, "function toYamlString")}\nmodule.exports = { buildOpenApiSpec, toYamlString };`;

  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    URL,
    Set,
    Map,
    JSON,
    Number,
    String,
    Array,
    Object,
    RegExp
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
  const { buildOpenApiSpec } = loadOpenApiModule();

  const mockCapture = [
    {
      timestamp: "2026-01-01T10:00:00.000Z",
      method: "GET",
      endpoint: "https://api.example.com/items/123?include=details",
      queryParams: { include: "details" },
      requestBody: "",
      responseBody: {
        id: 123,
        name: "Sample Item",
        tags: ["alpha"]
      },
      status: 200,
      duration: 45,
      bodyCaptured: true
    },
    {
      timestamp: "2026-01-01T10:00:01.000Z",
      method: "POST",
      endpoint: "https://api.example.com/items",
      queryParams: {},
      requestBody: {
        name: "Created Item"
      },
      responseBody: {
        id: 124,
        name: "Created Item"
      },
      status: 201,
      duration: 63,
      bodyCaptured: true
    }
  ];

  const spec = buildOpenApiSpec(mockCapture, []);
  process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);

  assert(spec.openapi === "3.1.0", "Expected openapi to be 3.1.0");
  assert(Boolean(spec.paths["/items/{itemId}"]), "Expected parameterized GET path /items/{itemId}");
  assert(Boolean(spec.paths["/items"]), "Expected POST path /items");

  JSON.parse(JSON.stringify(spec));
}

try {
  main();
} catch (error) {
  console.error(`openapi_smoke_test failed: ${error.message}`);
  process.exit(1);
}
