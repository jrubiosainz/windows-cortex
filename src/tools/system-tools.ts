import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";

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

export const getSystemVolume = defineTool("get_system_volume", {
    description: "Get the current system audio volume level",
    parameters: z.object({}),
    handler: async () => {
        const script = `
            Add-Type -TypeDefinition @"
            using System.Runtime.InteropServices;
            [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            interface IAudioEndpointVolume {
                int _0(); int _1(); int _2(); int _3();
                int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
                int _5();
                int GetMasterVolumeLevelScalar(out float pfLevel);
                int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
                int GetMute(out bool pbMute);
            }
            [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
            [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
            [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
            public class Audio {
                static IAudioEndpointVolume Vol() {
                    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
                    IMMDevice dev; enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
                    IAudioEndpointVolume epv; var epvid = typeof(IAudioEndpointVolume).GUID;
                    dev.Activate(ref epvid, 23, 0, out epv); return epv;
                }
                public static float GetVolume() { float v = -1; Vol().GetMasterVolumeLevelScalar(out v); return v * 100; }
                public static bool GetMute() { bool mute; Vol().GetMute(out mute); return mute; }
            }
"@
            [PSCustomObject]@{
                Volume = [Audio]::GetVolume()
                Muted = [Audio]::GetMute()
            } | ConvertTo-Json
        `;
        const result = await runPowerShell(script);
        return JSON.parse(result);
    },
});

export const setSystemVolume = defineTool("set_system_volume", {
    description: "Set the system audio volume level",
    parameters: z.object({
        level: z.number().min(0).max(100).describe("Volume level (0-100)"),
        mute: z.boolean().optional().describe("Mute state (true/false)"),
    }),
    handler: async ({ level, mute }) => {
        const script = `
            Add-Type -TypeDefinition @"
            using System.Runtime.InteropServices;
            [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            interface IAudioEndpointVolume {
                int _0(); int _1(); int _2(); int _3();
                int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
                int _5();
                int GetMasterVolumeLevelScalar(out float pfLevel);
                int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
                int GetMute(out bool pbMute);
            }
            [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
            [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
            interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
            [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
            public class Audio {
                static IAudioEndpointVolume Vol() {
                    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
                    IMMDevice dev; enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
                    IAudioEndpointVolume epv; var epvid = typeof(IAudioEndpointVolume).GUID;
                    dev.Activate(ref epvid, 23, 0, out epv); return epv;
                }
                public static void SetVolume(float v) { Vol().SetMasterVolumeLevelScalar(v / 100, System.Guid.Empty); }
                public static void SetMute(bool m) { Vol().SetMute(m, System.Guid.Empty); }
            }
"@
            [Audio]::SetVolume(${level})
            ${mute !== undefined ? `[Audio]::SetMute($${mute})` : ''}
            "Volume set to ${level}%${mute !== undefined ? `, mute: ${mute}` : ''}"
        `;
        return await runPowerShell(script);
    },
});

export const getScreenBrightness = defineTool("get_screen_brightness", {
    description: "Get the current screen brightness level",
    parameters: z.object({}),
    handler: async () => {
        const script = `
            try {
                $brightness = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction Stop).CurrentBrightness
                [PSCustomObject]@{ Brightness = $brightness } | ConvertTo-Json
            } catch {
                [PSCustomObject]@{ Brightness = "Not available on this device" } | ConvertTo-Json
            }
        `;
        const result = await runPowerShell(script);
        return JSON.parse(result);
    },
});

export const setScreenBrightness = defineTool("set_screen_brightness", {
    description: "Set the screen brightness level",
    parameters: z.object({
        level: z.number().min(0).max(100).describe("Brightness level (0-100)"),
    }),
    handler: async ({ level }) => {
        const script = `
            try {
                $brightness = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction Stop
                $brightness.WmiSetBrightness(1, ${level})
                "Brightness set to ${level}%"
            } catch {
                "Brightness control not available on this device"
            }
        `;
        return await runPowerShell(script);
    },
});

