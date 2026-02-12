import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
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

export const listFiles = defineTool("list_files", {
    description: "List files and folders in a directory",
    parameters: z.object({
        directory: z.string().describe("Directory path to list"),
        recursive: z.boolean().optional().describe("List recursively (default: false)"),
        pattern: z.string().optional().describe("Filter pattern (e.g., *.txt)"),
    }),
    handler: async ({ directory, recursive = false, pattern }) => {
        const resolvedPath = path.resolve(directory);
        
        if (recursive) {
            const script = `Get-ChildItem -Path '${resolvedPath}' -Recurse ${pattern ? `-Filter '${pattern}'` : ''} | Select-Object FullName, Name, Length, LastWriteTime, @{Name='IsDirectory';Expression={$_.PSIsContainer}} | ConvertTo-Json -Depth 2`;
            const stdout = await runPowerShell(script);
            return JSON.parse(stdout || "[]");
        }
        
        const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
        const results = [];
        
        for (const entry of entries) {
            if (pattern && !entry.name.match(new RegExp(pattern.replace(/\*/g, ".*")))) continue;
            
            const fullPath = path.join(resolvedPath, entry.name);
            const stats = await fs.stat(fullPath).catch(() => null);
            
            results.push({
                name: entry.name,
                path: fullPath,
                isDirectory: entry.isDirectory(),
                size: stats?.size ?? 0,
                modified: stats?.mtime?.toISOString() ?? null,
            });
        }
        
        return results;
    },
});

export const searchFiles = defineTool("search_files", {
    description: "Search for files by name or content",
    parameters: z.object({
        directory: z.string().describe("Directory to search in"),
        filename: z.string().optional().describe("File name pattern to search for"),
        content: z.string().optional().describe("Content to search within files"),
        maxResults: z.number().optional().describe("Maximum number of results (default: 50)"),
    }),
    handler: async ({ directory, filename, content, maxResults = 50 }) => {
        const resolvedPath = path.resolve(directory);
        
        if (content) {
            const script = `Get-ChildItem -Path '${resolvedPath}' -Recurse -File ${filename ? `-Filter '${filename}'` : ''} | Select-String -Pattern '${content}' -SimpleMatch | Select-Object -First ${maxResults} Path, LineNumber, Line | ConvertTo-Json`;
            const stdout = await runPowerShell(script);
            return JSON.parse(stdout || "[]");
        }
        
        const script = `Get-ChildItem -Path '${resolvedPath}' -Recurse ${filename ? `-Filter '${filename}'` : ''} | Select-Object -First ${maxResults} FullName, Name, Length, LastWriteTime | ConvertTo-Json`;
        const stdout = await runPowerShell(script);
        return JSON.parse(stdout || "[]");
    },
});

export const moveFile = defineTool("move_file", {
    description: "Move a file or folder to a new location",
    parameters: z.object({
        source: z.string().describe("Source path"),
        destination: z.string().describe("Destination path"),
    }),
    handler: async ({ source, destination }) => {
        await fs.rename(path.resolve(source), path.resolve(destination));
        return `Moved '${source}' to '${destination}'`;
    },
});

export const copyFile = defineTool("copy_file", {
    description: "Copy a file or folder",
    parameters: z.object({
        source: z.string().describe("Source path"),
        destination: z.string().describe("Destination path"),
        recursive: z.boolean().optional().describe("Copy recursively for folders (default: true)"),
    }),
    handler: async ({ source, destination, recursive = true }) => {
        const srcPath = path.resolve(source);
        const destPath = path.resolve(destination);
        const stats = await fs.stat(srcPath);
        
        if (stats.isDirectory()) {
            const script = `Copy-Item -Path '${srcPath}' -Destination '${destPath}' -Recurse -Force`;
            await runPowerShell(script);
        } else {
            await fs.copyFile(srcPath, destPath);
        }
        
        return `Copied '${source}' to '${destination}'`;
    },
});

