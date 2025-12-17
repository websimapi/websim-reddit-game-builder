// Helper to get standard dependencies
function getDependencies(features, engine = 'vanilla') {
    // Using "*" or specific ranges avoids "No matching version" errors for peer deps
    const deps = {
        "@devvit/public-api": "^0.10.0", 
        "@devvit/runtime": "^0.10.0",
        "react": "^18.0.0",
        "react-dom": "^18.0.0"
    };

    if (features.media) deps["@devvit/media"] = "^0.10.0";
    if (features.multiplayer) deps["@devvit/realtime"] = "^0.10.0";
    
    // We keep these in package.json for reference
    if (engine === 'phaser') deps["phaser"] = "latest";
    if (engine === 'three') deps["three"] = "latest";
    
    return deps;
}

function getPackageJson(config, deps) {
    return JSON.stringify({
        name: config.slug,
        version: "0.0.1",
        description: `A Reddit game: ${config.title}`,
        type: "module",
        main: "src/main.tsx",
        scripts: {
            "dev": "devvit playtest",
            "setup": "devvit upload",
            "build": "devvit build",
            "upload": "devvit upload",
            "bridge": "node bridge.js" 
        },
        dependencies: deps,
        devDependencies: {
            "devvit": "^0.10.0",
            "typescript": "5.3.3", 
            "@types/react": "^18.0.0",
            "@types/react-dom": "^18.0.0",
            "esbuild": "latest" 
        },
        "peerDependencies": {
             "react": "^18.0.0",
             "react-dom": "^18.0.0"
        }
    }, null, 2);
}

function getTsConfig() {
    return JSON.stringify({
        "compilerOptions": {
            "target": "ES2020",
            "module": "ESNext",
            "moduleResolution": "bundler",
            "lib": ["ES2020", "DOM", "DOM.Iterable"],
            "allowJs": true,
            "checkJs": false,
            "strict": true,
            "noEmit": true,
            "jsx": "react-jsx"
        },
        "include": ["src/**/*"]
    }, null, 2);
}

// Generates the devvit.yaml
function getDevvitYaml(slug) {
    return `name: ${slug}
webroot: webroot
`;
}

// Generates the standard README
function getReadme(slug, title) {
    return `# ${title}

## Version
This project is configured to use the latest compatible versions.
If you encounter version errors, try running:
\`\`\`bash
npm install --legacy-peer-deps
\`\`\`

## Dependencies & Import Maps
For uploaded web projects, dependencies (like three.js, phaser) are handled via **Import Maps** injected into your \`index.html\`.
This allows your game to run in the browser without a complex bundler setup.
If you add new imports to your code, ensure they are compatible with ESM (ES Modules).

## CLI Update
Ensure your global Devvit CLI is up to date:
\`\`\`bash
npm install -g devvit
\`\`\`

## Getting Started

1. Unzip this folder.
2. Open a terminal in this folder.
3. Run \`npm install\` to install dependencies.

## First Time Setup

If you see an error like **"Your app doesn't exist yet"**, it means you need to register this app slug ("${slug}") with Reddit.

Run the setup command:
\`\`\`bash
npm run setup
\`\`\`
*(This runs \`devvit upload\`. Follow the prompts to authorize and create the app.)*

## Development

Once set up, run the playtest server:

\`\`\`bash
npm run dev
\`\`\`

- This runs \`devvit playtest\`.
- Open the provided link in your browser.
- **IMPORTANT**: In the playtest subreddit, click the **"Add Game Post"** menu item (usually in the "..." overflow menu or right-hand sidebar) to create the game post.

## Troubleshooting

**Error: "App already initialized"**
- This occurs if you try to run \`npx devvit init\`. You do **not** need to run init, as this project is already generated. Just use \`npm run setup\` or \`npm run dev\`.

**Error: "Config is not allowed to have... version"**
- This project uses a minimal \`devvit.yaml\` to avoid this error. If you encounter issues, ensure your CLI is up to date.

## Bridge
The file \`bridge.js\` is included if you need a custom local server script, run it with \`npm run bridge\`.
`;
}

