// Script to generate icon.png from icon.svg
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Modern app icon design - a sleek assistant robot
const svgIcon = `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#8b5cf6"/>
    </linearGradient>
    <linearGradient id="face" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff"/>
      <stop offset="100%" style="stop-color:#f0f0f0"/>
    </linearGradient>
  </defs>
  
  <!-- Background circle -->
  <circle cx="128" cy="128" r="120" fill="url(#bg)"/>
  
  <!-- Robot head (rounded rectangle) -->
  <rect x="58" y="55" width="140" height="130" rx="25" fill="url(#face)"/>
  
  <!-- Antenna -->
  <circle cx="128" cy="45" r="12" fill="#6366f1"/>
  <rect x="124" y="40" width="8" height="20" fill="#6366f1"/>
  
  <!-- Eyes -->
  <circle cx="93" cy="110" r="22" fill="#6366f1"/>
  <circle cx="163" cy="110" r="22" fill="#6366f1"/>
  <circle cx="93" cy="106" r="8" fill="white"/>
  <circle cx="163" cy="106" r="8" fill="white"/>
  
  <!-- Smile -->
  <path d="M88 155 Q128 185 168 155" stroke="#6366f1" stroke-width="10" fill="none" stroke-linecap="round"/>
  
  <!-- Ears/Side panels -->
  <rect x="38" y="90" width="25" height="50" rx="8" fill="#6366f1"/>
  <rect x="193" y="90" width="25" height="50" rx="8" fill="#6366f1"/>
  
  <!-- Subtle glow effect -->
  <circle cx="128" cy="128" r="115" fill="none" stroke="white" stroke-width="3" opacity="0.2"/>
</svg>`;

async function generateIcons() {
    console.log('Generating icons...');
    
    // Convert SVG to PNG at different sizes
    const sizes = [16, 32, 48, 64, 128, 256, 512];
    
    // First create the base 256x256 PNG
    await sharp(Buffer.from(svgIcon))
        .resize(256, 256)
        .png()
        .toFile(path.join(__dirname, 'icon.png'));
    
    console.log('Created icon.png (256x256)');
    
    // Create icons directory
    const iconsDir = path.join(__dirname, 'icons');
    if (!fs.existsSync(iconsDir)) {
        fs.mkdirSync(iconsDir, { recursive: true });
    }
    
    // Generate all sizes
    for (const size of sizes) {
        await sharp(Buffer.from(svgIcon))
            .resize(size, size)
            .png()
            .toFile(path.join(iconsDir, `icon_${size}x${size}.png`));
        console.log(`Created icon_${size}x${size}.png`);
    }
    
    console.log('\nAll PNG icons generated!');
    console.log('\nTo create .ico file for Windows:');
    console.log('Use a tool like png-to-ico or online converter');
    console.log('Then place the icon.ico in build-resources folder');
}

generateIcons().catch(console.error);