export const deleteFile = defineTool("delete_file", {
    description: "Delete a file or folder",
    parameters: z.object({
        path: z.string().describe("Path to delete"),
        recursive: z.boolean().optional().describe("Delete recursively for folders (default: false)"),
    }),
    handler: async ({ path: filePath, recursive = false }) => {
        const resolvedPath = path.resolve(filePath);
        const stats = await fs.stat(resolvedPath);
        
        if (stats.isDirectory()) {
            if (recursive) {
                await fs.rm(resolvedPath, { recursive: true, force: true });
            } else {
                await fs.rmdir(resolvedPath);
            }
        } else {
            await fs.unlink(resolvedPath);
        }
        
        return `Deleted '${filePath}'`;
    },
});

export const renameFile = defineTool("rename_file", {
    description: "Rename a file or folder",
    parameters: z.object({
        path: z.string().describe("Current path"),
        newName: z.string().describe("New name (just the name, not full path)"),
    }),
    handler: async ({ path: filePath, newName }) => {
        const resolvedPath = path.resolve(filePath);
        const newPath = path.join(path.dirname(resolvedPath), newName);
        await fs.rename(resolvedPath, newPath);
        return `Renamed '${path.basename(filePath)}' to '${newName}'`;
    },
});

export const createFolder = defineTool("create_folder", {
    description: "Create a new folder",
    parameters: z.object({
        path: z.string().describe("Folder path to create"),
        recursive: z.boolean().optional().describe("Create parent folders if needed (default: true)"),
    }),
    handler: async ({ path: folderPath, recursive = true }) => {
        await fs.mkdir(path.resolve(folderPath), { recursive });
        return `Created folder '${folderPath}'`;
    },
});

export const readFile = defineTool("read_file", {
    description: "Read the contents of a file",
    parameters: z.object({
        path: z.string().describe("File path to read"),
        encoding: z.string().optional().describe("File encoding (default: utf-8)"),
        lines: z.number().optional().describe("Number of lines to read (default: all)"),
    }),
    handler: async ({ path: filePath, encoding = "utf-8", lines }) => {
        const content = await fs.readFile(path.resolve(filePath), encoding as BufferEncoding);
        
        if (lines) {
            return content.split("\n").slice(0, lines).join("\n");
        }
        
        return content;
    },
});

export const writeFile = defineTool("write_file", {
    description: "Write content to a file",
    parameters: z.object({
        path: z.string().describe("File path to write"),
        content: z.string().describe("Content to write"),
        append: z.boolean().optional().describe("Append to file instead of overwrite (default: false)"),
    }),
    handler: async ({ path: filePath, content, append = false }) => {
        const resolvedPath = path.resolve(filePath);
        
        if (append) {
            await fs.appendFile(resolvedPath, content);
            return `Appended content to '${filePath}'`;
        }
        
        await fs.writeFile(resolvedPath, content);
        return `Wrote content to '${filePath}'`;
    },
});

export const getFileInfo = defineTool("get_file_info", {
    description: "Get detailed information about a file or folder",
    parameters: z.object({
        path: z.string().describe("Path to get info for"),
    }),
    handler: async ({ path: filePath }) => {
        const resolvedPath = path.resolve(filePath);
        const stats = await fs.stat(resolvedPath);
        
        return {
            path: resolvedPath,
            name: path.basename(resolvedPath),
            extension: path.extname(resolvedPath),
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            size: stats.size,
            sizeFormatted: stats.size < 1024 
                ? `${stats.size} bytes`
                : stats.size < 1024 * 1024 
                    ? `${(stats.size / 1024).toFixed(2)} KB`
                    : `${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString(),
            accessed: stats.atime.toISOString(),
        };
    },
});

export const fileTools = [
    listFiles,
    searchFiles,
    moveFile,
    copyFile,
    deleteFile,
    renameFile,
    createFolder,
    readFile,
    writeFile,
    getFileInfo,
];
