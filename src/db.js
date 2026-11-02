export function requireDatabase(env) {
  if (!env?.DB) throw new Error("D1 database binding DB is not configured");
  return env.DB;
}

export async function claimWebhookUpdate(db, updateId) {
  const result = await db.prepare(
    `INSERT INTO webhook_updates (update_id, status, attempts)
     VALUES (?, 'processing', 1)
     ON CONFLICT(update_id) DO UPDATE SET
       status = 'processing',
       attempts = webhook_updates.attempts + 1,
       error = NULL
     WHERE webhook_updates.status = 'failed'`
  ).bind(updateId).run();
  return Number(result?.meta?.changes ?? 0) > 0;
}

export async function finishWebhookUpdate(db, updateId, error = null) {
  if (error) {
    await db.prepare(
      "UPDATE webhook_updates SET status = 'failed', error = ?, processed_at = NULL WHERE update_id = ?"
    ).bind(String(error).slice(0, 500), updateId).run();
    return;
  }
  await db.prepare(
    "UPDATE webhook_updates SET status = 'processed', error = NULL, processed_at = CURRENT_TIMESTAMP WHERE update_id = ?"
  ).bind(updateId).run();
}

export async function upsertTelegramUser(db, user) {
  const telegramId = String(user.id);
  await db.batch([
    db.prepare(
      `INSERT INTO users (telegram_id, username, first_name)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(telegramId, user.username || null, user.first_name || "Khách"),
    db.prepare(
      "INSERT OR IGNORE INTO wallets (telegram_id, balance_vnd) VALUES (?, 0)"
    ).bind(telegramId)
  ]);
  return telegramId;
}

export async function getWalletBalance(db, telegramId) {
  const row = await db.prepare(
    "SELECT balance_vnd FROM wallets WHERE telegram_id = ?"
  ).bind(String(telegramId)).first();
  return Number(row?.balance_vnd ?? 0);
}

export async function getSession(db, telegramId) {
  const row = await db.prepare(
    "SELECT state_json, expires_at FROM user_sessions WHERE telegram_id = ?"
  ).bind(String(telegramId)).first();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await clearSession(db, telegramId);
    return null;
  }
  try {
    return JSON.parse(row.state_json);
  } catch {
    await clearSession(db, telegramId);
    return null;
  }
}

export async function setSession(db, telegramId, state, ttlMinutes = 15) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  await db.prepare(
    `INSERT INTO user_sessions (telegram_id, state_json, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       state_json = excluded.state_json,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(String(telegramId), JSON.stringify(state), expiresAt).run();
}

export async function clearSession(db, telegramId) {
  await db.prepare("DELETE FROM user_sessions WHERE telegram_id = ?")
    .bind(String(telegramId)).run();
}

export async function createVideoJob(db, telegramId, sourceUrl, jobId) {
  await db.prepare(
    "INSERT INTO video_jobs (id, telegram_id, source_url, status) VALUES (?, ?, ?, 'queued')"
  ).bind(jobId, String(telegramId), sourceUrl).run();
}

export async function updateVideoJob(db, jobId, values) {
  await db.prepare(
    `UPDATE video_jobs SET status = ?, external_job_id = ?, progress = ?, error_code = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(
    values.status,
    values.externalJobId || null,
    Number(values.progress || 0),
    values.errorCode || null,
    jobId
  ).run();
}

export async function getSetting(db, key) {
  const row = await db.prepare(
    "SELECT value_json FROM system_settings WHERE setting_key = ?"
  ).bind(key).first();
  if (!row) return null;
  try { return JSON.parse(row.value_json); } catch { return null; }
}

export async function setSetting(db, key, value, actorId = "admin") {
  await db.prepare(
    `INSERT INTO system_settings (setting_key, value_json, updated_by)
     VALUES (?, ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(key, JSON.stringify(value), String(actorId)).run();
}

export async function getAdminStats(db) {
  const [users, jobs, pendingPayments] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM users").first(),
    db.prepare("SELECT COUNT(*) AS total FROM video_jobs WHERE status IN ('queued', 'processing')").first(),
    db.prepare("SELECT COUNT(*) AS total FROM payment_requests WHERE status = 'pending'").first()
  ]);
  return {
    users: Number(users?.total || 0),
    activeVideoJobs: Number(jobs?.total || 0),
    pendingPayments: Number(pendingPayments?.total || 0)
  };
}

export async function writeAuditLog(db, id, actorId, action, target, details = {}) {
  await db.prepare(
    "INSERT INTO audit_logs (id, actor_id, action, target, details_json) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, String(actorId), action, target || null, JSON.stringify(details)).run();
}
