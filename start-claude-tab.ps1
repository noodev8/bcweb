# start-claude-tab.ps1 - Opens a PowerShell session with the Claude command already typed
# at the prompt (not executed), so the operator just presses ENTER - or edits it first.
#
# How: we push synthetic key events straight into THIS console's own input buffer
# (WriteConsoleInput on our STDIN handle). PSReadLine then reads them exactly as if they
# had been typed, so the text lands on the editable command line.
#
# Why not SendKeys: SendKeys targets the foreground window, so it only worked if the new
# Windows Terminal tab happened to have focus at the right moment - it usually didn't.
# WriteConsoleInput talks to our own console handle, so focus is irrelevant.

$claudeCmd = 'claude --dangerously-skip-permissions'

Add-Type -Namespace BcWeb -Name ConsoleInput -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
struct KEY_EVENT_RECORD {
    public int bKeyDown;
    public ushort wRepeatCount;
    public ushort wVirtualKeyCode;
    public ushort wVirtualScanCode;
    public ushort UnicodeChar;
    public int dwControlKeyState;
}

[StructLayout(LayoutKind.Sequential)]
struct INPUT_RECORD {
    public ushort EventType;   // 1 = KEY_EVENT
    public KEY_EVENT_RECORD KeyEvent;
}

[DllImport("kernel32.dll", SetLastError = true)]
static extern IntPtr GetStdHandle(int nStdHandle);

[DllImport("kernel32.dll", SetLastError = true)]
static extern bool WriteConsoleInputW(IntPtr hConsoleInput, INPUT_RECORD[] lpBuffer, uint nLength, out uint lpNumberOfEventsWritten);

[DllImport("user32.dll")]
static extern short VkKeyScanW(char ch);

public static void Inject(string text) {
    IntPtr stdin = GetStdHandle(-10);           // STD_INPUT_HANDLE
    var records = new INPUT_RECORD[text.Length * 2];
    for (int i = 0; i < text.Length; i++) {
        short vk = VkKeyScanW(text[i]);         // -1 when unmappable; harmless, char still wins
        var key = new KEY_EVENT_RECORD();
        key.wRepeatCount = 1;
        key.wVirtualKeyCode = (ushort)(vk == -1 ? 0 : (vk & 0xFF));
        key.wVirtualScanCode = 0;
        key.UnicodeChar = text[i];
        key.dwControlKeyState = 0;

        key.bKeyDown = 1;
        records[i * 2].EventType = 1;
        records[i * 2].KeyEvent = key;

        key.bKeyDown = 0;
        records[i * 2 + 1].EventType = 1;
        records[i * 2 + 1].KeyEvent = key;
    }
    uint written;
    WriteConsoleInputW(stdin, records, (uint)records.Length, out written);
}
'@

[BcWeb.ConsoleInput]::Inject($claudeCmd)
