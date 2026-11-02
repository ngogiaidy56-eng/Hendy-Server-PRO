$ErrorActionPreference = "Stop"

$workerBase = "https://hendy-server-pro.ngogiaidy56.workers.dev"
$expectedWebhook = "$workerBase/webhook"

$secureKey = Read-Host "Enter WEBHOOK_SETUP_KEY (input hidden)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$setupKey = $null

try {
    $setupKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($setupKey)) {
        throw "WEBHOOK_SETUP_KEY is empty."
    }

    $headers = @{ Authorization = "Bearer $setupKey" }

    Write-Host "Activating Telegram webhook..." -ForegroundColor Cyan
    $activation = Invoke-RestMethod -Method Post -Uri "$workerBase/set-webhook" -Headers $headers -TimeoutSec 30

    if (-not $activation.ok) {
        throw "Telegram activation failed: $($activation.error) $($activation.message)"
    }

    Write-Host "Bot token accepted by Telegram." -ForegroundColor Green
    if ($activation.bot.username) {
        Write-Host "Bot: @$($activation.bot.username)"
    }
    Write-Host "Configured URL: $($activation.webhookUrl)"

    Write-Host "Verifying webhook with Telegram..." -ForegroundColor Cyan
    $info = Invoke-RestMethod -Method Get -Uri "$workerBase/webhook-info" -Headers $headers -TimeoutSec 30

    if (-not $info.ok) {
        throw "Could not read Telegram webhook status."
    }

    $actualWebhook = [string]$info.webhook.url
    if ($actualWebhook.TrimEnd("/") -ne $expectedWebhook.TrimEnd("/")) {
        throw "Webhook URL mismatch. Expected $expectedWebhook but Telegram reports $actualWebhook"
    }

    Write-Host "Webhook URL is correct." -ForegroundColor Green
    Write-Host "Pending Telegram updates: $($info.webhook.pending_update_count)"

    if ($info.webhook.last_error_message) {
        Write-Warning "Telegram's last webhook error: $($info.webhook.last_error_message)"
    } else {
        Write-Host "Telegram reports no last webhook delivery error." -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Now open Telegram and send /start to your bot." -ForegroundColor Green
}
catch {
    Write-Error $_
    if ($_.Exception.Response) {
        try {
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            if ($responseBody) { Write-Host $responseBody -ForegroundColor Yellow }
            $reader.Dispose()
        } catch {}
    }
    exit 1
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $setupKey = $null
    if ($secureKey) { $secureKey.Dispose() }
}
