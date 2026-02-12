import { app, BrowserWindow, ipcMain, nativeTheme, session, globalShortcut, Tray, Menu } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { CopilotClient, SessionEvent } from "@github/copilot-sdk";
import { DefaultAzureCredential } from "@azure/identity";
import { allTools } from "./tools/index.js";

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let copilotClient: CopilotClient | null = null;
let copilotSession: any = null;
let recordingProcess: ChildProcess | null = null;
let tempAudioFile: string | null = null;
let azureCredential: DefaultAzureCredential | null = null;

// Settings file path
const settingsPath = path.join(app.getPath("userData"), "settings.json");
const historyPath = path.join(app.getPath("userData"), "chat-history.json");

// Available models cache
let availableModels: string[] = [];
let copilotStatus: any = null;

// Initialize Azure credential
function getAzureCredential(): DefaultAzureCredential {
    if (!azureCredential) {
        azureCredential = new DefaultAzureCredential();
    }
    return azureCredential;
}

// Get access token for Azure Cognitive Services
async function getAzureAccessToken(): Promise<string> {
    const credential = getAzureCredential();
    const tokenResponse = await credential.getToken("https://cognitiveservices.azure.com/.default");
    return tokenResponse.token;
}

// Settings interface with new options
interface AppSettings {
    whisperEndpoint?: string;
    reasoningEffort?: "low" | "medium" | "high";
    selectedModel?: string;
    disabledToolCategories?: string[];
    theme?: "dark" | "light" | "system";
    globalShortcut?: string;
}

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    hasImage?: boolean;
}

interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
}

// Load settings
function loadSettings(): AppSettings {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        }
    } catch (e) {
        console.error("Error loading settings:", e);
    }
    return { reasoningEffort: "medium", theme: "system", globalShortcut: "CommandOrControl+Shift+Space" };
}

// Load chat history
function loadHistory(): ChatSession[] {
    try {
        if (fs.existsSync(historyPath)) {
            return JSON.parse(fs.readFileSync(historyPath, "utf8"));
        }
    } catch (e) {
        console.error("Error loading history:", e);
    }
    return [];
}

// Save chat history
function saveHistory(sessions: ChatSession[]): void {
    try {
        // Keep only last 50 sessions
        const trimmed = sessions.slice(-50);
        fs.writeFileSync(historyPath, JSON.stringify(trimmed, null, 2));
    } catch (e) {
        console.error("Error saving history:", e);
    }
}

// Save settings
function saveSettings(settings: AppSettings): void {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        // Re-register global shortcut if changed
        registerGlobalShortcut(settings.globalShortcut || "CommandOrControl+Shift+Space");
    } catch (e) {
        console.error("Error saving settings:", e);
    }
}

// Register global shortcut
function registerGlobalShortcut(shortcut: string) {
    globalShortcut.unregisterAll();
    try {
        globalShortcut.register(shortcut, () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                if (!mainWindow.isVisible()) mainWindow.show();
                mainWindow.focus();
                // Focus the input
                mainWindow.webContents.send("focus-input");
            }
        });
        console.log("Global shortcut registered:", shortcut);
    } catch (e) {
        console.error("Failed to register global shortcut:", e);
    }
}

// Create tray icon
function createTray() {
    const iconPath = path.join(__dirname, "../build-resources/icon.ico");
    tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
        { 
            label: "Show Desktop Assistant", 
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: "separator" },
        {
            label: "Quick Commands",
            submenu: [
                { label: "📅 My meetings today", click: () => sendQuickCommand("/meetings") },
                { label: "📧 Unread emails", click: () => sendQuickCommand("/emails") },
                { label: "📊 System info", click: () => sendQuickCommand("/system") },
                { label: "📸 Screenshot", click: () => sendQuickCommand("/screenshot") },
            ]
        },
        { type: "separator" },
        { label: "Settings", click: () => mainWindow?.webContents.send("open-settings") },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() }
    ]);
    
    tray.setToolTip("Desktop Assistant - Ctrl+Shift+Space");
    tray.setContextMenu(contextMenu);
    
    tray.on("click", () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
}

function sendQuickCommand(command: string) {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("quick-command", command);
    }
}

// Run PowerShell with encoded command
async function runPowerShell(script: string): Promise<string> {
    const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
        { maxBuffer: 10 * 1024 * 1024 }
    );
    if (stderr && !stdout) throw new Error(stderr);
    return stdout.trim();
}

