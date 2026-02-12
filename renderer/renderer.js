const { ipcRenderer } = require("electron");

// DOM Elements
const chatContainer = document.getElementById("chat-container");
const messagesContainer = document.getElementById("messages");
const welcomeMessage = document.getElementById("welcome");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const abortBtn = document.getElementById("abort-btn");
const statusEl = document.getElementById("status");
const newChatBtn = document.getElementById("new-chat-btn");
const voiceBtn = document.getElementById("voice-btn");
const voiceStatus = document.getElementById("voice-status");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const testWhisperBtn = document.getElementById("test-whisper-btn");
const whisperEndpointInput = document.getElementById("whisper-endpoint");
const modelSelect = document.getElementById("model-select");
const reasoningSelect = document.getElementById("reasoning-select");
const imageBtn = document.getElementById("image-btn");
const imagePreview = document.getElementById("image-preview");
const previewImg = document.getElementById("preview-img");
const removeImageBtn = document.getElementById("remove-image-btn");
const confirmModal = document.getElementById("confirm-modal");
const confirmMessage = document.getElementById("confirm-message");
const confirmYesBtn = document.getElementById("confirm-yes-btn");
const confirmNoBtn = document.getElementById("confirm-no-btn");

// State
let isProcessing = false;
let currentAssistantMessage = null;
let currentContent = "";
let isListening = false;
let pendingImageBase64 = null;
let pendingConfirmResolve = null;
let currentSessionId = null;
let chatHistory = [];

// Slash commands definition
const slashCommands = {
    "/meetings": "Show my meetings for today from my calendar",
    "/emails": "Show my unread emails from Outlook",
    "/system": "Show system information including CPU, memory, and disk usage",
    "/screenshot": "Take a screenshot of my screen",
    "/windows": "List all open windows",
    "/apps": "List running applications",
    "/files": "List files in the current directory",
    "/clipboard": "Show clipboard contents",
    "/help": "Show available slash commands"
};

// Render basic markdown (bold, newlines, lists) to HTML
function renderMarkdown(text) {
    if (!text) return "";
    return text
        // Escape HTML first
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // Bold: **text** or __text__
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        // Italic: *text* or _text_
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/_([^_]+)_/g, "<em>$1</em>")
        // Newlines to <br>
        .replace(/\n/g, "<br>");
}

// Settings management
async function loadSettings() {
    const settings = await ipcRenderer.invoke("get-settings");
    if (settings) {
        whisperEndpointInput.value = settings.whisperEndpoint || "";
    }
}

async function saveSettings() {
    const settings = {
        whisperEndpoint: whisperEndpointInput.value.trim(),
        reasoningEffort: reasoningSelect.value,
        selectedModel: modelSelect.value,
        theme: document.body.dataset.theme || "system"
    };
    await ipcRenderer.invoke("save-settings", settings);
    settingsModal.style.display = "none";
    
    // Show confirmation
    voiceStatus.style.display = "flex";
    voiceStatus.className = "voice-status";
    voiceStatus.querySelector(".voice-text").textContent = "✓ Settings saved!";
    setTimeout(() => {
        voiceStatus.style.display = "none";
    }, 2000);
}

// Theme management
async function setTheme(theme) {
    document.body.dataset.theme = theme;
    await ipcRenderer.invoke("set-theme", theme);
    // Update theme toggle button if exists
    const themeBtn = document.getElementById("theme-btn");
    if (themeBtn) {
        themeBtn.textContent = theme === "dark" ? "☀️" : theme === "light" ? "🌙" : "💻";
    }
}

async function loadTheme() {
    const theme = await ipcRenderer.invoke("get-theme");
    document.body.dataset.theme = theme;
}

function showSettings() {
    loadSettings();
    settingsModal.style.display = "flex";
}

function hideSettings() {
    settingsModal.style.display = "none";
}

function isWhisperConfigured() {
    return whisperEndpointInput.value.trim();
}

