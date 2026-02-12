// Create ICO file from PNGs
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createIco() {
    const pngs = [
        path.join(__dirname, 'icons', 'icon_256x256.png'),
        path.join(__dirname, 'icons', 'icon_128x128.png'),
        path.join(__dirname, 'icons', 'icon_64x64.png'),
        path.join(__dirname, 'icons', 'icon_48x48.png'),
        path.join(__dirname, 'icons', 'icon_32x32.png'),
        path.join(__dirname, 'icons', 'icon_16x16.png'),
    ];
    
    console.log('Creating ICO from PNGs...');
    
    const icoBuffer = await pngToIco(pngs);
    fs.writeFileSync(path.join(__dirname, 'icon.ico'), icoBuffer);
    
    console.log('Created icon.ico successfully!');
}

createIco().catch(console.error);
