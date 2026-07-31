# start-dev.ps1 - Opens three Windows Terminal tabs for bcweb dev

$repoRoot = "C:\bcweb"

# Tab 1: Server (npm run dev in bcweb-server)
Write-Host "Opening Server tab..."
wt -w 0 new-tab -d "$repoRoot\bcweb-server" cmd /k "npm run dev"

# Wait a moment for first tab to settle
Start-Sleep -Milliseconds 500

# Tab 2: Web (npm run dev in bcweb-web)
Write-Host "Opening Web tab..."
wt -w 0 new-tab -d "$repoRoot\bcweb-web" cmd /k "npm run dev"

# Wait a moment
Start-Sleep -Milliseconds 500

# Tab 3: Root folder - pre-types the Claude command at the prompt but does NOT run it.
# SendKeys types into the console input buffer of the tab that just took focus; no
# Enter is sent, so the operator reviews the command and presses Enter themselves.
$claudeCmd = "claude --dangerously-skip-permissions"
Write-Host "Opening root tab..."
wt -w 0 new-tab -d "$repoRoot" powershell -NoExit -Command "Start-Sleep -Milliseconds 400; (New-Object -ComObject wscript.shell).SendKeys('$claudeCmd')"

Write-Host "Dev environment started. Server tab first, then Web tab, then root folder tab."
Write-Host "Root tab has '$claudeCmd' ready at the prompt - press Enter to run it."