// Toggle voice recognition using Whisper
async function toggleVoiceRecognition() {
    if (isListening) {
        console.log("Stopping speech recognition");
        isListening = false;
        voiceBtn.classList.remove("listening");
        voiceStatus.style.display = "none";
        await ipcRenderer.invoke("stop-voice-recognition");
        return;
    }
    
    // Check if Whisper is configured
    const settings = await ipcRenderer.invoke("get-settings");
    if (!settings || !settings.whisperEndpoint) {
        showWhisperSetupInstructions();
        return;
    }
    
    console.log("Starting speech recognition with Whisper");
    messageInput.value = "";
    isListening = true;
    voiceBtn.classList.add("listening");
    voiceStatus.style.display = "flex";
    voiceStatus.className = "voice-status";
    voiceStatus.querySelector(".voice-text").textContent = "🎤 Recording... (speak now)";
    
    try {
        const result = await ipcRenderer.invoke("start-voice-recognition");
        console.log("Voice recognition result:", result);
        
        isListening = false;
        voiceBtn.classList.remove("listening");
        
        if (result.success && result.text) {
            voiceStatus.style.display = "none";
            messageInput.value = result.text;
            adjustTextareaHeight();
            // Auto-send
            if (!isProcessing) {
                sendMessage();
            }
        } else if (result.error) {
            voiceStatus.className = "voice-status error";
            voiceStatus.querySelector(".voice-text").textContent = result.error;
            setTimeout(() => {
                voiceStatus.style.display = "none";
            }, 4000);
        }
    } catch (e) {
        console.error("Voice recognition error:", e);
        isListening = false;
        voiceBtn.classList.remove("listening");
        voiceStatus.className = "voice-status error";
        voiceStatus.querySelector(".voice-text").textContent = "Error: " + e.message;
        setTimeout(() => {
            voiceStatus.style.display = "none";
        }, 4000);
    }
}

function showWhisperSetupInstructions() {
    // Show the settings modal with instructions highlighted
    showSettings();
    
    // Highlight the instructions section
    const instructions = document.getElementById("setup-instructions");
    if (instructions) {
        instructions.style.border = "2px solid var(--accent)";
        instructions.style.animation = "pulse 1s infinite";
        setTimeout(() => {
            instructions.style.border = "";
            instructions.style.animation = "";
        }, 5000);
    }
    
    // Show a message in the status
    voiceStatus.style.display = "flex";
    voiceStatus.className = "voice-status error";
    voiceStatus.querySelector(".voice-text").textContent = "⚠️ Please configure Whisper first";
}

async function testMicrophone() {
    if (!isWhisperConfigured()) {
        alert("Please fill in the Whisper endpoint first.");
        return;
    }
    
    testWhisperBtn.disabled = true;
    testWhisperBtn.textContent = "🎤 Recording...";
    
    try {
        const result = await ipcRenderer.invoke("start-voice-recognition");
        
        if (result.success && result.text) {
            alert(`✅ Whisper working!\n\nTranscription: "${result.text}"`);
        } else {
            alert(`❌ Error: ${result.error || "No speech detected"}`);
        }
    } catch (e) {
        alert(`❌ Error: ${e.message}`);
    } finally {
        testWhisperBtn.disabled = false;
        testWhisperBtn.textContent = "🎤 Test Microphone";
    }
}

// Initialize Copilot connection
async function initializeCopilot() {
    updateStatus("connecting", "Connecting to Copilot...");
    
    const result = await ipcRenderer.invoke("init-copilot");
    
    if (result.success) {
        updateStatus("connected", "Connected");
        messageInput.disabled = false;
        sendBtn.disabled = false;
        voiceBtn.disabled = false;
        imageBtn.disabled = false;
        messageInput.focus();
        
        // Load available models
        const modelsResult = await ipcRenderer.invoke("get-models");
        if (modelsResult.models && modelsResult.models.length > 0) {
            modelSelect.innerHTML = "";
            modelsResult.models.forEach(model => {
                const option = document.createElement("option");
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });
        }
        
        // Load saved settings
        const settings = await ipcRenderer.invoke("get-settings");
        if (settings.selectedModel) {
            modelSelect.value = settings.selectedModel;
        }
        if (settings.reasoningEffort) {
            reasoningSelect.value = settings.reasoningEffort;
        }        // Update reasoning visibility based on current model
        updateReasoningVisibility(modelSelect.value);    } else {
        updateStatus("error", `Error: ${result.error}`);
    }
}

// Update status indicator
function updateStatus(state, text) {
    statusEl.className = `status ${state}`;
    statusEl.querySelector(".status-text").textContent = text;
}

