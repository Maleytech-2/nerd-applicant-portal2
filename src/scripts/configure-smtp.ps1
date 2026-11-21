param(
    [string]$AdminEmail = "abdulmalikadamu379@gmail.com"
)

$envFile = Join-Path $PSScriptRoot "..\.env"
$appPassword = Read-Host "Enter the Gmail App Password (input hidden)" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($appPassword)

try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
    $password = $password.Replace(" ", "")

    if ($password.Length -ne 16) {
        throw "The Gmail App Password must contain 16 characters. The password was not saved."
    }

    $values = [ordered]@{
        SMTP_HOST = "smtp.gmail.com"
        SMTP_PORT = "465"
        SMTP_SECURE = "true"
        SMTP_USER = $AdminEmail
        SMTP_PASSWORD = $password
        SMTP_FROM = "OGAH JOHN BUSINESS CENTER <$AdminEmail>"
        ADMIN_NOTIFICATION_EMAIL = $AdminEmail
    }

    $lines = if (Test-Path $envFile) {
        Get-Content $envFile
    } else {
        @()
    }

    foreach ($key in $values.Keys) {
        $escapedKey = [Regex]::Escape($key)
        $pattern = "^$escapedKey="
        $replacement = "$key=$($values[$key])"

        $matches = @($lines | Where-Object { $_ -match $pattern })
        if ($matches.Count -gt 0) {
            $lines = $lines | ForEach-Object {
                if ($_ -match $pattern) { $replacement } else { $_ }
            }
        } else {
            $lines += $replacement
        }
    }

    Set-Content -Path $envFile -Value $lines -Encoding UTF8
    Write-Host "SMTP settings saved securely to .env. Restart the Node.js portal and run: npm run email:process"
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
}