async function createWindow() {
    // Set up permission handler for microphone access
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'microphone', 'audio-capture'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });

    // Also handle permission checks
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        const allowedPermissions = ['media', 'microphone', 'audio-capture'];
        return allowedPermissions.includes(permission);
    });

    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 400,
        minHeight: 500,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff",
        icon: path.join(__dirname, "../build-resources/icon.ico"),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        frame: true,
        title: "Desktop Assistant",
    });

    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

async function initializeCopilot() {
    const settings = loadSettings();
    try {
        console.log("Initializing Copilot client...");
        copilotClient = new CopilotClient({
            // Pass CLI args to allow all permissions automatically
            cliArgs: ["--allow-all"],
            logLevel: "debug"
        });
        await copilotClient.start();
        console.log("Copilot client started");
        
        // Fetch available models (new in v0.1.15+)
        try {
            const modelsResult = await (copilotClient as any).listModels?.();
            if (modelsResult?.models) {
                availableModels = modelsResult.models.map((m: any) => m.id || m.name || m);
                console.log("Available models:", availableModels);
            }
        } catch (e) {
            console.log("Could not fetch models list:", e);
            // Default models available via GitHub Copilot (Feb 2026)
            availableModels = [
                "gpt-4.1",
                "gpt-4o",
                "gpt-5-mini",
                "gpt-5",
                "gpt-5.1",
                "gpt-5.1-codex",
                "gpt-5.1-codex-max",
                "gpt-5.1-codex-mini",
                "gpt-5.2",
                "gpt-5.2-codex",
                "claude-haiku-4.5",
                "claude-sonnet-4",
                "claude-sonnet-4.5",
                "claude-opus-4.5",
                "claude-opus-4.6",
                "gemini-2.5-pro",
                "gemini-3-flash",
                "gemini-3-pro",
                "o3-mini",
            ];
        }
        
        // Get status (new in v0.1.15+)
        try {
            copilotStatus = await (copilotClient as any).getStatus?.();
            console.log("Copilot status:", copilotStatus);
        } catch (e) {
            console.log("Could not fetch status:", e);
        }
        
        // Determine which tools to use based on settings
        const enabledTools = settings.disabledToolCategories?.length 
            ? allTools.filter(t => !settings.disabledToolCategories?.some(cat => t.name.includes(cat)))
            : allTools;
        
        const selectedModel = settings.selectedModel || "gpt-4.1";
        console.log("Creating session with", enabledTools.length, "tools, model:", selectedModel);
        
        // reasoning_effort only works with reasoning models (o1, o3-mini, etc.)
        const isReasoningModel = selectedModel.startsWith("o1") || selectedModel.startsWith("o3") || selectedModel.startsWith("gpt-5");
        
        const sessionConfig: any = {
            model: selectedModel,
            streaming: true,
            tools: enabledTools,
        };
        
        // Only add reasoningEffort for compatible models
        if (isReasoningModel && settings.reasoningEffort) {
            sessionConfig.reasoningEffort = settings.reasoningEffort;
        }
        
        copilotSession = await copilotClient.createSession({
            ...sessionConfig,
            // NEW: Infinite Sessions support (v0.1.18) - sessions persist longer
            // Auto-approve all permission requests
            onPermissionRequest: async (request, invocation) => {
                console.log("Permission request:", request.kind, request);
                return { kind: "approved" };
            },
            // NEW: User Input Handler (v0.1.20) - ask user for confirmation on dangerous operations
            onUserInputRequest: async (request) => {
                console.log("User input request:", request);
                // Send to renderer for user confirmation
                if (mainWindow && !mainWindow.isDestroyed()) {
                    return new Promise((resolve) => {
                        const requestId = Date.now().toString();
                        mainWindow!.webContents.send("user-input-request", { 
                            requestId,
                            message: request.message || "The assistant needs your confirmation",
                            type: request.type || "confirm"
                        });
                        // Set up one-time listener for response
                        ipcMain.once(`user-input-response-${requestId}`, (_event, response) => {
                            resolve({ response: response.confirmed ? "yes" : "no" });
                        });
                        // Timeout after 60 seconds
                        setTimeout(() => resolve({ response: "no" }), 60000);
                    });
                }
                return { response: "yes" };
            },
            systemMessage: {
                content: `You are a helpful Desktop Assistant.

CRITICAL RULES:
1. ALWAYS respond in the SAME LANGUAGE the user uses. Match their language exactly.
2. NEVER invent or assume data. Only report what the tools return.
3. Take your time - accuracy over speed.

CALENDAR AVAILABILITY ANALYSIS - MANDATORY PROCESS:
When asked to find free slots for a time range (e.g., "free slots between 9:00 and 15:00 next week"):

STEP 1: Query each day separately using get_my_meetings

STEP 2: For EACH DAY, create an HOUR-BY-HOUR grid showing what's in each slot:

**MONDAY [date] (9:00-15:00):**
• 09:00-10:00: [meeting name] or **FREE SLOT**
• 10:00-11:00: [meeting name] or **FREE SLOT**
• 11:00-12:00: [meeting name] or **FREE SLOT**
• 12:00-13:00: [meeting name] or **FREE SLOT**
• 13:00-14:00: [meeting name] or **FREE SLOT**
• 14:00-15:00: [meeting name] or **FREE SLOT**

**TUESDAY [date] (9:00-15:00):**
• 09:00-10:00: ...
[continue for each hour]

[Repeat for each day of the week]

STEP 3: After showing ALL days hour-by-hour, provide:

**SUMMARY OF AVAILABLE SLOTS:**
- Monday: [list free hours or "No free slots"]
- Tuesday: [list free hours or "No free slots"]
- ...

**BEST OPTIONS FOR A [X]-HOUR MEETING:**
[List the best consecutive free slots]

RULES FOR HOUR GRID:
- If a meeting covers part of an hour (e.g., 9:30-10:30), mark BOTH hours as occupied
- If a meeting is marked as "tentative", still show it but note "(tentative)"
- Mark **FREE SLOT** in bold for empty hours
- Show the actual meeting name for occupied hours

Available tools:
- Windows: list, focus, close, minimize, maximize
- Files: list, search, move, copy, delete, rename
- Apps: list installed/running, launch, quit
- System: volume control, screenshots, system info
- Processes: list, kill, resource usage
- Clipboard: read/write
- Office: create Word, Excel, PowerPoint, Outlook documents
- Microsoft 365 (Work IQ): meetings, emails, documents, Teams, people

Be methodical. Check every hour. Bold the free slots.`,
            },
        });
        console.log("Session created");

        return { success: true };
    } catch (error: any) {
        console.error("Failed to initialize Copilot:", error);
        return { success: false, error: error.message };
    }
}