// Send message
async function sendMessage() {
    let message = messageInput.value.trim();
    if (!message || isProcessing) return;
    
    // Handle slash commands
    if (message.startsWith("/")) {
        const cmd = message.split(" ")[0].toLowerCase();
        if (cmd === "/help") {
            showSlashCommandsHelp();
            messageInput.value = "";
            return;
        }
        if (slashCommands[cmd]) {
            message = slashCommands[cmd];
        }
    }
    
    // Hide welcome message on first message
    if (welcomeMessage.style.display !== "none") {
        welcomeMessage.style.display = "none";
        // Start new session
        currentSessionId = Date.now().toString();
    }
    
    // Add user message (with image if present)
    addMessage("user", message, false, pendingImageBase64 ? `data:image/png;base64,${pendingImageBase64}` : null);
    messageInput.value = "";
    adjustTextareaHeight();
    hideSlashSuggestions();
    
    // Save to history
    saveMessageToHistory("user", message, !!pendingImageBase64);
    
    // Start processing
    setProcessing(true);
    
    // Add typing indicator
    addTypingIndicator();
    
    // Send to Copilot (with or without image)
    let result;
    if (pendingImageBase64) {
        result = await ipcRenderer.invoke("send-message-with-image", {
            message: message,
            imageBase64: pendingImageBase64
        });
        // Clear the image after sending
        clearImagePreview();
    } else {
        result = await ipcRenderer.invoke("send-message", message);
    }
    
    if (result.error) {
        removeTypingIndicator();
        addMessage("assistant", `Error: ${result.error}`);
        setProcessing(false);
    }
}

function showSlashCommandsHelp() {
    const helpText = "**Available Slash Commands:**\n\n" +
        Object.entries(slashCommands).map(([cmd, desc]) => `**${cmd}** - ${desc}`).join("\n");
    addMessage("assistant", helpText);
}

// Slash command suggestions
function showSlashSuggestions(filter = "") {
    let suggestionsEl = document.getElementById("slash-suggestions");
    if (!suggestionsEl) {
        suggestionsEl = document.createElement("div");
        suggestionsEl.id = "slash-suggestions";
        suggestionsEl.className = "slash-suggestions";
        document.querySelector(".input-wrapper").appendChild(suggestionsEl);
    }
    
    const filtered = Object.entries(slashCommands)
        .filter(([cmd]) => cmd.startsWith(filter.toLowerCase()));
    
    if (filtered.length === 0) {
        hideSlashSuggestions();
        return;
    }
    
    suggestionsEl.innerHTML = filtered.map(([cmd, desc]) => 
        `<div class="slash-item" data-cmd="${cmd}"><strong>${cmd}</strong> <span>${desc}</span></div>`
    ).join("");
    
    suggestionsEl.style.display = "block";
    
    // Add click handlers
    suggestionsEl.querySelectorAll(".slash-item").forEach(item => {
        item.addEventListener("click", () => {
            messageInput.value = item.dataset.cmd + " ";
            hideSlashSuggestions();
            messageInput.focus();
        });
    });
}

function hideSlashSuggestions() {
    const suggestionsEl = document.getElementById("slash-suggestions");
    if (suggestionsEl) {
        suggestionsEl.style.display = "none";
    }
}

// History management
async function saveMessageToHistory(role, content, hasImage = false) {
    if (!currentSessionId) {
        currentSessionId = Date.now().toString();
    }
    
    const history = await ipcRenderer.invoke("get-history");
    let session = history.find(s => s.id === currentSessionId);
    
    if (!session) {
        session = {
            id: currentSessionId,
            title: content.substring(0, 50) + (content.length > 50 ? "..." : ""),
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }
    
    session.messages.push({ role, content, timestamp: Date.now(), hasImage });
    session.updatedAt = Date.now();
    
    await ipcRenderer.invoke("save-chat-session", session);
}

async function loadChatHistory() {
    chatHistory = await ipcRenderer.invoke("get-history");
    updateHistoryPanel();
}

function updateHistoryPanel() {
    const historyList = document.getElementById("history-list");
    if (!historyList) return;
    
    if (chatHistory.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No chat history</div>';
        return;
    }
    
    historyList.innerHTML = chatHistory
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20)
        .map(session => `
            <div class="history-item" data-id="${session.id}">
                <div class="history-title">${escapeHtml(session.title)}</div>
                <div class="history-date">${formatDate(session.updatedAt)}</div>
                <button class="history-delete" data-id="${session.id}">&times;</button>
            </div>
        `).join("");
    
    // Add event listeners
    historyList.querySelectorAll(".history-item").forEach(item => {
        item.addEventListener("click", (e) => {
            if (!e.target.classList.contains("history-delete")) {
                loadSession(item.dataset.id);
            }
        });
    });
    
    historyList.querySelectorAll(".history-delete").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await ipcRenderer.invoke("delete-chat-session", btn.dataset.id);
            await loadChatHistory();
        });
    });
}

