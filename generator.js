// Helper to get standard dependencies
function getDependencies(features, engine = 'vanilla', detectedImports = []) {
    // Using "latest" prevents 404 errors if specific versions are deprecated or missing from registry
    const deps = {
        "@devvit/public-api": "latest",
        "@devvit/runtime": "latest",
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
    };

    if (features.media) deps["@devvit/media"] = "latest";
    if (features.multiplayer) deps["@devvit/realtime"] = "latest";
    
    // Auto-detected dependencies from analysis
    if (detectedImports && Array.isArray(detectedImports)) {
        detectedImports.forEach(pkg => {
            // Basic filtering for valid package names
            if (!pkg.startsWith('.') && !pkg.startsWith('/') && !pkg.startsWith('http')) {
                // Ensure it looks like a package (scope/name or name)
                if (/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkg)) {
                    deps[pkg] = "latest";
                }
            }
        });
    }

    // Explicit engine deps
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
            "lib": ["ES2022", "DOM", "DOM.Iterable"],
            "allowJs": true,
            "checkJs": false,
            "strict": true,
            "noEmit": true,
            "jsx": "react-jsx",
            "jsxImportSource": "@devvit/public-api",
            "skipLibCheck": true
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

    // --- 1. Analyze Content & Paths ---
    
    // Normalize paths (remove leading slashes) & Filter junk
    const sanitizedFiles = {};
    Object.entries(uploadedFiles).forEach(([p, content]) => {
        // Remove leading ./ or /
        const cleanPath = p.replace(/^(\.|\/)+/, '');
        if (!cleanPath.startsWith('__MACOSX') && !cleanPath.includes('.DS_Store') && !cleanPath.includes('._') && cleanPath.length > 0) {
            sanitizedFiles[cleanPath] = content;
        }
    });

    const validPaths = Object.keys(sanitizedFiles);
    
    // Find Entry Point (prioritize index.html)
    const indexFiles = validPaths.filter(p => p.toLowerCase().endsWith('index.html') || p.toLowerCase().endsWith('index.htm'));
    // Sort: prioritize root files (shortest path), and de-prioritize node_modules
    indexFiles.sort((a, b) => {
        const aScore = (a.includes('node_modules') ? 1000 : 0) + a.split('/').length;
        const bScore = (b.includes('node_modules') ? 1000 : 0) + b.split('/').length;
        return aScore - bScore;
    });
    
    let entryPath = indexFiles.length > 0 ? indexFiles[0] : null;

    // Fallback: Use any HTML file
    if (!entryPath) {
        const anyHtml = validPaths.find(p => p.toLowerCase().endsWith('.html'));
        if (anyHtml) entryPath = anyHtml;
    }

    // Determine "Common Root" to strip unnecessarily nested folders (e.g. if everything is in "MyGame/")
    // Logic: If all valid paths start with the same directory prefix, we strip it.
    let rootPrefix = "";
    if (validPaths.length > 0) {
        const parts = validPaths[0].split('/');
        // Try prefixes of increasing length
        for (let i = 0; i < parts.length - 1; i++) {
            const prefix = parts.slice(0, i + 1).join('/') + '/';
            if (validPaths.every(p => p.startsWith(prefix))) {
                rootPrefix = prefix;
            } else {
                break;
            }
        }
    }

    // Calculate final Entry Path relative to the new webroot
    let finalEntryPath = "index.html"; // Default fallback
    if (entryPath) {
        if (entryPath.startsWith(rootPrefix)) {
            finalEntryPath = entryPath.substring(rootPrefix.length);
        } else {
            // Should not happen if rootPrefix logic is correct, but safety net:
            finalEntryPath = entryPath; 
        }
    }

    // --- 2. Process Files ---
    const detectedImports = new Set();
    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();
    const webRootFiles = {};
    let detectedEngine = 'vanilla';
    let processedIndexHtml = null;

    console.group('🔍 Project Analysis');
    console.log(`Input Files: ${validPaths.length}`);
    console.log(`Root Prefix identified: "${rootPrefix}"`);
    console.log(`Original Entry Point: "${entryPath}"`);
    console.log(`Final Webroot Entry: "${finalEntryPath}"`);

    // 2a. First pass: Analyze all files (Scan for imports/engine)
    for (const [path, content] of Object.entries(sanitizedFiles)) {
        const lowerPath = path.toLowerCase();
        // Check if likely text for analysis
        if (lowerPath.match(/\.(js|mjs|jsx|tsx|html|htm|css|json)$/)) {
            try {
                const text = decoder.decode(content);
                const imports = scanForImports(text);
                imports.forEach(i => detectedImports.add(i));
                
                if (imports.some(i => i.toLowerCase().includes('phaser'))) detectedEngine = 'phaser';
                if (imports.some(i => i.toLowerCase().includes('three'))) detectedEngine = 'three';
                if (imports.some(i => i.toLowerCase().includes('kaboom'))) detectedEngine = 'kaboom';
            } catch (e) { /* ignore analysis errors */ }
        }
    }

    console.log(`✅ Detected Engine: ${detectedEngine}`);

    // 2b. Second pass: Process and move files to Webroot
    for (const [path, content] of Object.entries(sanitizedFiles)) {
        // Determine relative path in webroot
        let relativePath = path;
        if (path.startsWith(rootPrefix)) {
            relativePath = path.substring(rootPrefix.length);
        }

        const isEntry = path === entryPath;
        
        // If it is the entry point, we decode it to inject scripts later
        if (isEntry) {
            try {
                processedIndexHtml = decoder.decode(content);
                // We do NOT add it to webRootFiles here, we add the modified version later
                continue; 
            } catch (e) {
                console.error("Error decoding entry file", e);
                // If decoding fails, just treat as binary and add as is
                webRootFiles[relativePath] = content;
                continue;
            }
        }

        // Add standard file
        webRootFiles[relativePath] = content;
    }
    
    console.log(`✅ Detected Engine: ${detectedEngine}`);
    console.groupEnd();

    // --- 3. Generate Config ---

    files['devvit.yaml'] = getDevvitYaml(slug);
    files['.gitignore'] = `node_modules\n.devvit\ndist\n.env\n`;
    files['tsconfig.json'] = getTsConfig();
    
    const deps = getDependencies(features, detectedEngine, Array.from(detectedImports));
    files['package.json'] = getPackageJson(config, deps);
    files['README.md'] = getReadme(slug, title);
    files['bridge.js'] = `console.log("Bridge connected for ${slug}!");`;

    // --- 4. Generate Server Code ---
    // Pass the actual relative path to the entry file
    files['src/main.tsx'] = generateServerCode(config, finalEntryPath);

    // --- 5. Finalize Webroot (Inject Polyfills) ---

    const importMap = { imports: {} };
    detectedImports.forEach(pkg => {
        importMap.imports[pkg] = `https://esm.sh/${pkg}`;
    });

    if (processedIndexHtml !== null) {
        // Inject Import Map & Viewport
        const importMapScript = `\n<script type="importmap">\n${JSON.stringify(importMap, null, 2)}\n</script>\n`;
        const viewportMeta = `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">`;
        const cssReset = `<style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; touch-action: none; background-color: #000; }
</style>`;

        const injectInHead = (html, content) => {
             if (html.includes('</head>')) return html.replace('</head>', `${content}\n</head>`);
             if (html.includes('<body')) return html.replace('<body', `${content}\n<body`);
             return `${content}\n${html}`;
        };

        if (!processedIndexHtml.includes('<script type="importmap"')) processedIndexHtml = injectInHead(processedIndexHtml, importMapScript);
        if (!processedIndexHtml.includes('name="viewport"')) processedIndexHtml = injectInHead(processedIndexHtml, viewportMeta);
        if (!processedIndexHtml.includes('overflow: hidden')) processedIndexHtml = injectInHead(processedIndexHtml, cssReset);
        
        // Write modified entry file to its CORRECT location
        webRootFiles[finalEntryPath] = encoder.encode(processedIndexHtml);
    } else {
        // Fallback: Only generate if we don't have an entry file already (e.g. if decode failed but file exists, don't overwrite)
        if (!webRootFiles[finalEntryPath]) {
            const fallbackHTML = `<!DOCTYPE html><html><body><h1>${title}</h1><p>No index.html found. Please check your zip structure.</p></body></html>`;
            webRootFiles['index.html'] = encoder.encode(fallbackHTML);
        }
    }

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
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;

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
    
    // CommonJS Requires
    while ((match = requireRegex.exec(code)) !== null) {
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
    // We use the full relative path for the webview URL to support structured zips
    const webViewUrl = entryFile; 
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

        try {
            const subreddit = await reddit.getCurrentSubreddit();
            const currentSubredditName = subreddit.name;
            console.log("Submitting to r/" + currentSubredditName);
            console.log("Title:", ${safeTitle});

            const post = await reddit.submitPost({
                title: ${safeTitle},
                subredditName: currentSubredditName,
                // The preview appears while the post loads and signals this is a custom post
                preview: (
                    <vstack height="100%" width="100%" alignment="middle center">
                        <text size="large">Loading Game...</text>
                    </vstack>
                ),
            });
            
            console.log("Post created successfully:", post.id);
            ui.showToast("Game post created!");
            ui.navigateTo(post);
        } catch (e) {
            console.error("Failed to create post:", e);
            ui.showToast("Failed to create post. Check logs.");
        }
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