export function wrapProject(config, uploadedFiles) {
    const files = {};
    const { slug, title, features } = config;

    // --- 1. Analyze Content First ---
    
    // Locate the entry point (index.html)
    const validPaths = Object.keys(uploadedFiles).filter(p => !p.startsWith('__MACOSX') && !p.includes('.DS_Store'));
    
    const indexFiles = validPaths.filter(p => p.toLowerCase().endsWith('index.html') || p.toLowerCase().endsWith('index.htm'));
    // Sort by path length (shortest first) to prioritize root index.html
    indexFiles.sort((a, b) => a.length - b.length);
    
    let entryPath = "";
    let rootPrefix = "";

    if (indexFiles.length > 0) {
        entryPath = indexFiles[0];
        // The root is the folder containing this file
        const lastSlash = entryPath.lastIndexOf('/');
        if (lastSlash !== -1) {
            rootPrefix = entryPath.substring(0, lastSlash + 1);
        }
    } else {
        // Fallback: If no index.html, assume root is just the common prefix
        if (validPaths.length > 0) {
            const firstSlash = validPaths[0].indexOf('/');
            if (firstSlash !== -1) {
                const potentialPrefix = validPaths[0].substring(0, firstSlash + 1);
                if (validPaths.every(p => p.startsWith(potentialPrefix))) {
                    rootPrefix = potentialPrefix;
                }
            }
        }
    }

    // Scan imports and detect engine
    const detectedImports = new Set();
    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();

    let processedIndexHtml = null;
    const webRootFiles = {};
    let detectedEngine = 'vanilla';

    for (const [path, content] of Object.entries(uploadedFiles)) {
        // Skip system files
        if (path.startsWith('__MACOSX') || path.includes('.DS_Store')) continue;

        // Skip files not under the decided root
        if (rootPrefix && !path.startsWith(rootPrefix)) continue;

        let relativePath = path;
        if (rootPrefix) {
            relativePath = path.substring(rootPrefix.length);
        }
        
        // Text analysis for JS/HTML
        if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.jsx') || path.endsWith('.tsx') || path.endsWith('.html') || path.endsWith('.htm')) {
            try {
                const text = decoder.decode(content);
                const imports = scanForImports(text);
                imports.forEach(i => detectedImports.add(i));
                
                // Heuristic Engine Detection
                if (imports.some(i => i.toLowerCase().includes('phaser'))) detectedEngine = 'phaser';
                if (imports.some(i => i.toLowerCase().includes('three'))) detectedEngine = 'three';

                // Keep index.html for later modification
                if (path === entryPath) {
                    processedIndexHtml = text;
                    continue; 
                }
            } catch (e) {
                // binary or error, skip scan
            }
        }

        webRootFiles[relativePath] = content;
    }

    // --- 2. Generate Project Config ---

    files['devvit.yaml'] = getDevvitYaml(slug);
    files['.gitignore'] = `node_modules\n.devvit\ndist\n.env\n`;
    files['tsconfig.json'] = getTsConfig();
    
    // Package.json with Detected Engine
    const deps = getDependencies(features, detectedEngine);
    files['package.json'] = getPackageJson(config, deps);

    files['README.md'] = getReadme(slug, title);
    files['bridge.js'] = `console.log("Bridge connected for ${slug}!");`;

    // Server Code
    // Force entry file to be exactly 'index.html' in the webroot for simplicity
    // The previous logic handled paths, but for Devvit WebViews, keeping the entry at root is safest.
    files['src/main.tsx'] = generateServerCode(config, 'index.html');

    // --- 3. Inject Helpers (Import Map, Viewport, CSS) ---

    const importMap = { imports: {} };
    detectedImports.forEach(pkg => {
        importMap.imports[pkg] = `https://esm.sh/${pkg}`;
    });

    if (processedIndexHtml) {
        // A. Import Map
        const importMapScript = `\n<script type="importmap">\n${JSON.stringify(importMap, null, 2)}\n</script>\n`;
        
        // B. Viewport (Mobile Fix)
        const viewportMeta = `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">`;
        
        // C. CSS Reset (Full Screen)
        const cssReset = `<style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; touch-action: none; background-color: #000; }
    canvas { display: block; touch-action: none; }
</style>`;

        const injectInHead = (html, content) => {
             if (html.includes('</head>')) return html.replace('</head>', `${content}\n</head>`);
             if (html.includes('<body')) return html.replace('<body', `${content}\n<body`);
             return `${content}\n${html}`;
        };

        // Inject if missing
        if (!processedIndexHtml.includes('<script type="importmap"')) {
            processedIndexHtml = injectInHead(processedIndexHtml, importMapScript);
        }
        if (!processedIndexHtml.includes('name="viewport"')) {
            processedIndexHtml = injectInHead(processedIndexHtml, viewportMeta);
        }
        // Basic check to see if they already handled overflow
        if (!processedIndexHtml.includes('overflow: hidden') && !processedIndexHtml.includes('overflow:hidden')) {
             processedIndexHtml = injectInHead(processedIndexHtml, cssReset);
        }
        
        // ALWAYS save the main entry as index.html in the root of the webroot
        // This ensures the webview url="index.html" always finds it.
        webRootFiles['index.html'] = encoder.encode(processedIndexHtml);
    }

    // 4. Finalize webroot
    for (const [path, content] of Object.entries(webRootFiles)) {
        files[`webroot/${path}`] = content;
    }

    return files;
}

// Helper: Scan text for module imports
function scanForImports(code) {
    const imports = new Set();
    const regex = /import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g; // Simple static import
    const dynamicRegex = /import\(['"]([^'"]+)['"]\)/g; // Dynamic import
    
    let match;
    while ((match = regex.exec(code)) !== null) {
        const mod = match[1];
        if (!mod.startsWith('.') && !mod.startsWith('/') && !mod.startsWith('http')) {
            imports.add(mod);
        }
    }
    while ((match = dynamicRegex.exec(code)) !== null) {
        const mod = match[1];
        if (!mod.startsWith('.') && !mod.startsWith('/') && !mod.startsWith('http')) {
            imports.add(mod);
        }
    }
    return Array.from(imports);
}