// IPC handlers
ipcMain.handle("init-copilot", async () => {
    return await initializeCopilot();
});

// Helper function to fully restart the Copilot client and session
async function restartCopilotClient(): Promise<boolean> {
    console.log("Restarting Copilot client...");
    
    // Clean up existing resources
    if (copilotSession) {
        try {
            await copilotSession.destroy();
        } catch (e) {
            console.log("Session destroy error (expected):", e);
        }
        copilotSession = null;
    }
    
    if (copilotClient) {
        try {
            await copilotClient.stop();
        } catch (e) {
            console.log("Client stop error (expected):", e);
        }
        copilotClient = null;
    }
    
    // Wait a bit before reconnecting
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Reinitialize
    const result = await initializeCopilot();
    return result.success;
}

// Helper function to create or recreate a session
async function ensureSession(): Promise<boolean> {
    if (!copilotClient) {
        console.log("No copilot client, initializing...");
        const result = await initializeCopilot();
        return result.success;
    }
    
    // Create a new session
    try {
        console.log("Creating new session with", allTools.length, "tools");
        copilotSession = await copilotClient.createSession({
            model: "gpt-4.1",
            streaming: true,
            tools: allTools,
            onPermissionRequest: async (request, invocation) => {
                console.log("Permission request:", request.kind, request);
                return { kind: "approved" };
            },
            systemMessage: {
                content: `You are a helpful Desktop Assistant.

CRITICAL RULES:
1. ALWAYS respond in the SAME LANGUAGE the user uses. Match their language exactly.
2. NEVER invent or assume data. Only report what the tools return.
3. Take your time - accuracy over speed.

CALENDAR AVAILABILITY ANALYSIS - MANDATORY PROCESS:
When asked to find free slots for a time range (e.g., "free slots between 9:00 and 15:00 next week"):

STEP 1: Query each day separately using get_my_meetings

STEP 2: For EACH DAY, create an HOUR-BY-HOUR grid showing what's in each slot:

**MONDAY [date] (9:00-15:00):**
• 09:00-10:00: [meeting name] or **FREE SLOT**
• 10:00-11:00: [meeting name] or **FREE SLOT**
• 11:00-12:00: [meeting name] or **FREE SLOT**
• 12:00-13:00: [meeting name] or **FREE SLOT**
• 13:00-14:00: [meeting name] or **FREE SLOT**
• 14:00-15:00: [meeting name] or **FREE SLOT**

**TUESDAY [date] (9:00-15:00):**
• 09:00-10:00: ...
[continue for each hour]

[Repeat for each day of the week]

STEP 3: After showing ALL days hour-by-hour, provide:

**SUMMARY OF AVAILABLE SLOTS:**
- Monday: [list free hours or "No free slots"]
- Tuesday: [list free hours or "No free slots"]
- ...

**BEST OPTIONS FOR A [X]-HOUR MEETING:**
[List the best consecutive free slots]

RULES FOR HOUR GRID:
- If a meeting covers part of an hour (e.g., 9:30-10:30), mark BOTH hours as occupied
- If a meeting is marked as "tentative", still show it but note "(tentative)"
- Mark **FREE SLOT** in bold for empty hours
- Show the actual meeting name for occupied hours

Available tools:
- Windows: list, focus, close, minimize, maximize
- Files: list, search, move, copy, delete, rename
- Apps: list installed/running, launch, quit
- System: volume control, screenshots, system info
- Processes: list, kill, resource usage
- Clipboard: read/write
- Office: create Word, Excel, PowerPoint, Outlook documents
- Microsoft 365 (Work IQ): meetings, emails, documents, Teams, people

Be methodical. Check every hour. Bold the free slots.`,
            },
        });
        console.log("New session created");
        return true;
    } catch (error: any) {
        console.error("Failed to create session:", error);
        return false;
    }
}

