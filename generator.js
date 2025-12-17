// Helper to get standard dependencies
function getDependencies(features, engine = 'vanilla') {
    // Using "latest" prevents 404 errors if specific versions are deprecated or missing from registry
    const deps = {
        "@devvit/public-api": "latest",
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
    };

    // Note: @devvit/runtime is removed from explicit deps as it often causes 404s and is handled implicitly
    if (features.media) deps["@devvit/media"] = "latest";
    if (features.multiplayer) deps["@devvit/realtime"] = "latest";
    
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
            "devvit": "latest",
            "typescript": "latest", 
            "@types/react": "latest",
            "@types/react-dom": "latest",
            "esbuild": "latest" 
        },
        "peerDependencies": {
             "react": "^18.2.0",
             "react-dom": "^18.2.0"
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
This project is configured to use the "latest" available versions of Devvit packages.
This prevents 404 errors when specific versions are not found in the registry.

If you encounter installation errors:
1. Try running: \`npm install --legacy-peer-deps\`
2. Ensure you are logged in to npm or have public registry access.

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
    // Filter out MacOS artifacts and ensure we only look at relevant files
    const validPaths = Object.keys(uploadedFiles).filter(p => !p.startsWith('__MACOSX') && !p.includes('.DS_Store') && !p.includes('._'));
    
    const indexFiles = validPaths.filter(p => p.toLowerCase().endsWith('index.html') || p.toLowerCase().endsWith('index.htm'));
    // Sort by path length (shortest first) to prioritize root index.html
    // However, we should prefer index.html that are NOT in a 'node_modules' or hidden folder if possible
    indexFiles.sort((a, b) => {
        // Penalty for node_modules
        const aScore = (a.includes('node_modules') ? 1000 : 0) + a.length;
        const bScore = (b.includes('node_modules') ? 1000 : 0) + b.length;
        return aScore - bScore;
    });
    
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
        // Fallback 1: Look for ANY html file if index.html is missing
        const htmlFiles = validPaths.filter(p => p.toLowerCase().endsWith('.html') || p.toLowerCase().endsWith('.htm'));
        if (htmlFiles.length > 0) {
             console.log("⚠️ No index.html found. Using first HTML file found as entry.");
             entryPath = htmlFiles[0];
             const lastSlash = entryPath.lastIndexOf('/');
             if (lastSlash !== -1) {
                 rootPrefix = entryPath.substring(0, lastSlash + 1);
             }
        } else {
            // Fallback 2: If no html files at all, try to find a common root prefix to organize files
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
    }

    // Scan imports and detect engine
    const detectedImports = new Set();
    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();

    let processedIndexHtml = null;
    const webRootFiles = {};
    let detectedEngine = 'vanilla';

    console.group('🔍 Project Analysis');
    console.log(`Input Files: ${Object.keys(uploadedFiles).length}`);
    if (Object.keys(uploadedFiles).length < 5) {
        console.log("Files:", Object.keys(uploadedFiles));
    }

    console.log(`Root Prefix identified: "${rootPrefix}"`);
    console.log(`Entry Point: "${entryPath}"`);

    for (const [path, content] of Object.entries(uploadedFiles)) {
        // Skip system files and mac artifacts
        if (path.startsWith('__MACOSX') || path.includes('.DS_Store') || path.includes('._')) continue;

        // Skip files not under the decided root
        if (rootPrefix && !path.startsWith(rootPrefix)) continue;

        let relativePath = path;
        if (rootPrefix) {
            relativePath = path.substring(rootPrefix.length);
        }
        
        // Check if this is the entry point
        const isEntry = path === entryPath;
        const lowerPath = path.toLowerCase();
        // Broader check for text files to ensure we catch index.HTML or other variations
        const isTextFile = lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs') || lowerPath.endsWith('.jsx') || lowerPath.endsWith('.tsx') || lowerPath.endsWith('.html') || lowerPath.endsWith('.htm') || lowerPath.endsWith('.css') || lowerPath.endsWith('.json') || isEntry;

        if (isTextFile) {
            try {
                const text = decoder.decode(content);
                
                // Only scan imports for JS/HTML
                if (lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs') || lowerPath.endsWith('.jsx') || lowerPath.endsWith('.tsx') || lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
                    const imports = scanForImports(text);
                    
                    if (imports.length > 0) {
                        console.log(`Found imports in ${relativePath}:`, imports);
                        imports.forEach(i => detectedImports.add(i));
                    }
                    
                    // Heuristic Engine Detection
                    if (imports.some(i => i.toLowerCase().includes('phaser'))) detectedEngine = 'phaser';
                    if (imports.some(i => i.toLowerCase().includes('three')) || imports.some(i => i.includes('@react-three/fiber'))) detectedEngine = 'three';
                    if (imports.some(i => i.toLowerCase().includes('kaboom'))) detectedEngine = 'kaboom';
                    if (imports.some(i => i.toLowerCase().includes('babylon'))) detectedEngine = 'babylonjs';
                }

                // Keep index.html for later modification
                if (isEntry) {
                    console.log(`Entry point matched and processed: ${path}`);
                    processedIndexHtml = text;
                    continue; 
                }
            } catch (e) {
                // binary or error, skip scan
                console.warn(`Failed to decode text file: ${path}`, e);
            }
        }

        webRootFiles[relativePath] = content;
    }
    
    console.log(`✅ Detected Engine: ${detectedEngine}`);
    console.log(`📦 External Imports to Map:`, Array.from(detectedImports));
    console.groupEnd();

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

    if (processedIndexHtml !== null) {
        console.log("Processing entry point HTML...");
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
    } else {
        // Critical Fallback: No HTML file was found or processed.
        // Generate a default index.html so the Devvit app doesn't crash/show 404.
        console.warn('⚠️ No entry point found. Generating fallback index.html');
        
        const fileList = Object.keys(webRootFiles).join('</li><li>');
        const fallbackHTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
        body { background: #000; color: #fff; font-family: sans-serif; padding: 20px; text-align: center; }
        ul { text-align: left; display: inline-block; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <p>No index.html was found in the uploaded assets.</p>
    <p>Files loaded:</p>
    <ul><li>${fileList}</li></ul>
</body>
</html>`;
        webRootFiles['index.html'] = encoder.encode(fallbackHTML);
    }

    // 4. Finalize webroot
    for (const [path, content] of Object.entries(webRootFiles)) {
        files[`webroot/${path}`] = content;
    }

    return files;
}

