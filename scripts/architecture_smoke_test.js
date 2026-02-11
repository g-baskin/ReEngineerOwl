#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadArchitectureModule() {
  const filePath = path.join(__dirname, "..", "re-recorder", "utils", "architecture.js");
  const source = fs.readFileSync(filePath, "utf8");
  const transformed = `${source
    .replace(/export function templatePath/g, "function templatePath")
    .replace(/export function analyzeArchitecture/g, "function analyzeArchitecture")}\nmodule.exports = { analyzeArchitecture, templatePath };`;

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
    RegExp,
    Date,
    Math
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
  const { analyzeArchitecture } = loadArchitectureModule();

  const base = new Date("2026-01-01T10:00:00.000Z").getTime();
  const mockEntries = [
    {
      timestamp: new Date(base).toISOString(),
      method: "POST",
      endpoint: "https://internal.example.com/api/generation/jobs",
      queryParams: {},
      requestBody: { prompt: "create" },
      responseBody: { jobId: "job-123" },
      status: 202,
      duration: 110
    },
    {
      timestamp: new Date(base + 2000).toISOString(),
      method: "GET",
      endpoint: "https://internal.example.com/api/generation/jobs/123/status",
      queryParams: {},
      requestBody: "",
      responseBody: { status: "running", progress: 30 },
      status: 200,
      duration: 80
    },
    {
      timestamp: new Date(base + 4000).toISOString(),
      method: "GET",
      endpoint: "https://internal.example.com/api/generation/jobs/123/status",
      queryParams: {},
      requestBody: "",
      responseBody: { status: "running", progress: 70 },
      status: 200,
      duration: 85
    },
    {
      timestamp: new Date(base + 6000).toISOString(),
      method: "GET",
      endpoint: "https://internal.example.com/api/generation/jobs/123/results",
      queryParams: {},
      requestBody: "",
      responseBody: { output: { id: 123, summary: "done", items: [1, 2, 3, 4, 5, 6] } },
      status: 200,
      duration: 420
    }
  ];

  const report = analyzeArchitecture(mockEntries);
  const asyncJobPattern = report.json.patterns.find((pattern) => pattern.name === "Async job orchestration");

  process.stdout.write(`${report.markdown}\n`);

  assert(asyncJobPattern, "Expected async job orchestration pattern to be detected");
  assert(asyncJobPattern.confidence === "High", "Expected async job confidence to be High");
  assert(report.markdown.includes("## Overview"), "Expected markdown to include Overview section");
  assert(report.markdown.includes("## Detected Patterns"), "Expected markdown to include Detected Patterns section");
  assert(report.markdown.includes("## Recommended Reference Architecture"), "Expected markdown to include reference architecture section");
  assert(report.markdown.includes("## Suggested MVP Implementation Checklist"), "Expected markdown to include checklist section");
  assert(report.markdown.includes("## Appendix: Anonymized Endpoint Shapes"), "Expected markdown to include appendix section");
}

try {
  main();
} catch (error) {
  console.error(`architecture_smoke_test failed: ${error.message}`);
  process.exit(1);
}