function loadSession(sessionId) {
    const session = chatHistory.find(s => s.id === sessionId);
    if (!session) return;
    
    // Clear current messages
    messagesContainer.innerHTML = "";
    welcomeMessage.style.display = "none";
    currentSessionId = sessionId;
    
    // Load messages
    session.messages.forEach(msg => {
        addMessage(msg.role, msg.content);
    });
    
    // Close history panel
    toggleHistoryPanel(false);
}

function toggleHistoryPanel(show) {
    const panel = document.getElementById("history-panel");
    if (panel) {
        panel.classList.toggle("open", show);
        if (show) loadChatHistory();
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return date.toLocaleDateString();
}

// Add message to chat
function addMessage(role, content, isStreaming = false, imageSrc = null) {
    const messageEl = document.createElement("div");
    messageEl.className = `message ${role}`;
    
    const labelEl = document.createElement("div");
    labelEl.className = "message-label";
    labelEl.textContent = role === "user" ? "You" : "Assistant";
    
    const contentEl = document.createElement("div");
    contentEl.className = "message-content";
    
    // If there's an attached image, show it inside the bubble
    if (imageSrc) {
        const imgEl = document.createElement("img");
        imgEl.src = imageSrc;
        imgEl.className = "chat-inline-image";
        imgEl.alt = "Attached image";
        imgEl.addEventListener("click", () => {
            // Open image in a larger overlay on click
            const overlay = document.createElement("div");
            overlay.className = "image-overlay";
            overlay.innerHTML = `<img src="${imageSrc}" />`;
            overlay.addEventListener("click", () => overlay.remove());
            document.body.appendChild(overlay);
        });
        contentEl.appendChild(imgEl);
    }
    
    if (role === "assistant") {
        const textNode = document.createElement("span");
        textNode.innerHTML = renderMarkdown(content);
        contentEl.appendChild(textNode);
    } else {
        const textNode = document.createElement("span");
        textNode.textContent = content;
        contentEl.appendChild(textNode);
    }
    
    messageEl.appendChild(labelEl);
    messageEl.appendChild(contentEl);
    messagesContainer.appendChild(messageEl);
    
    scrollToBottom();
    
    if (isStreaming) {
        currentAssistantMessage = contentEl;
    }
    
    return messageEl;
}

// Add typing indicator
function addTypingIndicator() {
    const indicator = document.createElement("div");
    indicator.className = "message assistant";
    indicator.id = "typing-indicator";
    
    const labelEl = document.createElement("div");
    labelEl.className = "message-label";
    labelEl.textContent = "Assistant";
    
    const typingEl = document.createElement("div");
    typingEl.className = "typing-indicator";
    typingEl.innerHTML = "<span></span><span></span><span></span>";
    
    indicator.appendChild(labelEl);
    indicator.appendChild(typingEl);
    messagesContainer.appendChild(indicator);
    
    scrollToBottom();
}

// Remove typing indicator
function removeTypingIndicator() {
    const indicator = document.getElementById("typing-indicator");
    if (indicator) {
        indicator.remove();
    }
}

// Add tool indicator
function addToolIndicator(toolName, isCompleted = false) {
    const indicator = document.createElement("div");
    indicator.className = `tool-indicator ${isCompleted ? "completed" : ""}`;
    indicator.dataset.tool = toolName;
    
    if (!isCompleted) {
        indicator.innerHTML = `<div class="spinner"></div>Executing: ${formatToolName(toolName)}`;
    } else {
        indicator.innerHTML = `Completed: ${formatToolName(toolName)}`;
    }
    
    // Find or create tool container for current assistant message
    let toolContainer = messagesContainer.querySelector(".tool-container:last-child");
    if (!toolContainer || toolContainer.previousElementSibling?.classList.contains("user")) {
        toolContainer = document.createElement("div");
        toolContainer.className = "tool-container";
        messagesContainer.appendChild(toolContainer);
    }
    
    toolContainer.appendChild(indicator);
    scrollToBottom();
    
    return indicator;
}

// Update tool indicator to completed
function completeToolIndicator(toolName) {
    const indicators = messagesContainer.querySelectorAll(`.tool-indicator[data-tool="${toolName}"]`);
    indicators.forEach(indicator => {
        indicator.className = "tool-indicator completed";
        indicator.innerHTML = `✓ ${formatToolName(toolName)}`;
    });
}

// Complete all active tool indicators
function completeAllToolIndicators() {
    const indicators = messagesContainer.querySelectorAll(".tool-indicator:not(.completed)");
    indicators.forEach(indicator => {
        const toolName = indicator.dataset.tool || "tool";
        indicator.className = "tool-indicator completed";
        indicator.innerHTML = `✓ ${formatToolName(toolName)}`;
    });
}

// Format tool name for display
function formatToolName(name) {
    return name
        .replace(/_/g, " ")
        .replace(/\b\w/g, l => l.toUpperCase());
}

// Set processing state
function setProcessing(processing) {
    isProcessing = processing;
    messageInput.disabled = processing;
    sendBtn.style.display = processing ? "none" : "flex";
    abortBtn.style.display = processing ? "flex" : "none";
    
    if (!processing) {
        messageInput.focus();
    }
}

// Scroll to bottom of chat
function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Adjust textarea height
function adjustTextareaHeight() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + "px";
}

