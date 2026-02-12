// Script to generate a simple icon for the Desktop Assistant app
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create a simple PNG icon (256x256) as base64
// This is a purple/blue gradient circle with an "AI" design
const createPngIcon = () => {
    // Using PNG with embedded data - a simple circle icon
    // For a production app, you'd want to use a proper icon generator
    
    // Create a simple ICO file with basic structure
    // ICO format: Header + Directory Entries + Image Data
    
    // For simplicity, we'll create a multi-resolution ICO with basic circles
    const sizes = [16, 32, 48, 256];
    
    // PNG signature
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    
    // For now, let's create a proper SVG that can be converted
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
        </linearGradient>
    </defs>
    <circle cx="128" cy="128" r="120" fill="url(#grad)"/>
    <circle cx="128" cy="128" r="100" fill="none" stroke="white" stroke-width="4" opacity="0.3"/>
    <g fill="white">
        <circle cx="88" cy="100" r="20"/>
        <circle cx="168" cy="100" r="20"/>
        <path d="M78 150 Q128 200 178 150" stroke="white" stroke-width="16" fill="none" stroke-linecap="round"/>
    </g>
</svg>`;

    return svg;
};

// Save SVG
const svg = createPngIcon();
fs.writeFileSync(path.join(__dirname, 'icon.svg'), svg);
console.log('SVG icon created at build-resources/icon.svg');

// Note: To create a proper .ico file, you'll need to use a tool like:
// - png-to-ico npm package
// - electron-icon-builder
// - Or convert the SVG manually using an online tool

console.log('\nTo create the .ico file, we need to convert the SVG to ICO format.');
console.log('Installing png-to-ico to help with conversion...');
