import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";

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

export const createWordDocument = defineTool("create_word_document", {
    description: "Create a new Microsoft Word document with content",
    parameters: z.object({
        filePath: z.string().describe("Path where to save the document"),
        content: z.string().optional().describe("Initial text content"),
        title: z.string().optional().describe("Document title"),
        openAfterCreate: z.boolean().optional().describe("Open the document after creation (default: false)"),
    }),
    handler: async ({ filePath, content, title, openAfterCreate = false }) => {
        const resolvedPath = path.resolve(filePath.endsWith(".docx") ? filePath : `${filePath}.docx`);
        const escapedContent = (content || "").replace(/'/g, "''").replace(/\n/g, "' + [char]10 + '");
        
        const script = `
            $word = New-Object -ComObject Word.Application
            $word.Visible = $false
            $doc = $word.Documents.Add()
            ${title ? `$doc.BuiltInDocumentProperties("Title") = '${title.replace(/'/g, "''")}'` : ''}
            ${content ? `
                $selection = $word.Selection
                $selection.TypeText('${escapedContent}')
            ` : ''}
            $doc.SaveAs([ref]'${resolvedPath.replace(/\\/g, "\\\\")}', [ref]16)
            $doc.Close()
            $word.Quit()
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
            ${openAfterCreate ? `Start-Process '${resolvedPath.replace(/\\/g, "\\\\")}'` : ''}
            "Word document created at ${resolvedPath}"
        `;
        return await runPowerShell(script);
    },
});

export const createExcelDocument = defineTool("create_excel_document", {
    description: "Create a new Microsoft Excel spreadsheet",
    parameters: z.object({
        filePath: z.string().describe("Path where to save the spreadsheet"),
        sheetName: z.string().optional().describe("Name for the first sheet"),
        data: z.array(z.array(z.string())).optional().describe("2D array of data to populate"),
        openAfterCreate: z.boolean().optional().describe("Open after creation (default: false)"),
    }),
    handler: async ({ filePath, sheetName, data, openAfterCreate = false }) => {
        const resolvedPath = path.resolve(filePath.endsWith(".xlsx") ? filePath : `${filePath}.xlsx`);
        
        let dataScript = "";
        if (data && data.length > 0) {
            dataScript = data.map((row, rowIndex) => 
                row.map((cell, colIndex) => 
                    `$sheet.Cells.Item(${rowIndex + 1}, ${colIndex + 1}) = '${(cell || "").replace(/'/g, "''")}'`
                ).join("\n")
            ).join("\n");
        }
        
        const script = `
            $excel = New-Object -ComObject Excel.Application
            $excel.Visible = $false
            $workbook = $excel.Workbooks.Add()
            $sheet = $workbook.Worksheets.Item(1)
            ${sheetName ? `$sheet.Name = '${sheetName.replace(/'/g, "''")}'` : ''}
            ${dataScript}
            $workbook.SaveAs('${resolvedPath.replace(/\\/g, "\\\\")}', 51)
            $workbook.Close()
            $excel.Quit()
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
            ${openAfterCreate ? `Start-Process '${resolvedPath.replace(/\\/g, "\\\\")}'` : ''}
            "Excel spreadsheet created at ${resolvedPath}"
        `;
        return await runPowerShell(script);
    },
});

export const createPowerPointPresentation = defineTool("create_powerpoint_presentation", {
    description: "Create a new Microsoft PowerPoint presentation with custom slides",
    parameters: z.object({
        filePath: z.string().describe("Path where to save the presentation"),
        slides: z.array(z.object({
            title: z.string().describe("Slide title"),
            content: z.string().optional().describe("Slide content/body text"),
            layout: z.enum(["title", "titleAndContent", "blank", "twoContent"]).optional().describe("Slide layout"),
        })).describe("Array of slides to create"),
        openAfterCreate: z.boolean().optional().describe("Open after creation (default: false)"),
    }),
    handler: async ({ filePath, slides, openAfterCreate = false }) => {
        const resolvedPath = path.resolve(filePath.endsWith(".pptx") ? filePath : `${filePath}.pptx`);
        
        // Layout mappings: 1=Title, 2=TitleAndContent, 7=Blank, 4=TwoContent
        const layoutMap: Record<string, number> = {
            title: 1,
            titleAndContent: 2,
            blank: 7,
            twoContent: 4,
        };
        
        const slidesScript = slides.map((slide, index) => {
            const layout = layoutMap[slide.layout || "titleAndContent"];
            const escapedTitle = (slide.title || "").replace(/'/g, "''");
            const escapedContent = (slide.content || "").replace(/'/g, "''").replace(/\n/g, "' + [char]10 + '");
            
            return `
                $slideIndex = ${index + 1}
                $slide = $presentation.Slides.Add($slideIndex, ${layout})
                ${slide.title ? `
                    if ($slide.Shapes.HasTitle) {
                        $slide.Shapes.Title.TextFrame.TextRange.Text = '${escapedTitle}'
                    }
                ` : ''}
                ${slide.content ? `
                    $contentShape = $slide.Shapes | Where-Object { $_.PlaceholderFormat.Type -eq 2 } | Select-Object -First 1
                    if ($contentShape) {
                        $contentShape.TextFrame.TextRange.Text = '${escapedContent}'
                    }
                ` : ''}
            `;
        }).join("\n");
        
        const script = `
            $ppt = New-Object -ComObject PowerPoint.Application
            $presentation = $ppt.Presentations.Add()
            ${slidesScript}
            $presentation.SaveAs('${resolvedPath.replace(/\\/g, "\\\\")}')
            $presentation.Close()
            $ppt.Quit()
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
            ${openAfterCreate ? `Start-Process '${resolvedPath.replace(/\\/g, "\\\\")}'` : ''}
            "PowerPoint presentation created at ${resolvedPath} with ${slides.length} slides"
        `;
        return await runPowerShell(script);
    },
});

export const createOutlookEmail = defineTool("create_outlook_email", {
    description: "Create a new Outlook email draft",
    parameters: z.object({
        to: z.string().optional().describe("Recipient email address(es), comma-separated"),
        cc: z.string().optional().describe("CC recipients"),
        bcc: z.string().optional().describe("BCC recipients"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body content"),
        isHtml: z.boolean().optional().describe("Body is HTML formatted (default: false)"),
        attachments: z.array(z.string()).optional().describe("File paths to attach"),
        send: z.boolean().optional().describe("Send immediately instead of creating draft (default: false)"),
    }),
    handler: async ({ to, cc, bcc, subject, body, isHtml = false, attachments, send = false }) => {
        const escapedSubject = subject.replace(/'/g, "''");
        const escapedBody = body.replace(/'/g, "''").replace(/\n/g, isHtml ? "<br>" : "' + [char]10 + '");
        
        const attachmentsScript = attachments?.map(att => 
            `$mail.Attachments.Add('${path.resolve(att).replace(/\\/g, "\\\\")}')`
        ).join("\n") || "";
        
        const script = `
            $outlook = New-Object -ComObject Outlook.Application
            $mail = $outlook.CreateItem(0)
            ${to ? `$mail.To = '${to}'` : ''}
            ${cc ? `$mail.CC = '${cc}'` : ''}
            ${bcc ? `$mail.BCC = '${bcc}'` : ''}
            $mail.Subject = '${escapedSubject}'
            ${isHtml ? `$mail.HTMLBody = '${escapedBody}'` : `$mail.Body = '${escapedBody}'`}
            ${attachmentsScript}
            ${send ? '$mail.Send()' : '$mail.Display()'}
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($outlook) | Out-Null
            "${send ? 'Email sent' : 'Email draft created and displayed in Outlook'}"
        `;
        return await runPowerShell(script);
    },
});

export const createTeamsMeeting = defineTool("create_teams_meeting", {
    description: "Create a Microsoft Teams meeting invitation / calendar event via Outlook. This creates a real calendar meeting with a Teams link that is sent to all attendees.",
    parameters: z.object({
        subject: z.string().describe("Meeting subject/title"),
        body: z.string().optional().describe("Meeting description/agenda"),
        startTime: z.string().describe("Start date and time in format 'YYYY-MM-DD HH:mm' (e.g., '2026-02-11 15:00')"),
        durationMinutes: z.number().optional().describe("Duration in minutes (default: 60)"),
        attendees: z.array(z.string()).describe("List of attendee email addresses"),
        location: z.string().optional().describe("Meeting location (default: 'Microsoft Teams Meeting')"),
        isOnlineMeeting: z.boolean().optional().describe("Add Teams online meeting link (default: true)"),
        importance: z.enum(["low", "normal", "high"]).optional().describe("Meeting importance (default: 'normal')"),
        reminder: z.number().optional().describe("Reminder in minutes before meeting (default: 15)"),
        send: z.boolean().optional().describe("Send the invitation immediately (default: true)"),
    }),
    handler: async ({ subject, body, startTime, durationMinutes = 60, attendees, location, isOnlineMeeting = true, importance = "normal", reminder = 15, send = true }) => {
        const escapedSubject = subject.replace(/'/g, "''");
        const escapedBody = (body || "").replace(/'/g, "''").replace(/\n/g, "' + [char]10 + '");
        const escapedLocation = (location || "Microsoft Teams Meeting").replace(/'/g, "''");
        
        const importanceMap: Record<string, number> = { low: 0, normal: 1, high: 2 };
        
        const attendeesScript = attendees.map(email => 
            `$recipient = $meeting.Recipients.Add('${email.replace(/'/g, "''")}'); $recipient.Type = 1`
        ).join("\n");
        
        const script = `
            $outlook = New-Object -ComObject Outlook.Application
            # CreateItem(1) = olAppointmentItem
            $meeting = $outlook.CreateItem(1)
            $meeting.Subject = '${escapedSubject}'
            $meeting.Body = '${escapedBody}'
            $meeting.Location = '${escapedLocation}'
            $meeting.Start = [DateTime]::ParseExact('${startTime}', 'yyyy-MM-dd HH:mm', $null)
            $meeting.Duration = ${durationMinutes}
            $meeting.ReminderMinutesBeforeStart = ${reminder}
            $meeting.Importance = ${importanceMap[importance]}
            $meeting.BusyStatus = 2
            
            # Set as meeting (not just appointment)
            $meeting.MeetingStatus = 1
            
            # Add attendees
            ${attendeesScript}
            
            # Resolve all recipients
            $meeting.Recipients.ResolveAll() | Out-Null
            
            ${isOnlineMeeting ? `
            # Enable Teams meeting link
            try {
                # Method 1: Use the Outlook Teams Meeting Addin
                $meeting.PropertyAccessor.SetProperty("http://schemas.microsoft.com/mapi/string/{00062002-0000-0000-C000-000000000046}/IsOnlineMeeting", $true)
            } catch {
                # If property fails, it will still create the meeting without Teams link
                Write-Output "Note: Could not set online meeting property automatically"
            }
            ` : ''}
            
            ${send ? `
            $meeting.Send()
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($outlook) | Out-Null
            "Teams meeting invitation sent: '${escapedSubject}' on ${startTime} (${durationMinutes} min) to ${attendees.join(', ')}"
            ` : `
            $meeting.Display()
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($outlook) | Out-Null
            "Teams meeting draft created and displayed in Outlook: '${escapedSubject}' on ${startTime} (${durationMinutes} min)"
            `}
        `;
        return await runPowerShell(script);
    },
});