// Helper: Scan text for module imports and engine hints
function scanForImports(code) {
    const imports = new Set();
    // Static imports
    const regex = /import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
    // Dynamic imports
    const dynamicRegex = /import\(['"]([^'"]+)['"]\)/g; 
    // CDN links in HTML
    const scriptSrcRegex = /<script[^>]+src=['"]([^'"]+)['"]/g;

    let match;
    
    // JS Imports
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
    
    // HTML Scripts (Catch CDN usage)
    while ((match = scriptSrcRegex.exec(code)) !== null) {
        const src = match[1];
        if (src.includes('three')) imports.add('three');
        if (src.includes('phaser')) imports.add('phaser');
        if (src.includes('kaboom')) imports.add('kaboom');
        if (src.includes('babylon')) imports.add('babylonjs');
        if (src.includes('p5')) imports.add('p5');
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
    const safeTitle = JSON.stringify(config.title);
    
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
            title: ${safeTitle},
            subredditName: subreddit.name,
        });
        
        ui.showToast("Game post created!");
        ui.navigateTo(post);
    },
});

// Custom Post Type definition
Devvit.addCustomPostType({
    name: 'InteractivePost',
    height: 'tall',
    render: (context) => {
        return (
            <vstack grow>
                <webview
                    id="game-view"
                    url="${webViewUrl}"
                    grow
                    onMessage={async (msg) => {
                        const data = msg as any;
                        if (data.type === 'get-config') {
                            context.ui.webView.postMessage('game-view', {
                                type: 'config',
                                payload: { title: ${safeTitle} }
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
        const text = this.add.text(400, 300, ${JSON.stringify(config.title)}, { fontSize: '32px', fill: '#fff' });
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
gameContainer.innerHTML = '<h1>' + ${JSON.stringify(config.title)} + '</h1><button id="btn">Interact</button>';
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

