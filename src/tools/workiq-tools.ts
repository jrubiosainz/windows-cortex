import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";

/**
 * Get the path to the globally installed workiq executable
 * Supports Windows, macOS, and Linux
 */
function getWorkiqPath(): string {
    if (process.platform === "win32") {
        // Windows: npm global bin is in AppData/Roaming/npm
        return path.join(os.homedir(), "AppData", "Roaming", "npm", "workiq.cmd");
    } else {
        // macOS/Linux: typically in /usr/local/bin or ~/.npm-global/bin
        // Use 'workiq' directly and rely on PATH, or check common locations
        const homeNpmBin = path.join(os.homedir(), ".npm-global", "bin", "workiq");
        const localBin = "/usr/local/bin/workiq";
        
        // Default to relying on PATH
        return "workiq";
    }
}

const workiqPath = getWorkiqPath();

/**
 * Execute a workiq query using the MCP server protocol
 */
async function queryWorkIQ(question: string): Promise<string> {
    return new Promise((resolve, reject) => {
        console.log(`[WorkIQ] Starting query: "${question}"`);
        console.log(`[WorkIQ] Using executable: ${workiqPath}`);
        
        // Start workiq MCP server using the full path
        const proc = spawn(workiqPath, ["mcp"], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            shell: true,
        });
        
        let stdout = "";
        let stderr = "";
        let requestSent = false;
        
        // Increased timeout to 5 minutes to allow complete calendar/email queries
        const timeout = setTimeout(() => {
            proc.kill();
            console.log(`[WorkIQ] Timeout - stdout: ${stdout}`);
            console.log(`[WorkIQ] Timeout - stderr: ${stderr}`);
            reject(new Error("WorkIQ query timed out after 5 minutes"));
        }, 300000);
        
        proc.stdout.on("data", (data) => {
            const chunk = data.toString();
            stdout += chunk;
            console.log(`[WorkIQ] stdout: ${chunk.substring(0, 300)}`);
            
            // Parse JSON-RPC responses
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line.trim());
                    
                    // Handle initialization response
                    if (json.result && json.result.serverInfo && !requestSent) {
                        console.log(`[WorkIQ] Server initialized, sending request...`);
                        requestSent = true;
                        
                        // Send tools/list first to discover tools
                        const listRequest = {
                            jsonrpc: "2.0",
                            id: 2,
                            method: "tools/list",
                            params: {}
                        };
                        proc.stdin.write(JSON.stringify(listRequest) + '\n');
                    }
                    
                    // Handle tools/list response
                    if (json.result && json.result.tools && json.id === 2) {
                        console.log(`[WorkIQ] Found ${json.result.tools.length} tools`);
                        
                        // Find the ask tool
                        const askTool = json.result.tools.find((t: any) => 
                            t.name === "workiq_ask" || t.name === "ask" || t.name.includes("ask")
                        );
                        
                        if (askTool) {
                            console.log(`[WorkIQ] Using tool: ${askTool.name}`);
                            
                            // Call the tool
                            const callRequest = {
                                jsonrpc: "2.0",
                                id: 3,
                                method: "tools/call",
                                params: {
                                    name: askTool.name,
                                    arguments: { question }
                                }
                            };
                            proc.stdin.write(JSON.stringify(callRequest) + '\n');
                        } else {
                            clearTimeout(timeout);
                            proc.kill();
                            resolve("WorkIQ tools not found. Available: " + json.result.tools.map((t: any) => t.name).join(", "));
                        }
                    }
                    
                    // Handle tools/call response (final result)
                    if (json.result && json.id === 3) {
                        clearTimeout(timeout);
                        proc.kill();
                        
                        // Extract text content from the response
                        const content = json.result.content || json.result;
                        if (Array.isArray(content)) {
                            const textContent = content
                                .filter((c: any) => c.type === "text")
                                .map((c: any) => c.text)
                                .join("\n");
                            resolve(textContent || JSON.stringify(content));
                        } else if (typeof content === "string") {
                            resolve(content);
                        } else {
                            resolve(JSON.stringify(content, null, 2));
                        }
                    }
                    
                    // Handle errors
                    if (json.error) {
                        clearTimeout(timeout);
                        proc.kill();
                        reject(new Error(json.error.message || JSON.stringify(json.error)));
                    }
                } catch (e) {
                    // Not valid JSON, continue accumulating
                }
            }
        });
        
        proc.stderr.on("data", (data) => {
            stderr += data.toString();
            console.log(`[WorkIQ] stderr: ${data.toString()}`);
        });
        
        proc.on("close", (code) => {
            clearTimeout(timeout);
            console.log(`[WorkIQ] Process exited with code ${code}`);
            if (stdout.trim()) {
                resolve(stdout.trim());
            } else {
                reject(new Error(`WorkIQ exited with code ${code}: ${stderr}`));
            }
        });
        
        proc.on("error", (err) => {
            clearTimeout(timeout);
            console.log(`[WorkIQ] Process error: ${err.message}`);
            reject(new Error(`Failed to start WorkIQ: ${err.message}`));
        });
        
        // Send MCP initialize request
        const initRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                    name: "windows-cortex",
                    version: "1.0.0"
                }
            }
        };
        
        console.log(`[WorkIQ] Sending initialize...`);
        proc.stdin.write(JSON.stringify(initRequest) + '\n');
    });
}