ipcMain.handle("send-message", async (_event, message: string) => {
    if (!copilotSession && !copilotClient) {
        return { error: "Copilot not initialized" };
    }
    
    // Helper to send message with retry on session expiry
    const sendWithRetry = async (retryCount = 0): Promise<{ success?: boolean; error?: string }> => {
        // Try to ensure we have a valid session
        if (!copilotSession) {
            if (retryCount >= 2) {
                return { error: "Failed to create session after multiple attempts" };
            }
            
            console.log(`No active session (attempt ${retryCount + 1}), creating new one...`);
            
            // On first retry, try creating a new session with existing client
            // On second retry, restart the entire client
            let created: boolean;
            if (retryCount === 0) {
                created = await ensureSession();
            } else {
                console.log("Restarting entire Copilot client...");
                created = await restartCopilotClient();
            }
            
            if (!created) {
                // If session creation failed, try restarting client on next attempt
                if (retryCount === 0) {
                    console.log("Session creation failed, will try client restart...");
                    return sendWithRetry(retryCount + 1);
                }
                return { error: "Failed to create session" };
            }
        }
        
        try {
            // Create a promise that resolves when we get the response
            const responsePromise = new Promise<string>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    unsubscribe();
                    reject(new Error("Timeout waiting for response"));
                }, 180000); // 3 minutes timeout
                
                let fullContent = "";
                let gotMessage = false;
                
                const unsubscribe = copilotSession.on((event: SessionEvent) => {
                    console.log("Response handler event:", event.type);
                    
                    // Stream deltas as they come
                    if (event.type === "assistant.message_delta") {
                        const delta = (event.data as any).deltaContent;
                        if (delta && mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send("copilot-delta", { delta });
                        }
                    }
                    
                    // Final message
                    if (event.type === "assistant.message") {
                        const content = (event.data as any).content;
                        console.log("Got assistant.message:", content?.substring(0, 100));
                        fullContent = content || fullContent;
                        gotMessage = true;
                    }
                    
                    // Tool execution events
                    if (event.type === "tool.execution_start") {
                        const toolName = (event.data as any).toolName;
                        console.log("Tool execution started:", toolName);
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send("copilot-tool", { name: toolName, status: "started" });
                        }
                    }
                    
                    if (event.type === "tool.execution_complete") {
                        const toolCallId = (event.data as any).toolCallId;
                        console.log("Tool execution complete:", toolCallId);
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send("copilot-tool", { status: "complete" });
                        }
                    }
                    
                    // Session idle means we're done
                    if (event.type === "session.idle") {
                        clearTimeout(timeout);
                        unsubscribe();
                        if (gotMessage) {
                            resolve(fullContent);
                        } else {
                            resolve("No response received");
                        }
                    }
                    
                    // Error events
                    if (event.type === "session.error") {
                        clearTimeout(timeout);
                        unsubscribe();
                        reject(new Error((event.data as any).message || "Session error"));
                    }
                });
            });
            
            // Send the message
            console.log("Sending message:", message);
            await copilotSession.send({ prompt: message });
            console.log("Message sent, waiting for response...");
            
            // Wait for the response
            const content = await responsePromise;
            console.log("Response complete, content length:", content.length);
            
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("copilot-response", { content });
            }
            
            return { success: true };
        } catch (error: any) {
            console.error("Error sending message:", error);
            
            // Check if session expired and retry
            if ((error.message?.includes("Session not found") || 
                 error.message?.includes("session") ||
                 error.code === -32603) && retryCount < 2) {
                console.log(`Session error detected (attempt ${retryCount + 1}), will retry...`);
                copilotSession = null; // Clear the expired session
                return sendWithRetry(retryCount + 1);
            }
            
            return { error: error.message };
        }
    };
    
    return await sendWithRetry();
});