// Handle direct response from sendAndWait
ipcRenderer.on("copilot-response", (event, data) => {
    console.log("Copilot response received:", data);
    removeTypingIndicator();
    completeAllToolIndicators();
    
    if (data.content) {
        // Only add a new message if we don't have streaming content
        if (!currentAssistantMessage) {
            addMessage("assistant", data.content);
        } else {
            currentAssistantMessage.innerHTML = renderMarkdown(data.content);
        }
        // Save to history
        saveMessageToHistory("assistant", data.content);
    }
    
    currentAssistantMessage = null;
    currentContent = "";
    setProcessing(false);
    scrollToBottom();
});

// Handle streaming deltas
ipcRenderer.on("copilot-delta", (event, data) => {
    console.log("Copilot delta:", data);
    removeTypingIndicator();
    
    if (!currentAssistantMessage) {
        addMessage("assistant", "", true);
        currentContent = "";
    }
    
    currentContent += data.delta || "";
    currentAssistantMessage.innerHTML = renderMarkdown(currentContent);
    scrollToBottom();
});

// Handle tool execution notifications
ipcRenderer.on("copilot-tool", (event, data) => {
    console.log("Copilot tool:", data);
    
    if (data.status === "started" && data.name) {
        removeTypingIndicator();
        addToolIndicator(data.name);
    } else if (data.status === "complete") {
        // Tool container will be cleared when final message arrives
    }
});