export const createCalendarEvent = defineTool("create_calendar_event", {
    description: "Create a calendar appointment/event (without attendees - just for yourself). For meetings with other people, use create_teams_meeting instead.",
    parameters: z.object({
        subject: z.string().describe("Event subject/title"),
        body: z.string().optional().describe("Event description"),
        startTime: z.string().describe("Start date and time in format 'YYYY-MM-DD HH:mm'"),
        durationMinutes: z.number().optional().describe("Duration in minutes (default: 60)"),
        location: z.string().optional().describe("Event location"),
        reminder: z.number().optional().describe("Reminder in minutes before event (default: 15)"),
        isAllDay: z.boolean().optional().describe("All-day event (default: false)"),
    }),
    handler: async ({ subject, body, startTime, durationMinutes = 60, location, reminder = 15, isAllDay = false }) => {
        const escapedSubject = subject.replace(/'/g, "''");
        const escapedBody = (body || "").replace(/'/g, "''").replace(/\n/g, "' + [char]10 + '");
        
        const script = `
            $outlook = New-Object -ComObject Outlook.Application
            $event = $outlook.CreateItem(1)
            $event.Subject = '${escapedSubject}'
            ${body ? `$event.Body = '${escapedBody}'` : ''}
            $event.Start = [DateTime]::ParseExact('${startTime}', 'yyyy-MM-dd HH:mm', $null)
            $event.Duration = ${durationMinutes}
            $event.ReminderMinutesBeforeStart = ${reminder}
            ${location ? `$event.Location = '${location.replace(/'/g, "''")}'` : ''}
            ${isAllDay ? '$event.AllDayEvent = $true' : ''}
            $event.Save()
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($outlook) | Out-Null
            "Calendar event created: '${escapedSubject}' on ${startTime} (${durationMinutes} min)"
        `;
        return await runPowerShell(script);
    },
});

export const cancelMeeting = defineTool("cancel_meeting", {
    description: "Cancel/delete a meeting from your Outlook calendar. Searches for the meeting by subject and date, then cancels it and notifies attendees.",
    parameters: z.object({
        subject: z.string().describe("The subject/title of the meeting to cancel (or a keyword to search for)"),
        date: z.string().optional().describe("Date of the meeting in format 'YYYY-MM-DD'. If not provided, searches today and upcoming days."),
        notifyAttendees: z.boolean().optional().describe("Send cancellation notice to attendees (default: true)"),
        cancellationMessage: z.string().optional().describe("Optional message to include in the cancellation notice"),
    }),
    handler: async ({ subject, date, notifyAttendees = true, cancellationMessage }) => {
        const escapedSubject = subject.replace(/'/g, "''");
        const escapedMessage = (cancellationMessage || "").replace(/'/g, "''");
        
        const dateFilter = date 
            ? `$startDate = [DateTime]::ParseExact('${date}', 'yyyy-MM-dd', $null); $endDate = $startDate.AddDays(1)`
            : `$startDate = (Get-Date).Date; $endDate = $startDate.AddDays(30)`;
        
        const script = `
            $outlook = New-Object -ComObject Outlook.Application
            $namespace = $outlook.GetNamespace("MAPI")
            $calendar = $namespace.GetDefaultFolder(9)
            
            ${dateFilter}
            
            $searchSubject = '${escapedSubject}'
            $found = $false
            $cancelledMeetings = @()
            
            # Get all items in the date range
            $items = $calendar.Items
            $items.Sort("[Start]")
            $items.IncludeRecurrences = $true
            
            $filter = "[Start] >= '" + $startDate.ToString("MM/dd/yyyy HH:mm") + "' AND [Start] < '" + $endDate.ToString("MM/dd/yyyy HH:mm") + "'"
            $restrictedItems = $items.Restrict($filter)
            
            foreach ($item in $restrictedItems) {
                if ($item.Subject -like "*$searchSubject*") {
                    $found = $true
                    $meetingInfo = "$($item.Subject) - $($item.Start.ToString('yyyy-MM-dd HH:mm'))"
                    
                    # Check if it's a meeting (has attendees) or just an appointment
                    if ($item.MeetingStatus -ne 0 -and ${notifyAttendees ? '$true' : '$false'}) {
                        # It's a meeting with attendees - send cancellation
                        ${cancellationMessage ? `$item.Body = '${escapedMessage}' + [char]10 + [char]10 + $item.Body` : ''}
                        $item.MeetingStatus = 5  # olMeetingCanceled
                        $item.Send()
                        $cancelledMeetings += "Cancelled and notified attendees: $meetingInfo"
                    } else {
                        # Just an appointment or no notification needed - delete directly
                        $item.Delete()
                        $cancelledMeetings += "Deleted: $meetingInfo"
                    }
                }
            }
            
            [System.Runtime.Interopservices.Marshal]::ReleaseComObject($outlook) | Out-Null
            
            if ($found) {
                $cancelledMeetings -join ([char]10)
            } else {
                "No meetings found matching '$searchSubject' in the specified date range."
            }
        `;
        return await runPowerShell(script);
    },
});

export const openOfficeDocument = defineTool("open_office_document", {
    description: "Open an existing Office document (Word, Excel, PowerPoint)",
    parameters: z.object({
        filePath: z.string().describe("Path to the Office document"),
    }),
    handler: async ({ filePath }) => {
        const resolvedPath = path.resolve(filePath);
        const script = `Start-Process '${resolvedPath.replace(/\\/g, "\\\\")}'`;
        await runPowerShell(script);
        return `Opened ${resolvedPath}`;
    },
});

export const setTeamsStatus = defineTool("set_teams_status", {
    description: "Change your Microsoft Teams presence/availability status. Can set to Available, Busy, Do Not Disturb, Be Right Back, Away, or Offline. Also supports setting a custom status message.",
    parameters: z.object({
        status: z.enum(["available", "busy", "dnd", "brb", "away", "offline", "reset"]).describe("The Teams status to set: 'available', 'busy', 'dnd' (Do Not Disturb), 'brb' (Be Right Back), 'away', 'offline', or 'reset' (reset to automatic)"),
        statusMessage: z.string().optional().describe("Optional custom status message (e.g., 'In a meeting', 'Working from home', 'On lunch break')"),
        expirationMinutes: z.number().optional().describe("Minutes until the status resets automatically (e.g., 60 for 1 hour). If not set, status persists until changed."),
    }),
    handler: async ({ status, statusMessage, expirationMinutes }) => {
        // Teams stores presence via Microsoft Graph API
        // We'll use the local Teams API endpoint or PowerShell with Graph
        
        // Map status to Teams availability values
        const statusMap: Record<string, { availability: string; activity: string; displayName: string }> = {
            available: { availability: "Available", activity: "Available", displayName: "Disponible / Available" },
            busy: { availability: "Busy", activity: "InACall", displayName: "Ocupado / Busy" },
            dnd: { availability: "DoNotDisturb", activity: "Presenting", displayName: "No molestar / Do Not Disturb" },
            brb: { availability: "BeRightBack", activity: "BeRightBack", displayName: "Vuelvo enseguida / Be Right Back" },
            away: { availability: "Away", activity: "Away", displayName: "Ausente / Away" },
            offline: { availability: "Offline", activity: "OffWork", displayName: "Sin conexión / Offline" },
            reset: { availability: "Available", activity: "Available", displayName: "Automático / Reset" },
        };
        
        const targetStatus = statusMap[status];
        
        // Use Teams protocol handler to set presence
        // teams:// protocol supports setting status
        const script = `
# Method 1: Try using Microsoft Graph via PowerShell
# This requires the Microsoft.Graph module or direct REST call

# First, try the Teams local API (runs on localhost when Teams is open)
try {
    # Teams new client uses a different local endpoint
    # Set presence via the Teams slimcore API
    
    # Alternative: Use the registry or Teams settings file approach
    # Teams stores status in local settings
    
    # Most reliable: Use ms-teams protocol handler
    # This opens Teams and sets the status
    $statusValue = '${targetStatus.availability}'
    
    # Try direct Graph API with current user token
    # Get token from Azure CLI
    $token = az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv 2>$null
    
    if ($token) {
        $headers = @{
            "Authorization" = "Bearer $token"
            "Content-Type" = "application/json"
        }
        
        ${status === "reset" ? `
        # Clear the presence override
        try {
            Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/me/presence/clearPresence" -Method POST -Headers $headers -Body '{
                "sessionId": "desktop-assistant"
            }'
            Write-Output "Teams status reset to automatic"
        } catch {
            Write-Output "Error resetting status: $($_.Exception.Message)"
        }
        ` : `
        # Set presence via Graph API
        ${expirationMinutes ? `
        $expiration = "PT${expirationMinutes}M"
        $body = @{
            sessionId = "desktop-assistant"
            availability = "${targetStatus.availability}"
            activity = "${targetStatus.activity}"
            expirationDuration = $expiration
        } | ConvertTo-Json
        ` : `
        $body = @{
            sessionId = "desktop-assistant"
            availability = "${targetStatus.availability}"
            activity = "${targetStatus.activity}"
        } | ConvertTo-Json
        `}
        
        try {
            Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/me/presence/setPresence" -Method POST -Headers $headers -Body $body
            Write-Output "Teams status changed to: ${targetStatus.displayName}"
        } catch {
            Write-Output "Error setting presence: $($_.Exception.Message)"
        }
        `}
        
        ${statusMessage ? `
        # Set status message
        $msgBody = @{
            statusMessage = @{
                message = @{
                    content = '${statusMessage.replace(/'/g, "''")}'
                    contentType = "text"
                }
                ${expirationMinutes ? `expiryDateTime = @{
                    dateTime = (Get-Date).AddMinutes(${expirationMinutes}).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.0000000")
                    timeZone = "UTC"
                }` : ''}
            }
        } | ConvertTo-Json -Depth 5
        
        try {
            Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/me/presence/setStatusMessage" -Method PUT -Headers $headers -Body $msgBody
            Write-Output "Status message set to: '${statusMessage.replace(/'/g, "'''")}'"
        } catch {
            Write-Output "Error setting status message: $($_.Exception.Message)"
        }
        ` : ''}
    } else {
        Write-Output "ERROR: Could not get Graph API token. Make sure you are logged in with 'az login' and have the Presence.ReadWrite permission."
    }
} catch {
    Write-Output "Error: $($_.Exception.Message)"
}
        `;
        
        return await runPowerShell(script);
    },
});

export const getTeamsStatus = defineTool("get_teams_status", {
    description: "Get your current Microsoft Teams presence/availability status.",
    parameters: z.object({}),
    handler: async () => {
        const script = `
try {
    $token = az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv 2>$null
    
    if ($token) {
        $headers = @{
            "Authorization" = "Bearer $token"
            "Content-Type" = "application/json"
        }
        
        $presence = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/me/presence" -Method GET -Headers $headers
        
        $statusMsg = ""
        try {
            $statusMsg = $presence.statusMessage.message.content
        } catch {}
        
        $result = "Teams Status: $($presence.availability)"
        $result += ([char]10 + "Activity: $($presence.activity)")
        if ($statusMsg) {
            $result += ([char]10 + "Status Message: $statusMsg")
        }
        Write-Output $result
    } else {
        Write-Output "ERROR: Could not get Graph API token. Run 'az login' first."
    }
} catch {
    Write-Output "Error: $($_.Exception.Message)"
}
        `;
        return await runPowerShell(script);
    },
});

export const officeTools = [
    createWordDocument,
    createExcelDocument,
    createPowerPointPresentation,
    createOutlookEmail,
    createTeamsMeeting,
    cancelMeeting,
    createCalendarEvent,
    openOfficeDocument,
    setTeamsStatus,
    getTeamsStatus,
];