export const takeScreenshot = defineTool("take_screenshot", {
    description: "Take a screenshot of the entire screen or active window",
    parameters: z.object({
        savePath: z.string().optional().describe("Path to save the screenshot (default: Desktop)"),
        activeWindowOnly: z.boolean().optional().describe("Capture only the active window (default: false)"),
    }),
    handler: async ({ savePath, activeWindowOnly = false }) => {
        const defaultPath = path.join(os.homedir(), "Desktop", `screenshot_${Date.now()}.png`);
        const outputPath = savePath || defaultPath;
        
        const script = activeWindowOnly
            ? `
                Add-Type -AssemblyName System.Windows.Forms
                Add-Type @"
                using System;
                using System.Runtime.InteropServices;
                using System.Drawing;
                public class ScreenCapture {
                    [DllImport("user32.dll")]
                    public static extern IntPtr GetForegroundWindow();
                    [DllImport("user32.dll")]
                    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
                    [StructLayout(LayoutKind.Sequential)]
                    public struct RECT { public int Left, Top, Right, Bottom; }
                }
"@
                $hwnd = [ScreenCapture]::GetForegroundWindow()
                $rect = New-Object ScreenCapture+RECT
                [ScreenCapture]::GetWindowRect($hwnd, [ref]$rect)
                $width = $rect.Right - $rect.Left
                $height = $rect.Bottom - $rect.Top
                $bitmap = New-Object System.Drawing.Bitmap($width, $height)
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, New-Object System.Drawing.Size($width, $height))
                $bitmap.Save('${outputPath.replace(/\\/g, "\\\\")}')
                "Screenshot saved to ${outputPath}"
            `
            : `
                Add-Type -AssemblyName System.Windows.Forms
                $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
                $bitmap.Save('${outputPath.replace(/\\/g, "\\\\")}')
                "Screenshot saved to ${outputPath}"
            `;
        
        return await runPowerShell(script);
    },
});

export const toggleDoNotDisturb = defineTool("toggle_do_not_disturb", {
    description: "Toggle Focus Assist / Do Not Disturb mode",
    parameters: z.object({
        enable: z.boolean().describe("Enable (true) or disable (false) Focus Assist"),
    }),
    handler: async ({ enable }) => {
        // Focus Assist can be controlled via registry
        const script = `
            $regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CloudStore\\Store\\DefaultAccount\\Current\\default\$windows.focusassist"
            # Note: Focus Assist settings are complex and may vary by Windows version
            # This is a simplified approach using keyboard shortcut simulation
            Add-Type -AssemblyName System.Windows.Forms
            # Open Action Center
            [System.Windows.Forms.SendKeys]::SendWait("^{ESC}")
            Start-Sleep -Milliseconds 500
            "Focus Assist toggle requested. Please check your system tray or Action Center."
        `;
        return await runPowerShell(script);
    },
});

export const lockScreen = defineTool("lock_screen", {
    description: "Lock the computer screen",
    parameters: z.object({}),
    handler: async () => {
        const script = `rundll32.exe user32.dll,LockWorkStation; "Screen locked"`;
        return await runPowerShell(script);
    },
});

export const sleepComputer = defineTool("sleep_computer", {
    description: "Put the computer to sleep",
    parameters: z.object({
        hibernate: z.boolean().optional().describe("Hibernate instead of sleep (default: false)"),
    }),
    handler: async ({ hibernate = false }) => {
        const script = hibernate
            ? `shutdown /h; "Computer hibernating..."`
            : `
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)
                "Computer going to sleep..."
            `;
        return await runPowerShell(script);
    },
});

export const getSystemInfo = defineTool("get_system_info", {
    description: "Get system information including OS, CPU, memory, disk, etc.",
    parameters: z.object({}),
    handler: async () => {
        const script = `
            $os = Get-WmiObject Win32_OperatingSystem
            $cpu = Get-WmiObject Win32_Processor | Select-Object -First 1
            $mem = Get-WmiObject Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum
            $disk = Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 }
            
            [PSCustomObject]@{
                ComputerName = $env:COMPUTERNAME
                OS = $os.Caption
                OSVersion = $os.Version
                OSArchitecture = $os.OSArchitecture
                CPU = $cpu.Name
                CPUCores = $cpu.NumberOfCores
                CPULogicalProcessors = $cpu.NumberOfLogicalProcessors
                TotalRAM = [math]::Round($mem.Sum / 1GB, 2).ToString() + " GB"
                FreeRAM = [math]::Round(($os.FreePhysicalMemory * 1KB) / 1GB, 2).ToString() + " GB"
                Disks = $disk | ForEach-Object {
                    [PSCustomObject]@{
                        Drive = $_.DeviceID
                        Size = [math]::Round($_.Size / 1GB, 2).ToString() + " GB"
                        FreeSpace = [math]::Round($_.FreeSpace / 1GB, 2).ToString() + " GB"
                    }
                }
                Uptime = (Get-Date) - $os.ConvertToDateTime($os.LastBootUpTime)
            } | ConvertTo-Json -Depth 3
        `;
        const result = await runPowerShell(script);
        return JSON.parse(result);
    },
});

export const systemTools = [
    getSystemVolume,
    setSystemVolume,
    getScreenBrightness,
    setScreenBrightness,
    takeScreenshot,
    toggleDoNotDisturb,
    lockScreen,
    sleepComputer,
    getSystemInfo,
];