// Handle Copilot events
ipcRenderer.on("copilot-event", (event, data) => {
    console.log("Renderer received event:", data.type, data);
    
    switch (data.type) {
        case "assistant.message_delta":
            // Streaming content
            removeTypingIndicator();
            if (!currentAssistantMessage) {
                addMessage("assistant", "", true);
                currentContent = "";
            }
            currentContent += data.data.deltaContent || "";
            currentAssistantMessage.innerHTML = renderMarkdown(currentContent);
            scrollToBottom();
            break;
            
        case "assistant.message":
            // Final message (non-streaming or complete)
            removeTypingIndicator();
            if (currentAssistantMessage) {
                currentAssistantMessage.innerHTML = renderMarkdown(data.data.content);
            } else if (data.data.content) {
                addMessage("assistant", data.data.content);
            }
            scrollToBottom();
            break;
        
        case "pending_messages.modified":
            // This event contains message updates - check for assistant content
            console.log("pending_messages.modified data:", JSON.stringify(data.data, null, 2));
            if (data.data && data.data.messages) {
                const messages = data.data.messages;
                for (const msg of messages) {
                    if (msg.role === "assistant" && msg.content) {
                        removeTypingIndicator();
                        if (currentAssistantMessage) {
                            currentAssistantMessage.innerHTML = renderMarkdown(msg.content);
                        } else {
                            addMessage("assistant", msg.content, true);
                            currentContent = msg.content;
                        }
                        scrollToBottom();
                    }
                }
            }
            // Also check for status indicating completion
            if (data.data && data.data.status === "idle") {
                currentAssistantMessage = null;
                currentContent = "";
                setProcessing(false);
            }
            break;
            
        case "tool.execution_start":
        case "tool_call":
            // Tool started
            const startToolName = data.data?.name || data.data?.toolName || data.data?.tool_name || "tool";
            removeTypingIndicator();
            addToolIndicator(startToolName);
            break;
            
        case "tool.execution_end":
        case "tool_result":
            // Tool completed
            const endToolName = data.data?.name || data.data?.toolName || data.data?.tool_name || "tool";
            completeToolIndicator(endToolName);
            break;
            
        case "session.idle":
        case "idle":
            // Session finished processing
            removeTypingIndicator();
            currentAssistantMessage = null;
            currentContent = "";
            setProcessing(false);
            break;
            
        case "error":
            removeTypingIndicator();
            addMessage("assistant", `Error: ${data.data?.message || data.message || "Unknown error"}`);
            setProcessing(false);
            break;
            
        default:
            console.log("Unhandled event type:", data.type, data.data);
    }
});

// Event listeners
messageInput.addEventListener("input", (e) => {
    adjustTextareaHeight();
    // Show slash command suggestions
    const value = messageInput.value;
    if (value.startsWith("/") && !value.includes(" ")) {
        showSlashSuggestions(value);
    } else {
        hideSlashSuggestions();
    }
});

messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
    if (e.key === "Escape") {
        hideSlashSuggestions();
        if (isProcessing) {
            ipcRenderer.invoke("abort-message");
            removeTypingIndicator();
            setProcessing(false);
        }
    }
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
    // Ctrl+Shift+N: New chat
    if (e.ctrlKey && e.shiftKey && e.key === "N") {
        e.preventDefault();
        newChatBtn.click();
    }
    // Ctrl+H: Toggle history
    if (e.ctrlKey && e.key === "h") {
        e.preventDefault();
        const panel = document.getElementById("history-panel");
        toggleHistoryPanel(!panel?.classList.contains("open"));
    }
    // Ctrl+,: Open settings
    if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        showSettings();
    }
});

sendBtn.addEventListener("click", sendMessage);

abortBtn.addEventListener("click", async () => {
    await ipcRenderer.invoke("abort-message");
    removeTypingIndicator();
    setProcessing(false);
});

newChatBtn.addEventListener("click", () => {
    // Clear messages
    messagesContainer.innerHTML = "";
    // Show welcome message
    welcomeMessage.style.display = "block";
    // Reset state
    currentAssistantMessage = null;
    currentContent = "";
    currentSessionId = null;
    isProcessing = false;
    setProcessing(false);
    messageInput.focus();
});

voiceBtn.addEventListener("click", toggleVoiceRecognition);

// Image capture
imageBtn.addEventListener("click", async () => {
    imageBtn.disabled = true;
    const result = await ipcRenderer.invoke("capture-screenshot");
    imageBtn.disabled = false;
    
    if (result.success && result.imageBase64) {
        pendingImageBase64 = result.imageBase64;
        previewImg.src = "data:image/png;base64," + result.imageBase64;
        imagePreview.style.display = "flex";
    } else {
        console.error("Screenshot failed:", result.error);
    }
});

removeImageBtn.addEventListener("click", clearImagePreview);

function clearImagePreview() {
    pendingImageBase64 = null;
    previewImg.src = "";
    imagePreview.style.display = "none";
}

// Model and reasoning selectors
modelSelect.addEventListener("change", async () => {
    const model = modelSelect.value;
    await ipcRenderer.invoke("change-model", model);
    // Show/hide reasoning selector based on model compatibility
    updateReasoningVisibility(model);
    // Show brief notification
    updateStatus("connected", `Model: ${model}`);
    setTimeout(() => updateStatus("connected", "Connected"), 2000);
});