export const getMyMeetings = defineTool("get_my_meetings", {
    description: "Get your upcoming meetings and calendar events from Microsoft 365. Can query for today, tomorrow, this week, or a specific date range.",
    parameters: z.object({
        timeframe: z.string().optional().describe("Time frame for meetings (e.g., 'today', 'tomorrow', 'this week', 'next 3 days'). Default is 'today'."),
    }),
    handler: async ({ timeframe = "today" }) => {
        const question = `What are my meetings ${timeframe}?`;
        try {
            const result = await queryWorkIQ(question);
            return { success: true, meetings: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const getMeetingDetails = defineTool("get_meeting_details", {
    description: "Get details about a specific meeting including attendees, agenda, and related information.",
    parameters: z.object({
        meetingQuery: z.string().describe("Description of the meeting to find (e.g., 'team standup', 'meeting with John', '1:1 with manager')"),
    }),
    handler: async ({ meetingQuery }) => {
        const question = `Tell me about my meeting related to "${meetingQuery}" - who is attending, what's the agenda, and any relevant details.`;
        try {
            const result = await queryWorkIQ(question);
            return { success: true, details: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const getMyEmails = defineTool("get_my_emails", {
    description: "Search and retrieve emails from Microsoft 365. Can search by sender, subject, or content.",
    parameters: z.object({
        query: z.string().describe("What to search for in emails (e.g., 'from John', 'about the budget', 'unread emails')"),
    }),
    handler: async ({ query }) => {
        const question = `Show me my emails ${query}`;
        try {
            const result = await queryWorkIQ(question);
            return { success: true, emails: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const getEmailSummary = defineTool("get_email_summary", {
    description: "Get a summary of email conversations or threads on a specific topic.",
    parameters: z.object({
        topic: z.string().describe("The topic or subject to summarize (e.g., 'project updates', 'Q4 planning')"),
        sender: z.string().optional().describe("Optional: filter by sender name"),
    }),
    handler: async ({ topic, sender }) => {
        const senderFilter = sender ? ` from ${sender}` : "";
        const question = `Summarize the emails about "${topic}"${senderFilter}`;
        try {
            const result = await queryWorkIQ(question);
            return { success: true, summary: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const getMyDocuments = defineTool("get_my_documents", {
    description: "Find and retrieve documents from OneDrive and SharePoint. Can search by name, type, or recent activity.",
    parameters: z.object({
        query: z.string().describe("What documents to find (e.g., 'recent PowerPoint presentations', 'documents about Q4', 'files I edited yesterday')"),
    }),
    handler: async ({ query }) => {
        const question = `Find my documents: ${query}`;
        try {
            const result = await queryWorkIQ(question);
            return { success: true, documents: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const getTeamsMessages = defineTool("get_teams_messages", {
    description: "Get messages from Microsoft Teams channels or chats.",
    parameters: z.object({
        query: z.string().describe("What to search for (e.g., 'messages in Engineering channel', 'chat with Sarah', 'mentions of me today')"),
    }),
    handler: async ({ query }) => {
        const question = `Show me Teams messages: ${query}`;
        try {
            const result = await queryWorkIQ(question);
            return { success: true, messages: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const summarizeTeamsChannel = defineTool("summarize_teams_channel", {
    description: "Get a summary of recent activity in a Microsoft Teams channel.",
    parameters: z.object({
        channel: z.string().describe("The name of the Teams channel to summarize"),
        timeframe: z.string().optional().describe("Time period to summarize (e.g., 'today', 'this week'). Default is 'today'."),
    }),
    handler: async ({ channel, timeframe = "today" }) => {
        const question = `Summarize ${timeframe}'s messages in the ${channel} channel`;
        try {
            const result = await queryWorkIQ(question);
            return { success: true, summary: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const findPeople = defineTool("find_people", {
    description: "Find information about people in your organization, including who is working on specific projects.",
    parameters: z.object({
        query: z.string().describe("What you want to know about people (e.g., 'who is working on Project Alpha', 'find John Smith', 'my manager')"),
    }),
    handler: async ({ query }) => {
        const question = query;
        try {
            const result = await queryWorkIQ(question);
            return { success: true, people: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const askWorkIQ = defineTool("ask_workiq", {
    description: "Ask any natural language question about your Microsoft 365 data - emails, meetings, documents, Teams messages, and people.",
    parameters: z.object({
        question: z.string().describe("Your question in natural language (e.g., 'What did my manager say about the project deadline?', 'Find my recent documents about Q4 planning')"),
    }),
    handler: async ({ question }) => {
        try {
            const result = await queryWorkIQ(question);
            return { success: true, answer: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const getWorkSummary = defineTool("get_work_summary", {
    description: "Get a summary of your work activity for a specific time period including meetings, emails, and tasks.",
    parameters: z.object({
        timeframe: z.string().optional().describe("Time period for summary (e.g., 'today', 'yesterday', 'this week'). Default is 'today'."),
    }),
    handler: async ({ timeframe = "today" }) => {
        const question = `Give me a summary of my work activity ${timeframe} - meetings I had, important emails, and things I worked on.`;
        try {
            const result = await queryWorkIQ(question);
            return { success: true, summary: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },
});

export const workiqTools = [
    getMyMeetings,
    getMeetingDetails,
    getMyEmails,
    getEmailSummary,
    getMyDocuments,
    getTeamsMessages,
    summarizeTeamsChannel,
    findPeople,
    askWorkIQ,
    getWorkSummary,
];
