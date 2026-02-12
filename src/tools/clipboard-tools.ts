import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runPowerShell(script: string): Promise<string> {
    // Use -EncodedCommand to avoid escaping issues
    const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
        { maxBuffer: 10 * 1024 * 1024 }
    );
    if (stderr && !stdout) throw new Error(stderr);
    return stdout.trim();
}

export const readClipboard = defineTool("read_clipboard", {
    description: "Read the current contents of the clipboard",
    parameters: z.object({
        format: z.enum(["text", "html", "files"]).optional().describe("Clipboard format to read (default: text)"),
    }),
    handler: async ({ format = "text" }) => {
        const script = format === "files"
            ? `
                Add-Type -AssemblyName System.Windows.Forms
                $files = [System.Windows.Forms.Clipboard]::GetFileDropList()
                if ($files.Count -gt 0) {
                    $files | ConvertTo-Json
                } else {
                    "No files in clipboard"
                }
            `
            : format === "html"
            ? `
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::Html)
            `
            : `
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.Clipboard]::GetText()
            `;
        
        const result = await runPowerShell(script);
        
        if (format === "files") {
            try {
                return JSON.parse(result);
            } catch {
                return result;
            }
        }
        
        return result;
    },
});

export const writeClipboard = defineTool("write_clipboard", {
    description: "Write content to the clipboard",
    parameters: z.object({
        content: z.string().describe("Content to write to clipboard"),
        asHtml: z.boolean().optional().describe("Write as HTML format (default: false)"),
    }),
    handler: async ({ content, asHtml = false }) => {
        // Escape single quotes for PowerShell
        const escapedContent = content.replace(/'/g, "''");
        
        const script = asHtml
            ? `
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.Clipboard]::SetText('${escapedContent}', [System.Windows.Forms.TextDataFormat]::Html)
                "Content copied to clipboard as HTML"
            `
            : `
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.Clipboard]::SetText('${escapedContent}')
                "Content copied to clipboard"
            `;
        
        return await runPowerShell(script);
    },
});

export const clearClipboard = defineTool("clear_clipboard", {
    description: "Clear the clipboard contents",
    parameters: z.object({}),
    handler: async () => {
        const script = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Clipboard]::Clear()
            "Clipboard cleared"
        `;
        return await runPowerShell(script);
    },
});

export const getClipboardFormats = defineTool("get_clipboard_formats", {
    description: "Get available formats in the clipboard",
    parameters: z.object({}),
    handler: async () => {
        const script = `
            Add-Type -AssemblyName System.Windows.Forms
            $dataObj = [System.Windows.Forms.Clipboard]::GetDataObject()
            if ($dataObj) {
                $dataObj.GetFormats() | ConvertTo-Json
            } else {
                "[]"
            }
        `;
        const result = await runPowerShell(script);
        return JSON.parse(result || "[]");
    },
});

export const clipboardTools = [
    readClipboard,
    writeClipboard,
    clearClipboard,
    getClipboardFormats,
];
