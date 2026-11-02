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
     WHERE webhook_updates.status = 'failed'
        OR (webhook_updates.status = 'processing' AND webhook_updates.received_at < datetime('now', '-5 minutes'))`
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

export async function getVideoJob(db, jobId) {
  return db.prepare(
    "SELECT id, telegram_id, source_url, status, progress FROM video_jobs WHERE id = ?"
  ).bind(String(jobId)).first();
}

export async function createPaymentRequest(db, id, telegramId, amountVnd, provider = "manual", providerReference = null) {
  await db.prepare(
    `INSERT INTO payment_requests (id, telegram_id, amount_vnd, status, provider, provider_reference)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  ).bind(id, String(telegramId), Number(amountVnd), provider, providerReference).run();
  return { id, telegramId, amountVnd, status: "pending" };
}

export async function getPaymentRequest(db, id) {
  return db.prepare(
    "SELECT id, telegram_id, amount_vnd, status, provider, provider_reference, created_at FROM payment_requests WHERE id = ?"
  ).bind(String(id)).first();
}

export async function listPendingPayments(db, limit = 20) {
  const rows = await db.prepare(
    `SELECT p.id, p.telegram_id, p.amount_vnd, p.provider, p.provider_reference, p.created_at, u.username, u.first_name
     FROM payment_requests p
     LEFT JOIN users u ON p.telegram_id = u.telegram_id
     WHERE p.status = 'pending'
     ORDER BY p.created_at ASC
     LIMIT ?`
  ).bind(limit).all();
  return rows.results || [];
}

export async function approvePayment(db, id, actorId = "admin") {
  const payment = await db.prepare(
    "SELECT id, telegram_id, amount_vnd, status FROM payment_requests WHERE id = ?"
  ).bind(String(id)).first();
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");
  if (payment.status !== "pending") throw new Error("PAYMENT_ALREADY_PROCESSED");

  const wallet = await db.prepare(
    "SELECT balance_vnd FROM wallets WHERE telegram_id = ?"
  ).bind(payment.telegram_id).first();
  const currentBalance = Number(wallet?.balance_vnd || 0);
  const newBalance = currentBalance + Number(payment.amount_vnd);
  const txId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  await db.batch([
    db.prepare(
      "UPDATE payment_requests SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(payment.id),
    db.prepare(
      "UPDATE wallets SET balance_vnd = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?"
    ).bind(newBalance, payment.telegram_id),
    db.prepare(
      `INSERT INTO wallet_transactions (id, telegram_id, amount_vnd, balance_after_vnd, transaction_type, reference, description)
       VALUES (?, ?, ?, ?, 'deposit', ?, ?)`
    ).bind(txId, payment.telegram_id, payment.amount_vnd, newBalance, payment.id, `Nạp tiền qua giao dịch ${payment.id}`),
    db.prepare(
      "INSERT INTO audit_logs (id, actor_id, action, target, details_json) VALUES (?, ?, 'payment_approve', ?, ?)"
    ).bind(auditId, String(actorId), payment.id, JSON.stringify({ amount: payment.amount_vnd, newBalance, telegramId: payment.telegram_id }))
  ]);

  return { success: true, paymentId: payment.id, telegramId: payment.telegram_id, amountVnd: payment.amount_vnd, newBalance };
}

export async function rejectPayment(db, id, actorId = "admin", reason = "") {
  const payment = await db.prepare(
    "SELECT id, telegram_id, amount_vnd, status FROM payment_requests WHERE id = ?"
  ).bind(String(id)).first();
  if (!payment) throw new Error("PAYMENT_NOT_FOUND");
  if (payment.status !== "pending") throw new Error("PAYMENT_ALREADY_PROCESSED");

  const auditId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      "UPDATE payment_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(payment.id),
    db.prepare(
      "INSERT INTO audit_logs (id, actor_id, action, target, details_json) VALUES (?, ?, 'payment_reject', ?, ?)"
    ).bind(auditId, String(actorId), payment.id, JSON.stringify({ reason, telegramId: payment.telegram_id }))
  ]);

  return { success: true, paymentId: payment.id, telegramId: payment.telegram_id };
}

export async function getUserVideoJobs(db, telegramId, limit = 10) {
  const rows = await db.prepare(
    "SELECT id, source_url, status, progress, error_code, created_at, updated_at FROM video_jobs WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?"
  ).bind(String(telegramId), limit).all();
  return rows.results || [];
}

export async function listRecentVideoJobs(db, limit = 20) {
  const rows = await db.prepare(
    `SELECT j.id, j.telegram_id, j.source_url, j.status, j.progress, j.created_at, u.username
     FROM video_jobs j
     LEFT JOIN users u ON j.telegram_id = u.telegram_id
     ORDER BY j.created_at DESC LIMIT ?`
  ).bind(limit).all();
  return rows.results || [];
}

export async function getUserTransactions(db, telegramId, limit = 10) {
  const rows = await db.prepare(
    "SELECT id, amount_vnd, balance_after_vnd, transaction_type, reference, description, created_at FROM wallet_transactions WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?"
  ).bind(String(telegramId), limit).all();
  return rows.results || [];
}

export async function listRecentAuditLogs(db, limit = 20) {
  const rows = await db.prepare(
    "SELECT id, actor_id, action, target, details_json, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ?"
  ).bind(limit).all();
  return rows.results || [];
}