ipcMain.handle("abort-message", async () => {
    if (copilotSession) {
        try {
            await copilotSession.abort();
            return { success: true };
        } catch (error: any) {
            return { error: error.message };
        }
    }
    return { error: "No active session" };
});

// Settings handlers
ipcMain.handle("get-settings", () => {
    return loadSettings();
});

ipcMain.handle("save-settings", (_event, settings) => {
    saveSettings(settings);
    return { success: true };
});

// NEW: Get available models (v0.1.15+)
ipcMain.handle("get-models", async () => {
    return { models: availableModels, status: copilotStatus };
});

// NEW: Change model on the fly
ipcMain.handle("change-model", async (_event, model: string) => {
    const settings = loadSettings();
    settings.selectedModel = model;
    saveSettings(settings);
    // Recreate session with new model
    copilotSession = null;
    return { success: true, message: "Model changed. New session will use: " + model };
});

// NEW: Change reasoning effort
ipcMain.handle("change-reasoning", async (_event, effort: "low" | "medium" | "high") => {
    const settings = loadSettings();
    settings.reasoningEffort = effort;
    saveSettings(settings);
    copilotSession = null; // Will recreate with new setting
    return { success: true };
});

// NEW: Send message with image attachment
ipcMain.handle("send-message-with-image", async (_event, data: { message: string, imageBase64: string }) => {
    if (!copilotSession && !copilotClient) {
        return { error: "Copilot not initialized" };
    }
    
    // Ensure session exists
    if (!copilotSession) {
        const created = await ensureSession();
        if (!created) return { error: "Failed to create session" };
    }
    
    // Save image to a temp file (SDK requires file path, not base64)
    const tempImagePath = path.join(os.tmpdir(), `copilot_image_${Date.now()}.png`);
    
    try {
        // Write base64 to file
        const imageBuffer = Buffer.from(data.imageBase64, "base64");
        fs.writeFileSync(tempImagePath, imageBuffer);
        console.log("Saved temp image:", tempImagePath, "size:", imageBuffer.length, "bytes");
        
        const responsePromise = new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => {
                unsubscribe();
                reject(new Error("Timeout waiting for response"));
            }, 180000);
            
            let fullContent = "";
            let gotMessage = false;
            
            const unsubscribe = copilotSession.on((event: SessionEvent) => {
                if (event.type === "assistant.message_delta") {
                    const delta = (event.data as any).deltaContent;
                    if (delta && mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send("copilot-delta", { delta });
                    }
                }
                
                if (event.type === "assistant.message") {
                    fullContent = (event.data as any).content || fullContent;
                    gotMessage = true;
                }
                
                if (event.type === "tool.execution_start") {
                    const toolName = (event.data as any).toolName;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send("copilot-tool", { name: toolName, status: "started" });
                    }
                }
                
                if (event.type === "tool.execution_complete") {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send("copilot-tool", { status: "complete" });
                    }
                }
                
                if (event.type === "session.idle") {
                    clearTimeout(timeout);
                    unsubscribe();
                    resolve(fullContent);
                }
                
                if (event.type === "session.error") {
                    clearTimeout(timeout);
                    unsubscribe();
                    reject(new Error((event.data as any).message || "Session error"));
                }
            });
        });
        
        // Send with image as file attachment (SDK requires file path)
        console.log("Sending message with image file attachment:", tempImagePath);
        await copilotSession.send({ 
            prompt: data.message,
            attachments: [{
                type: "file",
                path: tempImagePath,
                displayName: "screenshot.png"
            }]
        });
        
        const content = await responsePromise;
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("copilot-response", { content });
        }
        
        // Clean up temp image
        try { fs.unlinkSync(tempImagePath); } catch (e) {}
        
        return { success: true };
    } catch (error: any) {
        console.error("Error sending message with image:", error);
        // Clean up temp image on error
        try { fs.unlinkSync(tempImagePath); } catch (e) {}
        return { error: error.message };
    }
});

