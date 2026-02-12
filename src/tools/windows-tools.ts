import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Helper to run PowerShell commands using encoded command to avoid escaping issues
async function runPowerShell(script: string): Promise<string> {
    const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
        { maxBuffer: 10 * 1024 * 1024 }
    );
    if (stderr && !stdout) throw new Error(stderr);
    return stdout.trim();
}

export const listWindows = defineTool("list_windows", {
    description: "List all open windows with their process names, titles, and window handles",
    parameters: z.object({}),
    handler: async () => {
        const script = `
Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | 
Select-Object @{N='Handle';E={$_.MainWindowHandle.ToInt64()}}, 
    @{N='Title';E={$_.MainWindowTitle}}, 
    @{N='ProcessId';E={$_.Id}}, 
    ProcessName | 
ConvertTo-Json -Depth 2
        `;
        const result = await runPowerShell(script);
        try {
            return JSON.parse(result || "[]");
        } catch {
            return result;
        }
    },
});

export const focusWindow = defineTool("focus_window", {
    description: "Bring a window to the foreground and give it focus by title",
    parameters: z.object({
        windowTitle: z.string().describe("Part of the window title to match"),
    }),
    handler: async ({ windowTitle }) => {
        const script = `
$wshell = New-Object -ComObject wscript.shell
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${windowTitle}*' } | Select-Object -First 1
if ($proc) {
    $wshell.AppActivate($proc.Id)
    "Window '$($proc.MainWindowTitle)' focused successfully"
} else {
    "No window found matching '${windowTitle}'"
}
        `;
        return await runPowerShell(script);
    },
});

export const closeWindow = defineTool("close_window", {
    description: "Close a window by title",
    parameters: z.object({
        windowTitle: z.string().describe("Part of the window title to match"),
    }),
    handler: async ({ windowTitle }) => {
        const script = `
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${windowTitle}*' } | Select-Object -First 1
if ($proc) {
    $result = $proc.CloseMainWindow()
    if ($result) {
        "Window '$($proc.MainWindowTitle)' close signal sent"
    } else {
        "Could not close window - it may not respond to close signals"
    }
} else {
    "No window found matching '${windowTitle}'"
}
        `;
        return await runPowerShell(script);
    },
});

export const minimizeWindow = defineTool("minimize_window", {
    description: "Minimize a window by title",
    parameters: z.object({
        windowTitle: z.string().describe("Part of the window title to match"),
    }),
    handler: async ({ windowTitle }) => {
        const script = `
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${windowTitle}*' } | Select-Object -First 1
if ($proc) {
    $sig = '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
    Add-Type -MemberDefinition $sig -Name Win32 -Namespace Native
    [Native.Win32]::ShowWindow($proc.MainWindowHandle, 6) | Out-Null
    "Window '$($proc.MainWindowTitle)' minimized"
} else {
    "No window found matching '${windowTitle}'"
}
        `;
        return await runPowerShell(script);
    },
});

export const maximizeWindow = defineTool("maximize_window", {
    description: "Maximize a window by title",
    parameters: z.object({
        windowTitle: z.string().describe("Part of the window title to match"),
    }),
    handler: async ({ windowTitle }) => {
        const script = `
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${windowTitle}*' } | Select-Object -First 1
if ($proc) {
    $sig = '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
    Add-Type -MemberDefinition $sig -Name Win32Max -Namespace Native
    [Native.Win32Max]::ShowWindow($proc.MainWindowHandle, 3) | Out-Null
    "Window '$($proc.MainWindowTitle)' maximized"
} else {
    "No window found matching '${windowTitle}'"
}
        `;
        return await runPowerShell(script);
    },
});

export const restoreWindow = defineTool("restore_window", {
    description: "Restore a minimized or maximized window to normal state",
    parameters: z.object({
        windowTitle: z.string().describe("Part of the window title to match"),
    }),
    handler: async ({ windowTitle }) => {
        const script = `
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${windowTitle}*' } | Select-Object -First 1
if ($proc) {
    $sig = '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
    Add-Type -MemberDefinition $sig -Name Win32Restore -Namespace Native
    [Native.Win32Restore]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
    "Window '$($proc.MainWindowTitle)' restored"
} else {
    "No window found matching '${windowTitle}'"
}
        `;
        return await runPowerShell(script);
    },
});

export const windowTools = [
    listWindows,
    focusWindow,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    restoreWindow,
];
