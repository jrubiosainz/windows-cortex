import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runPowerShell(script: string): Promise<string> {
    // Escape script for PowerShell: use -EncodedCommand to avoid escaping issues
    const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
        { maxBuffer: 10 * 1024 * 1024 }
    );
    if (stderr && !stdout) throw new Error(stderr);
    return stdout.trim();
}

export const listInstalledApps = defineTool("list_installed_apps", {
    description: "List all installed applications on the system",
    parameters: z.object({
        filter: z.string().optional().describe("Filter apps by name"),
    }),
    handler: async ({ filter }) => {
        const script = `
            $apps = @()
            $uninstallPaths = @(
                'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
                'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
                'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
            )
            foreach ($path in $uninstallPaths) {
                $items = Get-ItemProperty $path -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName }
                $apps += $items
            }
            $apps | ${filter ? `Where-Object { $_.DisplayName -like '*${filter}*' } |` : ''} Select-Object -Property DisplayName, DisplayVersion, Publisher, InstallDate, InstallLocation -Unique | Sort-Object DisplayName | ConvertTo-Json -Depth 2
        `;
        const result = await runPowerShell(script);
        return JSON.parse(result || "[]");
    },
});

export const listRunningApps = defineTool("list_running_apps", {
    description: "List all running applications (processes with windows)",
    parameters: z.object({}),
    handler: async () => {
        const script = `
            Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | 
            Select-Object ProcessName, Id, MainWindowTitle, @{N='Memory';E={[math]::Round($_.WorkingSet64/1MB,2)}}, 
            @{N='CPU';E={[math]::Round($_.CPU,2)}}, StartTime |
            Sort-Object ProcessName | ConvertTo-Json -Depth 2
        `;
        const result = await runPowerShell(script);
        return JSON.parse(result || "[]");
    },
});

export const launchApp = defineTool("launch_app", {
    description: "Launch an application by name or path",
    parameters: z.object({
        appName: z.string().optional().describe("Application name (e.g., 'notepad', 'chrome', 'code')"),
        appPath: z.string().optional().describe("Full path to the application executable"),
        arguments: z.string().optional().describe("Arguments to pass to the application"),
    }),
    handler: async ({ appName, appPath, arguments: args }) => {
        if (!appName && !appPath) {
            throw new Error("Either appName or appPath must be provided");
        }
        
        const target = appPath || appName;
        const script = args
            ? `Start-Process -FilePath '${target}' -ArgumentList '${args}'`
            : `Start-Process -FilePath '${target}'`;
        
        await runPowerShell(script);
        return `Launched ${appName || appPath}`;
    },
});

export const quitApp = defineTool("quit_app", {
    description: "Quit an application by name or process ID",
    parameters: z.object({
        appName: z.string().optional().describe("Application/process name"),
        processId: z.number().optional().describe("Process ID"),
        force: z.boolean().optional().describe("Force quit (default: false)"),
    }),
    handler: async ({ appName, processId, force = false }) => {
        if (!appName && !processId) {
            throw new Error("Either appName or processId must be provided");
        }
        
        const script = processId
            ? `Stop-Process -Id ${processId} ${force ? "-Force" : ""} -ErrorAction SilentlyContinue`
            : `Get-Process -Name '${appName}' -ErrorAction SilentlyContinue | Stop-Process ${force ? "-Force" : ""}`;
        
        await runPowerShell(script);
        return `Quit ${appName || `process ${processId}`}`;
    },
});

export const switchToApp = defineTool("switch_to_app", {
    description: "Switch to an application (bring to foreground)",
    parameters: z.object({
        appName: z.string().optional().describe("Application/process name"),
        processId: z.number().optional().describe("Process ID"),
    }),
    handler: async ({ appName, processId }) => {
        const script = `
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class AppSwitcher {
                [DllImport("user32.dll")]
                [return: MarshalAs(UnmanagedType.Bool)]
                public static extern bool SetForegroundWindow(IntPtr hWnd);
                [DllImport("user32.dll")]
                public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
            }
"@
            ${processId
                ? `$proc = Get-Process -Id ${processId} -ErrorAction SilentlyContinue`
                : `$proc = Get-Process -Name '${appName}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`
            }
            if ($proc -and $proc.MainWindowHandle) {
                [AppSwitcher]::ShowWindow($proc.MainWindowHandle, 9)
                [AppSwitcher]::SetForegroundWindow($proc.MainWindowHandle)
                "Switched to $($proc.ProcessName)"
            } else {
                "Application not found or has no window"
            }
        `;
        return await runPowerShell(script);
    },
});

export const appTools = [
    listInstalledApps,
    listRunningApps,
    launchApp,
    quitApp,
    switchToApp,
];
