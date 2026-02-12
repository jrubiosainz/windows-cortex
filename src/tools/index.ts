export { windowTools } from "./windows-tools.js";
export { fileTools } from "./file-tools.js";
export { appTools } from "./app-tools.js";
export { systemTools } from "./system-tools.js";
export { processTools } from "./process-tools.js";
export { clipboardTools } from "./clipboard-tools.js";
export { officeTools } from "./office-tools.js";
export { workiqTools } from "./workiq-tools.js";

import { windowTools } from "./windows-tools.js";
import { fileTools } from "./file-tools.js";
import { appTools } from "./app-tools.js";
import { systemTools } from "./system-tools.js";
import { processTools } from "./process-tools.js";
import { clipboardTools } from "./clipboard-tools.js";
import { officeTools } from "./office-tools.js";
import { workiqTools } from "./workiq-tools.js";

export const allTools = [
    ...windowTools,
    ...fileTools,
    ...appTools,
    ...systemTools,
    ...processTools,
    ...clipboardTools,
    ...officeTools,
    ...workiqTools,
];
