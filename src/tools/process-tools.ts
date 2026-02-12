import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runPowerShell(script: string): Promise<string> {
    // Use -EncodedCommand to avoid escaping issues with $_ variable
    const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
        { maxBuffer: 10 * 1024 * 1024 }
    );
    if (stderr && !stdout) throw new Error(stderr);
    return stdout.trim();
}

export const listProcesses = defineTool("list_processes", {
    description: "List all running processes with their details",
    parameters: z.object({
        sortBy: z.enum(["cpu", "memory", "name", "pid"]).optional().describe("Sort by field (default: memory)"),
        limit: z.number().optional().describe("Limit number of results (default: all)"),
        filter: z.string().optional().describe("Filter by process name"),
    }),
    handler: async ({ sortBy = "memory", limit, filter }) => {
        const sortField = {
            cpu: "CPU",
            memory: "@{E={$_.WorkingSet64}}",
            name: "ProcessName",
            pid: "Id",
        }[sortBy];
        
        const script = `
            Get-Process ${filter ? `-Name '*${filter}*' -ErrorAction SilentlyContinue` : ''} |
            Select-Object ProcessName, Id, 
                @{N='CPU_Seconds';E={[math]::Round($_.CPU,2)}},
                @{N='Memory_MB';E={[math]::Round($_.WorkingSet64/1MB,2)}},
                @{N='Threads';E={$_.Threads.Count}},
                @{N='Handles';E={$_.HandleCount}},
                StartTime,
                Path |
            Sort-Object -Property ${sortField} -Descending |
            ${limit ? `Select-Object -First ${limit} |` : ''}
            ConvertTo-Json -Depth 2
        `;
        const result = await runPowerShell(script);
        return JSON.parse(result || "[]");
    },
});

export const getProcessInfo = defineTool("get_process_info", {
    description: "Get detailed information about a specific process",
    parameters: z.object({
        processId: z.number().optional().describe("Process ID"),
        processName: z.string().optional().describe("Process name"),
    }),
    handler: async ({ processId, processName }) => {
        if (!processId && !processName) {
            throw new Error("Either processId or processName must be provided");
        }
        
        const script = processId
            ? `
                $proc = Get-Process -Id ${processId} -ErrorAction SilentlyContinue
                if ($proc) {
                    $proc | Select-Object ProcessName, Id, 
                        @{N='CPU_Seconds';E={[math]::Round($_.CPU,2)}},
                        @{N='Memory_MB';E={[math]::Round($_.WorkingSet64/1MB,2)}},
                        @{N='Virtual_MB';E={[math]::Round($_.VirtualMemorySize64/1MB,2)}},
                        @{N='Threads';E={$_.Threads.Count}},
                        @{N='Handles';E={$_.HandleCount}},
                        @{N='Priority';E={$_.PriorityClass}},
                        StartTime,
                        Path,
                        MainWindowTitle,
                        MainModule | ConvertTo-Json -Depth 2
                } else { "Process not found" }
            `
            : `
                $proc = Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($proc) {
                    $proc | Select-Object ProcessName, Id, 
                        @{N='CPU_Seconds';E={[math]::Round($_.CPU,2)}},
                        @{N='Memory_MB';E={[math]::Round($_.WorkingSet64/1MB,2)}},
                        @{N='Virtual_MB';E={[math]::Round($_.VirtualMemorySize64/1MB,2)}},
                        @{N='Threads';E={$_.Threads.Count}},
                        @{N='Handles';E={$_.HandleCount}},
                        @{N='Priority';E={$_.PriorityClass}},
                        StartTime,
                        Path,
                        MainWindowTitle,
                        MainModule | ConvertTo-Json -Depth 2
                } else { "Process not found" }
            `;
        const result = await runPowerShell(script);
        try {
            return JSON.parse(result);
        } catch {
            return result;
        }
    },
});

export const killProcess = defineTool("kill_process", {
    description: "Kill/terminate a process",
    parameters: z.object({
        processId: z.number().optional().describe("Process ID to kill"),
        processName: z.string().optional().describe("Process name to kill (kills all matching)"),
        force: z.boolean().optional().describe("Force kill (default: false)"),
    }),
    handler: async ({ processId, processName, force = false }) => {
        if (!processId && !processName) {
            throw new Error("Either processId or processName must be provided");
        }
        
        const script = processId
            ? `Stop-Process -Id ${processId} ${force ? "-Force" : ""} -ErrorAction SilentlyContinue; "Killed process ${processId}"`
            : `Stop-Process -Name '${processName}' ${force ? "-Force" : ""} -ErrorAction SilentlyContinue; "Killed processes named '${processName}'"`;
        
        return await runPowerShell(script);
    },
});

export const getTopProcesses = defineTool("get_top_processes", {
    description: "Get top resource-consuming processes",
    parameters: z.object({
        resource: z.enum(["cpu", "memory"]).describe("Resource to sort by"),
        count: z.number().optional().describe("Number of top processes (default: 10)"),
    }),
    handler: async ({ resource, count = 10 }) => {
        const script = resource === "cpu"
            ? `
                Get-Process | Sort-Object CPU -Descending | Select-Object -First ${count} |
                Select-Object ProcessName, Id, 
                    @{N='CPU_Seconds';E={[math]::Round($_.CPU,2)}},
                    @{N='Memory_MB';E={[math]::Round($_.WorkingSet64/1MB,2)}} |
                ConvertTo-Json -Depth 2
            `
            : `
                Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${count} |
                Select-Object ProcessName, Id, 
                    @{N='CPU_Seconds';E={[math]::Round($_.CPU,2)}},
                    @{N='Memory_MB';E={[math]::Round($_.WorkingSet64/1MB,2)}} |
                ConvertTo-Json -Depth 2
            `;
        const result = await runPowerShell(script);
        return JSON.parse(result || "[]");
    },
});

export const getSystemResourceUsage = defineTool("get_system_resource_usage", {
    description: "Get overall system resource usage (CPU, memory, disk)",
    parameters: z.object({}),
    handler: async () => {
        const script = `
            $cpu = (Get-WmiObject Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
            $os = Get-WmiObject Win32_OperatingSystem
            $totalMem = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
            $freeMem = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
            $usedMem = $totalMem - $freeMem
            $memPercent = [math]::Round(($usedMem / $totalMem) * 100, 1)
            
            $disks = Get-WmiObject Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
                [PSCustomObject]@{
                    Drive = $_.DeviceID
                    TotalGB = [math]::Round($_.Size / 1GB, 2)
                    FreeGB = [math]::Round($_.FreeSpace / 1GB, 2)
                    UsedPercent = [math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1)
                }
            }
            
            [PSCustomObject]@{
                CPU_Percent = $cpu
                Memory = @{
                    TotalGB = $totalMem
                    UsedGB = $usedMem
                    FreeGB = $freeMem
                    UsedPercent = $memPercent
                }
                Disks = $disks
            } | ConvertTo-Json -Depth 3
        `;
        const result = await runPowerShell(script);
        return JSON.parse(result);
    },
});

export const processTools = [
    listProcesses,
    getProcessInfo,
    killProcess,
    getTopProcesses,
    getSystemResourceUsage,
];
