// Test script to understand SDK behavior
import { CopilotClient } from "@github/copilot-sdk";

async function main() {
    console.log("Creating Copilot client...");
    const client = new CopilotClient({
        logLevel: "debug"
    });
    
    console.log("Starting client...");
    await client.start();
    console.log("Client started");
    
    console.log("Creating session...");
    const session = await client.createSession({
        model: "gpt-4.1"
    });
    console.log("Session created");
    
    // Log all events
    session.on((event) => {
        console.log(`EVENT [${event.type}]:`, JSON.stringify(event.data, null, 2).substring(0, 500));
    });
    
    console.log("Sending message...");
    try {
        const response = await session.sendAndWait({ prompt: "Say hello in one word" }, 120000);
        console.log("RESPONSE:", response);
    } catch (err) {
        console.error("Error:", err.message);
    }
    
    console.log("Destroying session...");
    await session.destroy();
    
    console.log("Stopping client...");
    await client.stop();
    
    console.log("Done!");
}

main().catch(console.error);