export function generateProject(config) {
    const files = {};
    const { slug, title, engine, features } = config;

    files['devvit.yaml'] = getDevvitYaml(slug);
    files['.gitignore'] = `node_modules\n.devvit\ndist\n.env\n`;
    
    const deps = getDependencies(features, engine);
    files['package.json'] = getPackageJson(config, deps);
    files['tsconfig.json'] = getTsConfig();

    // Server Code
    files['src/main.tsx'] = generateServerCode(config, 'index.html');

    // Client Code (Generated)
    files['webroot/index.html'] = generateClientHTML(config);
    files['webroot/client.js'] = generateClientJS(config);
    files['webroot/style.css'] = generateClientCSS(config);

    // Misc
    files['README.md'] = getReadme(slug, title);
    files['bridge.js'] = `console.log("Bridge connected for ${slug}!");`;

    return files;
}

function generateServerCode(config, entryFile = 'index.html') {
    // Ensure entryFile is simple
    const webViewUrl = entryFile.split('/').pop(); 
    
    return `import { Devvit, useState } from '@devvit/public-api';

Devvit.configure({
    redditAPI: true,
    redis: true,
    ${config.features.media ? 'media: true,' : ''}
    ${config.features.multiplayer ? 'realtime: true,' : ''}
});

// Add a menu item to the subreddit menu to instantiate the game
Devvit.addMenuItem({
    label: 'Add Game Post',
    location: 'subreddit',
    forUserType: 'moderator',
    onPress: async (_event, context) => {
        const { reddit, ui } = context;
        ui.showToast("Submitting your game post...");

        const subreddit = await reddit.getCurrentSubreddit();
        const post = await reddit.submitPost({
            title: '${config.title}',
            subredditName: subreddit.name,
        });
        
        ui.showToast("Game post created!");
        ui.navigateTo(post);
    },
});

// Custom Post Type definition
Devvit.addCustomPostType({
    name: '${config.title}', // Matches the display title
    height: 'tall', // Forces 1:1 aspect ratio roughly, or tall vertical
    render: (context) => {
        return (
            <vstack grow height="100%">
                <webview
                    id="game-view"
                    url="${webViewUrl}"
                    grow
                    onMessage={async (msg) => {
                        const data = msg as any;
                        if (data.type === 'get-config') {
                            context.ui.webView.postMessage('game-view', {
                                type: 'config',
                                payload: { title: "${config.title}" }
                            });
                        }
                    }}
                />
            </vstack>
        );
    }
});

export default Devvit;
`;
}

function generateClientHTML(config) {
    return `<!DOCTYPE html>
<html>
<head>
    <title>${config.title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div id="game-container"></div>
    <div id="ui-layer">
        ${config.features.leaderboard ? '<div id="leaderboard" class="hidden"><h3>Leaderboard</h3><ul id="score-list"></ul></div>' : ''}
    </div>
    <script type="module" src="client.js"></script>
</body>
</html>`;
}

function generateClientCSS(config) {
    return `
body { margin: 0; padding: 0; overflow: hidden; background: #000; color: white; font-family: sans-serif; }
#game-container { width: 100vw; height: 100vh; }
#ui-layer { position: absolute; top: 0; left: 0; padding: 10px; pointer-events: none; }
#leaderboard { background: rgba(0,0,0,0.8); padding: 10px; border-radius: 8px; pointer-events: auto; }
.hidden { display: none; }
`;
}

function generateClientJS(config) {
    // Basic client structure
    const imports = [];
    let setupCode = `
// Initial Setup
const gameContainer = document.getElementById('game-container');

// Basic communication with Devvit Parent
window.addEventListener('message', (ev) => {
    if (ev.data.type === 'config') {
        console.log('Config received:', ev.data.payload);
    }
});

// Request config
window.parent.postMessage({ type: 'get-config' }, '*');
`;

    if (config.engine === 'phaser') {
        imports.push(`import Phaser from 'phaser';`);
        setupCode += `
// Phaser Game Setup
class MainScene extends Phaser.Scene {
    preload() {
        this.load.setBaseURL('https://labs.phaser.io');
        this.load.image('sky', 'assets/skies/space3.png');
    }
    create() {
        this.add.image(400, 300, 'sky');
        const text = this.add.text(400, 300, '${config.title}', { fontSize: '32px', fill: '#fff' });
        text.setOrigin(0.5);
    }
}

const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: 'game-container',
    scene: MainScene
};

new Phaser.Game(config);
`;
    } else if (config.engine === 'three') {
        imports.push(`import * as THREE from 'three';`);
        setupCode += `
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
gameContainer.appendChild(renderer.domElement);
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);
camera.position.z = 5;
function animate() {
    requestAnimationFrame(animate);
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    renderer.render(scene, camera);
}
animate();
`;
    } else {
        setupCode += `
gameContainer.innerHTML = '<h1>${config.title}</h1><button id="btn">Interact</button>';
document.getElementById('btn').onclick = () => {
    window.parent.postMessage({ type: 'click', data: 'hello' }, '*');
};
`;
    }

    return `
${imports.join('\n')}

(async function init() {
    ${setupCode}
})();
`;
}