// NEW: Take screenshot and return as base64
ipcMain.handle("capture-screenshot", async () => {
    try {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)

$ms = New-Object System.IO.MemoryStream
$bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $ms.ToArray()
[Convert]::ToBase64String($bytes)

$graphics.Dispose()
$bitmap.Dispose()
$ms.Dispose()
`;
        const base64 = await runPowerShell(script);
        return { success: true, imageBase64: base64.trim() };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

// NEW: Chat history handlers
ipcMain.handle("get-history", () => {
    return loadHistory();
});

ipcMain.handle("save-chat-session", (_event, session: ChatSession) => {
    const history = loadHistory();
    const existingIndex = history.findIndex(s => s.id === session.id);
    if (existingIndex >= 0) {
        history[existingIndex] = session;
    } else {
        history.push(session);
    }
    saveHistory(history);
    return { success: true };
});

ipcMain.handle("delete-chat-session", (_event, sessionId: string) => {
    const history = loadHistory();
    const filtered = history.filter(s => s.id !== sessionId);
    saveHistory(filtered);
    return { success: true };
});

ipcMain.handle("clear-history", () => {
    saveHistory([]);
    return { success: true };
});

// NEW: Theme handler
ipcMain.handle("set-theme", (_event, theme: "dark" | "light" | "system") => {
    const settings = loadSettings();
    settings.theme = theme;
    saveSettings(settings);
    nativeTheme.themeSource = theme;
    return { success: true };
});

ipcMain.handle("get-theme", () => {
    const settings = loadSettings();
    return settings.theme || "system";
});

// NEW: Process dropped image
ipcMain.handle("process-dropped-image", async (_event, dataUrl: string) => {
    try {
        // Extract base64 from data URL
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
        return { success: true, imageBase64: base64 };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

// Voice recognition using Azure AI Whisper with Entra ID
ipcMain.handle("start-voice-recognition", async () => {
    const settings = loadSettings();
    
    if (!settings.whisperEndpoint) {
        return { success: false, error: "Whisper not configured. Please go to Settings." };
    }
    
    try {
        console.log("Starting audio recording for Whisper...");
        
        // Get Azure access token using Entra ID
        console.log("Getting Azure access token via Entra ID...");
        let accessToken: string;
        try {
            accessToken = await getAzureAccessToken();
            console.log("Access token obtained successfully");
        } catch (tokenError: any) {
            console.error("Failed to get Azure token:", tokenError);
            return { 
                success: false, 
                error: `Entra ID authentication failed. Make sure you're logged in with 'az login'. Error: ${tokenError.message}` 
            };
        }
        
        // Create temp file for audio
        tempAudioFile = path.join(os.tmpdir(), `voice_${Date.now()}.wav`);
        
        // Record audio using ffmpeg (more reliable than mciSendString)
        console.log("Recording audio with ffmpeg...");
        const recordDuration = 6; // seconds
        
        try {
            // Use ffmpeg to record from the default audio input device
            // -f dshow: DirectShow input (Windows)
            // -i audio="Microphone": Use default microphone
            // -t 6: Record for 6 seconds
            // -ar 16000: Sample rate 16kHz (good for speech)
            // -ac 1: Mono audio
            // -y: Overwrite output file
            
            const ffmpegCommand = `ffmpeg -f dshow -i audio="@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{00000000-0000-0000-0000-000000000000}" -t ${recordDuration} -ar 16000 -ac 1 -y "${tempAudioFile}" 2>&1`;
            
            // First, list audio devices to find the right one
            const listDevicesResult = await execAsync('ffmpeg -list_devices true -f dshow -i dummy 2>&1', { maxBuffer: 10 * 1024 * 1024 }).catch(e => e);
            console.log("Available audio devices:", listDevicesResult.stdout || listDevicesResult.stderr || listDevicesResult.message);
            
            // Extract microphone device name from the list
            const deviceOutput = listDevicesResult.stdout || listDevicesResult.stderr || listDevicesResult.message || "";
            const micMatch = deviceOutput.match(/"([^"]*(?:Microphone|Headset|EPOS|USB Audio)[^"]*)"/i);
            const micDevice = micMatch ? micMatch[1] : "Microphone Array (Intel® Smart Sound Technology for Digital Microphones)";
            
            console.log("Using microphone:", micDevice);
            
            // Record audio
            const recordCommand = `ffmpeg -f dshow -i audio="${micDevice}" -t ${recordDuration} -ar 16000 -ac 1 -acodec pcm_s16le -y "${tempAudioFile}"`;
            console.log("Recording command:", recordCommand);
            
            await execAsync(recordCommand, { maxBuffer: 10 * 1024 * 1024, timeout: (recordDuration + 5) * 1000 });
            console.log("Recording complete");
            
        } catch (recordError: any) {
            console.error("ffmpeg recording error:", recordError.message);
            // If ffmpeg fails, try PowerShell .NET approach as fallback
            console.log("Trying PowerShell NAudio fallback...");
            
            const recordScript = `
# Record using .NET SoundPlayer workaround with MediaCapture
Add-Type -AssemblyName System.Speech

$outputFile = "${tempAudioFile.replace(/\\/g, '\\\\')}"

# Use Windows built-in Sound Recorder approach via mciSendString
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public class WaveRecorder {
    [DllImport("winmm.dll")]
    private static extern int mciSendString(string command, System.Text.StringBuilder buffer, int bufferSize, IntPtr hwndCallback);
    
    public static bool Record(string filename, int durationMs) {
        var sb = new System.Text.StringBuilder(128);
        
        mciSendString("close all", sb, 128, IntPtr.Zero);
        
        int result = mciSendString("open new type waveaudio alias capture", sb, 128, IntPtr.Zero);
        if (result != 0) return false;
        
        result = mciSendString("set capture bitspersample 16 samplespersec 16000 channels 1 bytespersec 32000 alignment 2", sb, 128, IntPtr.Zero);
        
        result = mciSendString("record capture", sb, 128, IntPtr.Zero);
        if (result != 0) {
            mciSendString("close capture", sb, 128, IntPtr.Zero);
            return false;
        }
        
        Thread.Sleep(durationMs);
        
        mciSendString("stop capture", sb, 128, IntPtr.Zero);
        mciSendString("save capture \\"" + filename + "\\"", sb, 128, IntPtr.Zero);
        mciSendString("close capture", sb, 128, IntPtr.Zero);
        
        return System.IO.File.Exists(filename) && new System.IO.FileInfo(filename).Length > 1000;
    }
}
'@

$success = [WaveRecorder]::Record($outputFile, 5000)
if ($success) {
    Write-Output "SUCCESS"
} else {
    Write-Output "ERROR:Recording failed"
}
`;
            const psResult = await runPowerShell(recordScript);
            if (!psResult.includes("SUCCESS")) {
                return { success: false, error: "Failed to record audio. Check microphone permissions." };
            }
        }
        
        // Check if file exists and has content
        if (!fs.existsSync(tempAudioFile)) {
            return { success: false, error: "Recording file not created" };
        }
        
        const fileSize = fs.statSync(tempAudioFile).size;
        console.log("Audio file size:", fileSize, "bytes");
        
        if (fileSize < 1000) {
            return { success: false, error: "Recording too short or empty. Check microphone." };
        }
        
        // Normalize the endpoint URL - ensure it uses transcriptions
        let whisperUrl = settings.whisperEndpoint;
        // Replace translations with transcriptions if needed
        whisperUrl = whisperUrl.replace('/audio/translations', '/audio/transcriptions');
        // Ensure it ends with transcriptions endpoint
        if (!whisperUrl.includes('/audio/transcriptions')) {
            // Build the URL properly
            const baseUrl = whisperUrl.replace(/\/+$/, '');
            if (!baseUrl.includes('/audio/')) {
                whisperUrl = baseUrl + '/audio/transcriptions';
            }
        }
        
        console.log("Using Whisper URL:", whisperUrl);
        
        // Send to Whisper API with Entra ID token
        console.log("Sending audio to Whisper with Entra ID auth...");
        const audioBuffer = fs.readFileSync(tempAudioFile);
        
        // Create form data manually
        const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
        
        const formDataParts: Buffer[] = [];
        
        // Add file field
        formDataParts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
            `Content-Type: audio/wav\r\n\r\n`
        ));
        formDataParts.push(audioBuffer);
        formDataParts.push(Buffer.from("\r\n"));
        
        // Add response_format field
        formDataParts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
            `text\r\n`
        ));
        
        // End boundary
        formDataParts.push(Buffer.from(`--${boundary}--\r\n`));
        
        const formData = Buffer.concat(formDataParts);
        
        // Make the request
        const https = require("https");
        const http = require("http");
        const url = new URL(whisperUrl);
        
        const requestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": formData.length,
                "Authorization": `Bearer ${accessToken}`,
            },
        };
        
        console.log("Request URL:", url.hostname + url.pathname + url.search);
        
        const transcription = await new Promise<string>((resolve, reject) => {
            const protocol = url.protocol === "https:" ? https : http;
            const req = protocol.request(requestOptions, (res: any) => {
                let data = "";
                res.on("data", (chunk: Buffer) => {
                    data += chunk.toString();
                });
                res.on("end", () => {
                    console.log("Whisper response status:", res.statusCode);
                    console.log("Whisper response:", data.substring(0, 500));
                    
                    if (res.statusCode === 401 || res.statusCode === 403) {
                        reject(new Error(`Authentication failed (${res.statusCode}). Make sure your user has 'Cognitive Services User' role on the resource.`));
                        return;
                    }
                    
                    if (res.statusCode !== 200) {
                        reject(new Error(`Whisper API error ${res.statusCode}: ${data.substring(0, 200)}`));
                        return;
                    }
                    
                    // Try to parse as JSON first
                    try {
                        const json = JSON.parse(data);
                        resolve(json.text || data);
                    } catch {
                        // If not JSON, it's plain text
                        resolve(data.trim());
                    }
                });
            });
            
            req.on("error", (e: Error) => {
                reject(e);
            });
            
            req.write(formData);
            req.end();
        });
        
        // Clean up temp file
        try {
            fs.unlinkSync(tempAudioFile);
        } catch (e) {}
        
        console.log("Transcription:", transcription);
        
        if (!transcription || transcription.trim() === "") {
            return { success: false, error: "No speech detected in recording" };
        }
        
        return { success: true, text: transcription.trim() };
        
    } catch (error: any) {
        console.error("Voice recognition error:", error);
        // Clean up temp file on error
        if (tempAudioFile && fs.existsSync(tempAudioFile)) {
            try { fs.unlinkSync(tempAudioFile); } catch (e) {}
        }
        return { success: false, error: error.message };
    }
});

ipcMain.handle("stop-voice-recognition", async () => {
    // Stop recording if in progress
    if (recordingProcess) {
        recordingProcess.kill();
        recordingProcess = null;
    }
    return { success: true };
});

// App lifecycle
app.whenReady().then(() => {
    createWindow();
    createTray();
    
    // Register global shortcut
    const settings = loadSettings();
    registerGlobalShortcut(settings.globalShortcut || "CommandOrControl+Shift+Space");
    
    // Apply saved theme
    if (settings.theme) {
        nativeTheme.themeSource = settings.theme;
    }
});

app.on("window-all-closed", async () => {
    globalShortcut.unregisterAll();
    
    if (copilotSession) {
        try {
            await copilotSession.destroy();
        } catch (e) {}
    }
    if (copilotClient) {
        try {
            await copilotClient.stop();
        } catch (e) {}
    }
    
    if (tray) {
        tray.destroy();
    }
    
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (mainWindow === null) {
        createWindow();
    }
});
