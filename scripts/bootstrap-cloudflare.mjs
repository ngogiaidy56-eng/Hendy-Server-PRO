#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

function loadDotEnv() {
  try {
    const source = readFileSync(".env", "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.trim().match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch {}
}
loadDotEnv();

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const workerName = "hendydichvumang-bot";
const pagesProject = "hendydichvumang";
const databaseName = "hendydichvumang";
const kvTitle = "hendydichvumang-cache";
const apiBase = "https://api.cloudflare.com/client/v4";

if (!accountId || !apiToken) {
  console.error("Thiếu CLOUDFLARE_ACCOUNT_ID hoặc CLOUDFLARE_API_TOKEN.");
  process.exit(1);
}

async function cloudflare(path, method = "GET", body) {
  const response = await fetch(apiBase + path, {
    method,
    headers: {
      Authorization: "Bearer " + apiToken,
      "Content-Type": "application/json"
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const messages = (payload.errors || []).map((item) => item.message).filter(Boolean);
    const error = new Error(messages.join("; ") || `Cloudflare API returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload.result;
}

async function ensureWorkersSubdomain() {
  const path = `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`;
  try {
    const result = await cloudflare(path);
    if (typeof result?.subdomain === "string" && result.subdomain) return result.subdomain;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const created = await cloudflare(path, "PUT", { subdomain: "hendydichvumang" });
  if (!created?.subdomain) throw new Error("Cloudflare did not return a workers.dev subdomain.");
  return created.subdomain;
}

async function ensurePagesProject() {
  const base = `/accounts/${encodeURIComponent(accountId)}/pages/projects`;
  try {
    const current = await cloudflare(base + "/" + pagesProject);
    if (current?.name === pagesProject) return;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  try {
    await cloudflare(base, "POST", { name: pagesProject, production_branch: "main" });
    console.log("Created Cloudflare Pages project.");
  } catch (error) {
    // A parallel deploy may have created the project after the GET.
    if (error.status !== 409 && error.status !== 400) throw error;
    const current = await cloudflare(base + "/" + pagesProject);
    if (current?.name !== pagesProject) throw error;
  }
}

async function ensureD1Database() {
  const base = `/accounts/${encodeURIComponent(accountId)}/d1/database`;
  const listed = await cloudflare(base + "?name=" + encodeURIComponent(databaseName) + "&per_page=100");
  const existing = Array.isArray(listed) ? listed.find((item) => item.name === databaseName) : null;
  if (existing?.uuid) return existing.uuid;

  const created = await cloudflare(base, "POST", {
    name: databaseName,
    primary_location_hint: "apac",
  });
  if (!created?.uuid) throw new Error("Cloudflare did not return a D1 database UUID.");
  console.log("Created Cloudflare D1 database.");
  return created.uuid;
}

async function ensureKvNamespace() {
  const base = `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces`;
  const listed = await cloudflare(base + "?per_page=1000");
  const existing = Array.isArray(listed) ? listed.find((item) => item.title === kvTitle) : null;
  if (existing?.id) return existing.id;

  try {
    const created = await cloudflare(base, "POST", { title: kvTitle });
    if (!created?.id) throw new Error("Cloudflare did not return a KV namespace ID.");
    console.log("Created Cloudflare KV namespace.");
    return created.id;
  } catch (error) {
    // If a parallel workflow created it after the list request, fetch it again.
    if (error.status !== 400 && error.status !== 409) throw error;
    const refreshed = await cloudflare(base + "?per_page=1000");
    const match = Array.isArray(refreshed) ? refreshed.find((item) => item.title === kvTitle) : null;
    if (!match?.id) throw error;
    return match.id;
  }
}

try {
  const [subdomain] = await Promise.all([
    ensureWorkersSubdomain(),
    ensurePagesProject()
  ]);
  const [databaseId, namespaceId] = await Promise.all([
    ensureD1Database(),
    ensureKvNamespace()
  ]);

  const workerApiUrl = `https://${workerName}.${subdomain}.workers.dev`;
  const miniAppUrl = `https://${pagesProject}.pages.dev`;

  const outputs = {
    WORKER_API_URL: workerApiUrl,
    MINI_APP_URL: miniAppUrl,
    D1_DATABASE_ID: databaseId,
    KV_NAMESPACE_ID: namespaceId
  };

  for (const [key, value] of Object.entries(outputs)) {
    if (!/^[A-Z0-9_]+$/.test(key) || /[\r\n]/.test(String(value))) {
      throw new Error("Invalid deployment output: " + key);
    }
  }

  writeFileSync(".cloudflare-outputs.json", JSON.stringify(outputs, null, 2) + "\n");
  if (process.env.GITHUB_ENV) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_ENV, Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  }

  console.log("Cloudflare resources are ready:");
  console.log("- Worker endpoint: " + workerApiUrl);
  console.log("- Mini App endpoint: " + miniAppUrl);
  console.log("- D1 database: " + databaseName);
  console.log("- KV namespace: " + kvTitle);
} catch (error) {
  console.error("Cloudflare bootstrap failed: " + error.message);
  console.error("Check token permissions: Workers Scripts, Pages, D1 and Workers KV.");
  process.exit(1);
}