function updateReasoningVisibility(model) {
    const isReasoningModel = model.startsWith("o1") || model.startsWith("o3") || model.startsWith("gpt-5");
    const reasoningContainer = reasoningSelect.parentElement;
    if (isReasoningModel) {
        reasoningContainer.style.display = "";
        reasoningContainer.title = "Reasoning effort for this model";
    } else {
        reasoningContainer.style.display = "none";
    }
}

reasoningSelect.addEventListener("change", async () => {
    const effort = reasoningSelect.value;
    await ipcRenderer.invoke("change-reasoning", effort);
});

// User confirmation handler
ipcRenderer.on("user-input-request", (event, data) => {
    confirmMessage.textContent = data.message;
    confirmModal.style.display = "flex";
    
    const handleResponse = (confirmed) => {
        confirmModal.style.display = "none";
        ipcRenderer.send(`user-input-response-${data.requestId}`, { confirmed });
    };
    
    // Remove old listeners
    confirmYesBtn.onclick = () => handleResponse(true);
    confirmNoBtn.onclick = () => handleResponse(false);
});

// Settings event listeners
settingsBtn.addEventListener("click", showSettings);
closeSettingsBtn.addEventListener("click", hideSettings);
saveSettingsBtn.addEventListener("click", saveSettings);
testWhisperBtn.addEventListener("click", testMicrophone);

// Close modal when clicking outside
settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
        hideSettings();
    }
});

confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) {
        confirmModal.style.display = "none";
        if (pendingConfirmResolve) {
            pendingConfirmResolve(false);
            pendingConfirmResolve = null;
        }
    }
});

// Initialize on load
document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    loadTheme();
    initializeCopilot();
    setupDragAndDrop();
    loadChatHistory();
});

// Drag and drop for images
function setupDragAndDrop() {
    const dropZone = document.querySelector(".chat-container");
    
    ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });
    
    ["dragenter", "dragover"].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add("drag-over");
        });
    });
    
    ["dragleave", "drop"].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove("drag-over");
        });
    });
    
    dropZone.addEventListener("drop", async (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.type.startsWith("image/")) {
                const reader = new FileReader();
                reader.onload = async (event) => {
                    const result = await ipcRenderer.invoke("process-dropped-image", event.target.result);
                    if (result.success) {
                        pendingImageBase64 = result.imageBase64;
                        previewImg.src = event.target.result;
                        imagePreview.style.display = "flex";
                    }
                };
                reader.readAsDataURL(file);
            }
        }
    });
    
    // Also handle paste
    document.addEventListener("paste", async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        for (const item of items) {
            if (item.type.startsWith("image/")) {
                e.preventDefault();
                const file = item.getAsFile();
                const reader = new FileReader();
                reader.onload = async (event) => {
                    const result = await ipcRenderer.invoke("process-dropped-image", event.target.result);
                    if (result.success) {
                        pendingImageBase64 = result.imageBase64;
                        previewImg.src = event.target.result;
                        imagePreview.style.display = "flex";
                    }
                };
                reader.readAsDataURL(file);
                break;
            }
        }
    });
}

// IPC listeners from main process
ipcRenderer.on("focus-input", () => {
    messageInput.focus();
});

ipcRenderer.on("open-settings", () => {
    showSettings();
});

ipcRenderer.on("quick-command", (event, command) => {
    messageInput.value = command;
    sendMessage();
});

// Theme toggle button handler
const themeBtn = document.getElementById("theme-btn");
if (themeBtn) {
    themeBtn.addEventListener("click", async () => {
        const currentTheme = document.body.dataset.theme || "system";
        const themes = ["system", "dark", "light"];
        const nextIndex = (themes.indexOf(currentTheme) + 1) % themes.length;
        await setTheme(themes[nextIndex]);
    });
}

// History button handler
const historyBtn = document.getElementById("history-btn");
if (historyBtn) {
    historyBtn.addEventListener("click", () => {
        const panel = document.getElementById("history-panel");
        toggleHistoryPanel(!panel?.classList.contains("open"));
    });
}

// Close history panel button
const closeHistoryBtn = document.getElementById("close-history-btn");
if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener("click", () => {
        toggleHistoryPanel(false);
    });
}
