# X自動投稿 Windowsタスクスケジューラ登録スクリプト
# 実行方法: PowerShellを管理者として開き、このスクリプトを実行
# Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
# .\setup_scheduler.ps1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$NodePath = (Get-Command node.exe -ErrorAction SilentlyContinue)?.Source
if (-not $NodePath) {
    # よくあるNode.jsインストールパスを探す
    $candidates = @(
        "C:\Program Files\nodejs\node.exe",
        "$env:APPDATA\nvm\current\node.exe",
        "$env:LOCALAPPDATA\nvs\default\node.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $NodePath = $c; break }
    }
}
if (-not $NodePath) {
    Write-Error "node.exe が見つかりません。Node.jsをインストールしてください。"
    exit 1
}

Write-Host "Node.js: $NodePath"
Write-Host "スクリプトフォルダ: $ScriptDir"
Write-Host ""

# タスク定義
$tasks = @(
    @{ Name = "X-AutoPost-Morning"; Time = "07:00"; Mode = "morning" },
    @{ Name = "X-AutoPost-Noon";    Time = "12:00"; Mode = "noon"    },
    @{ Name = "X-AutoPost-Evening"; Time = "20:00"; Mode = "evening" }
)

foreach ($t in $tasks) {
    $action = New-ScheduledTaskAction `
        -Execute $NodePath `
        -Argument "post.js $($t.Mode)" `
        -WorkingDirectory $ScriptDir

    $trigger = New-ScheduledTaskTrigger -Daily -At $t.Time

    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
        -RunOnlyIfNetworkAvailable `
        -StartWhenAvailable

    # 既存タスクを削除してから登録
    Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction SilentlyContinue

    Register-ScheduledTask `
        -TaskName $t.Name `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "X自動投稿 - $($t.Mode) ($($t.Time))" `
        -RunLevel Highest `
        -Force | Out-Null

    Write-Host "✅ 登録: $($t.Name) -> 毎日 $($t.Time)"
}

Write-Host ""
Write-Host "=== 登録されたタスク ==="
Get-ScheduledTask -TaskPath "\" | Where-Object { $_.TaskName -like "X-AutoPost-*" } | `
    Format-Table TaskName, State -AutoSize

Write-Host ""
Write-Host "dry-runテスト（投稿せずに動作確認）:"
Write-Host "  node `"$ScriptDir\post.js`" morning --dry-run"
