// Helper to get standard dependencies
function getDependencies(features) {
    const deps = {
        "@devvit/public-api": "latest"
    };

    if (features.media) deps["@devvit/media"] = "latest";
    if (features.multiplayer) deps["@devvit/realtime"] = "latest";
    
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
            "upload": "devvit upload"
        },
        dependencies: deps,
        devDependencies: {
            "devvit": "latest",
            "typescript": "^5.0.0",
            "@devvit/tsconfig": "latest"
        }
    }, null, 2);
}

function getTsConfig() {
    return JSON.stringify({
        "extends": "@devvit/tsconfig/tsconfig.json",
        "compilerOptions": {
            "target": "ES2022",
            "module": "ESNext",
            "moduleResolution": "bundler",
            "lib": ["ES2022", "DOM"],
            "allowJs": true,
            "checkJs": false,
            "strict": false,
            "noEmit": true,
            "skipLibCheck": true,
            "esModuleInterop": true,
            "resolveJsonModule": true,
            "jsx": "react-jsx",
            "jsxImportSource": "@devvit/public-api"
        },
        "include": ["src/**/*"]
    }, null, 2);
}

// Generates the devvit.yaml
function getDevvitYaml(slug) {
    return `name: ${slug}
version: 0.0.1
webroot: webroot
`;
}

// Generates the standard README
function getReadme(slug, title) {
    return `# ${title}

## Quick Start

1. Install dependencies: \`npm install\`
2. Setup app: \`npm run setup\`
3. Start development: \`npm run dev\`
4. In the test subreddit, use the "Add Game Post" menu item to create a post

## Troubleshooting

**"Access Token Expired" / "404 Not Found" NPM Errors:**
\`\`\`bash
npm config delete //registry.npmjs.org/:_authToken
npm install
\`\`\`

**Dependency Conflicts:**
\`\`\`bash
npm install --legacy-peer-deps
\`\`\`

**Update CLI:**
\`\`\`bash
npm install -g devvit@latest
\`\`\`

## How It Works

- **webroot/**: Contains your web game (HTML/CSS/JS)
- **src/main.tsx**: Devvit server code that hosts the webview
- Import maps in HTML handle client-side dependencies

## Development

The app runs in a Devvit webview. Client-side code communicates with Devvit via postMessage.
`;
}

export function wrapProject(config, uploadedFiles) {
    const files = {};
    const { slug, title, features } = config;

    // --- 1. Analyze Content & Paths ---
    
    const sanitizedFiles = {};
    Object.entries(uploadedFiles).forEach(([p, content]) => {
        // Remove ./ or / from start
        const cleanPath = p.replace(/^(\.|\/)+/, '');
        // Filter junk
        if (!cleanPath.startsWith('__MACOSX') && 
            !cleanPath.includes('.DS_Store') && 
            !cleanPath.includes('._') && 
            cleanPath.length > 0) {
            sanitizedFiles[cleanPath] = content;
        }
    });

    const validPaths = Object.keys(sanitizedFiles);
    
    // Find Entry Point
    const indexFiles = validPaths.filter(p => 
        p.toLowerCase().endsWith('index.html') || 
        p.toLowerCase().endsWith('index.htm')
    );
    
    // Prioritize root index.html
    indexFiles.sort((a, b) => {
        const aScore = (a.includes('node_modules') ? 1000 : 0) + a.split('/').length;
        const bScore = (b.includes('node_modules') ? 1000 : 0) + b.split('/').length;
        return aScore - bScore;
    });
    
    let entryPath = indexFiles.length > 0 ? indexFiles[0] : null;

    if (!entryPath) {
        const anyHtml = validPaths.find(p => p.toLowerCase().endsWith('.html'));
        if (anyHtml) entryPath = anyHtml;
    }

    // Determine Common Root
    let rootPrefix = "";
    if (validPaths.length > 0) {
        const parts = validPaths[0].split('/');
        for (let i = 0; i < parts.length - 1; i++) {
            const prefix = parts.slice(0, i + 1).join('/') + '/';
            if (validPaths.every(p => p.startsWith(prefix))) {
                rootPrefix = prefix;
            } else {
                break;
            }
        }
    }

    let finalEntryPath = "index.html";
    if (entryPath) {
        if (entryPath.startsWith(rootPrefix)) {
            finalEntryPath = entryPath.substring(rootPrefix.length);
        } else {
            finalEntryPath = entryPath; 
        }
    }

    // --- 2. Process Files ---
    const detectedImports = new Set();
    const detectedCDNs = new Set();
    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();
    const webRootFiles = {};
    let detectedEngine = 'vanilla';
    let processedIndexHtml = null;

    console.group('🔍 Project Analysis');
    console.log(`Input Files: ${validPaths.length}`);
    console.log(`Root Prefix: "${rootPrefix}"`);
    console.log(`Entry Point: "${entryPath}" → "${finalEntryPath}"`);

    // 2a. First pass: Analyze all files
    for (const [path, content] of Object.entries(sanitizedFiles)) {
        const lowerPath = path.toLowerCase();
        if (lowerPath.match(/\.(js|mjs|jsx|tsx|ts|html|htm|css|json|vue)$/)) {
            try {
                const text = decoder.decode(content);
                const { imports, cdns } = scanForImports(text);
                imports.forEach(i => detectedImports.add(i));
                cdns.forEach(c => detectedCDNs.add(c));
                
                // Detect engine
                if (imports.some(i => i.toLowerCase().includes('phaser'))) detectedEngine = 'phaser';
                if (imports.some(i => i.toLowerCase().includes('three'))) detectedEngine = 'three';
                if (imports.some(i => i.toLowerCase().includes('kaboom'))) detectedEngine = 'kaboom';
                if (imports.some(i => i.toLowerCase().includes('babylon'))) detectedEngine = 'babylon';
                if (imports.some(i => i.toLowerCase().includes('p5'))) detectedEngine = 'p5';
            } catch (e) { 
                console.warn(`Could not analyze ${path}:`, e.message);
            }
        }
    }

    console.log(`✅ Detected Engine: ${detectedEngine}`);
    console.log(`📦 Detected Imports: ${Array.from(detectedImports).join(', ')}`);
    console.log(`🌐 Detected CDNs: ${Array.from(detectedCDNs).join(', ')}`);

    // 2b. Second pass: Move files to webroot
    for (const [path, content] of Object.entries(sanitizedFiles)) {
        let relativePath = path;
        if (path.startsWith(rootPrefix)) {
            relativePath = path.substring(rootPrefix.length);
        }

        const isEntry = path === entryPath;
        
        if (isEntry) {
            try {
                processedIndexHtml = decoder.decode(content);
                continue; 
            } catch (e) {
                console.error("Error decoding entry file", e);
                webRootFiles[relativePath] = content;
                continue;
            }
        }

        webRootFiles[relativePath] = content;
    }
    
    console.groupEnd();

    // --- 3. Generate Config ---

    files['devvit.yaml'] = getDevvitYaml(slug);
    files['.gitignore'] = `node_modules\n.devvit\ndist\n.env\n`;
    files['.npmrc'] = 'registry=https://registry.npmjs.org/\n@devvit:registry=https://registry.npmjs.org/';
    files['tsconfig.json'] = getTsConfig();
    
    const deps = getDependencies(features);
    files['package.json'] = getPackageJson(config, deps);
    files['README.md'] = getReadme(slug, title);

    // --- 4. Generate Server Code ---
    files['src/main.tsx'] = generateServerCode(config, finalEntryPath);

    // --- 5. Finalize Webroot (Inject Import Map & Polyfills) ---

    const importMap = buildImportMap(detectedImports, detectedCDNs, detectedEngine);

    if (processedIndexHtml !== null) {
        const importMapScript = `\n<script type="importmap">\n${JSON.stringify(importMap, null, 2)}\n</script>\n`;
        
        const viewportMeta = `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">`;
        
        const cssReset = `<style>
html, body { 
    margin: 0; 
    padding: 0; 
    width: 100%; 
    height: 100%; 
    overflow: hidden; 
    touch-action: none; 
    background-color: #000;
    position: fixed;
}
* { 
    box-sizing: border-box; 
}
#game-container, canvas, #app, #root {
    display: block;
    width: 100% !important;
    height: 100% !important;
    max-width: 100%;
    max-height: 100%;
}
</style>`;

        // Helper to inject code
        const injectInHead = (html, content) => {
            if (html.includes('</head>')) {
                return html.replace('</head>', `${content}\n</head>`);
            }
            if (html.includes('<body')) {
                return html.replace('<body', `${content}\n<body`);
            }
            if (html.includes('<html')) {
                return html.replace(/(<html[^>]*>)/i, `$1\n${content}`);
            }
            return `${content}\n${html}`;
        };

        // Inject polyfills only if not already present
        if (!processedIndexHtml.includes('<script type="importmap"')) {
            processedIndexHtml = injectInHead(processedIndexHtml, importMapScript);
        }
        if (!processedIndexHtml.includes('name="viewport"')) {
            processedIndexHtml = injectInHead(processedIndexHtml, viewportMeta);
        }
        if (!processedIndexHtml.includes('overflow: hidden')) {
            processedIndexHtml = injectInHead(processedIndexHtml, cssReset);
        }
        
        webRootFiles[finalEntryPath] = encoder.encode(processedIndexHtml);
    } else {
        if (!webRootFiles[finalEntryPath]) {
            const fallbackHTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>
<body>
    <h1>${title}</h1>
    <p>No index.html found. Please check your project structure.</p>
</body>
</html>`;
            webRootFiles['index.html'] = encoder.encode(fallbackHTML);
        }
    }

    for (const [path, content] of Object.entries(webRootFiles)) {
        files[`webroot/${path}`] = content;
    }

    return files;
}

// Enhanced import scanning
function scanForImports(code) {
    const imports = new Set();
    const cdns = new Set();
    
    // ES6 static imports: import X from 'pkg' or import 'pkg'
    const importRegex = /import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
    // Dynamic imports: import('pkg')
    const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    // CommonJS: require('pkg')
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    // Export from: export X from 'pkg'
    const exportRegex = /export\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
    // Script tags in HTML
    const scriptSrcRegex = /<script[^>]+src=['"]([^'"]+)['"]/gi;
    // Link tags (for CSS imports)
    const linkHrefRegex = /<link[^>]+href=['"]([^'"]+)['"]/gi;

    const patterns = [importRegex, dynamicRegex, requireRegex, exportRegex];
    
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            const mod = match[1];
            // Skip relative imports, absolute paths, and full URLs
            if (!mod.startsWith('.') && !mod.startsWith('/') && !mod.startsWith('http')) {
                // Extract base package name (handle scoped packages like @org/pkg)
                const pkgName = mod.startsWith('@') 
                    ? mod.split('/').slice(0, 2).join('/')
                    : mod.split('/')[0];
                imports.add(pkgName);
            }
        }
    }

    // Check HTML/CSS for CDN references
    let scriptMatch;
    while ((scriptMatch = scriptSrcRegex.exec(code)) !== null) {
        const src = scriptMatch[1].toLowerCase();
        detectLibraryFromURL(src, imports, cdns);
    }
    
    let linkMatch;
    while ((linkMatch = linkHrefRegex.exec(code)) !== null) {
        const href = linkMatch[1].toLowerCase();
        detectLibraryFromURL(href, imports, cdns);
    }

    return { 
        imports: Array.from(imports), 
        cdns: Array.from(cdns) 
    };
}

function detectLibraryFromURL(url, imports, cdns) {
    const libs = {
        'three': 'three',
        'phaser': 'phaser',
        'kaboom': 'kaboom',
        'babylon': 'babylonjs',
        'p5': 'p5',
        'react': 'react',
        'react-dom': 'react-dom',
        'vue': 'vue',
        'preact': 'preact',
        'pixi': 'pixi.js',
        'matter': 'matter-js',
        'howler': 'howler',
        'tone': 'tone',
        'gsap': 'gsap'
    };
    
    for (const [key, pkg] of Object.entries(libs)) {
        if (url.includes(key)) {
            imports.add(pkg);
            cdns.add(url);
        }
    }
}

function buildImportMap(detectedImports, detectedCDNs, engine) {
    const importMap = { imports: {} };
    
    // Define version-specific CDN mappings for known libraries
    const cdnMappings = {
        'three': 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
        'phaser': 'https://cdn.jsdelivr.net/npm/phaser@3.70.0/dist/phaser.esm.js',
        'kaboom': 'https://unpkg.com/kaboom@3000.0.1/dist/kaboom.mjs',
        'babylonjs': 'https://cdn.babylonjs.com/babylon.module.js',
        'p5': 'https://cdn.jsdelivr.net/npm/p5@1.7.0/lib/p5.min.js',
        'react': 'https://esm.sh/react@18',
        'react-dom': 'https://esm.sh/react-dom@18',
        'react-dom/client': 'https://esm.sh/react-dom@18/client',
        'vue': 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.js',
        'preact': 'https://esm.sh/preact@10',
        'pixi.js': 'https://cdn.jsdelivr.net/npm/pixi.js@7/dist/pixi.min.mjs',
        'matter-js': 'https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js',
        'howler': 'https://cdn.jsdelivr.net/npm/howler@2.2.3/dist/howler.min.js',
        'tone': 'https://esm.sh/tone@15',
        'gsap': 'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js'
    };
    
    // Add detected imports
    detectedImports.forEach(pkg => {
        if (cdnMappings[pkg]) {
            importMap.imports[pkg] = cdnMappings[pkg];
        } else {
            // Fallback to esm.sh for unknown packages
            importMap.imports[pkg] = `https://esm.sh/${pkg}`;
        }
    });
    
    // Add engine-specific defaults if detected
    if (engine === 'three' && !importMap.imports['three']) {
        importMap.imports['three'] = cdnMappings['three'];
    }
    if (engine === 'phaser' && !importMap.imports['phaser']) {
        importMap.imports['phaser'] = cdnMappings['phaser'];
    }
    if (engine === 'kaboom' && !importMap.imports['kaboom']) {
        importMap.imports['kaboom'] = cdnMappings['kaboom'];
    }
    if (engine === 'babylon' && !importMap.imports['babylonjs']) {
        importMap.imports['babylonjs'] = cdnMappings['babylonjs'];
    }
    if (engine === 'p5' && !importMap.imports['p5']) {
        importMap.imports['p5'] = cdnMappings['p5'];
    }
    
    return importMap;
}

export function generateProject(config) {
    const files = {};
    const { slug, title, engine, features } = config;

    files['devvit.yaml'] = getDevvitYaml(slug);
    files['.gitignore'] = `node_modules\n.devvit\ndist\n.env\n`;
    files['.npmrc'] = 'registry=https://registry.npmjs.org/\n@devvit:registry=https://registry.npmjs.org/';
    
    const deps = getDependencies(features);
    files['package.json'] = getPackageJson(config, deps);
    files['tsconfig.json'] = getTsConfig();
    files['src/main.tsx'] = generateServerCode(config, 'index.html');
    files['webroot/index.html'] = generateClientHTML(config);
    files['webroot/client.js'] = generateClientJS(config);
    files['webroot/style.css'] = generateClientCSS(config);
    files['README.md'] = getReadme(slug, title);

    return files;
}

function generateServerCode(config, entryFile = 'index.html') {
    const webViewUrl = entryFile; 
    const safeTitle = JSON.stringify(config.title);
    
    return `import { Devvit } from '@devvit/public-api';

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
        ui.showToast("Creating game post...");

        try {
            const subreddit = await reddit.getCurrentSubreddit();
            const post = await reddit.submitPost({
                title: ${safeTitle},
                subredditName: subreddit.name,
                preview: (
                    <vstack height="100%" width="100%" alignment="middle center">
                        <text size="large">Loading Game...</text>
                    </vstack>
                ),
            });
            
            ui.showToast("Game post created!");
            ui.navigateTo(post);
        } catch (e) {
            console.error("Failed to create post:", e);
            ui.showToast("Error creating post");
        }
    },
});

Devvit.addCustomPostType({
    name: 'InteractivePost',
    height: 'tall',
    render: (context) => {
        return (
            <vstack height="100%" width="100%">
                <webview
                    id="game-view"
                    url="${webViewUrl}"
                    height="100%"
                    width="100%"
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
    <meta charset="UTF-8">
    <title>${config.title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <link rel="stylesheet" href="style.css">
    <script type="importmap">
    ${JSON.stringify(buildImportMap([], [], config.engine), null, 2)}
    </script>
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
html, body { 
    margin: 0; 
    padding: 0; 
    width: 100%; 
    height: 100%; 
    overflow: hidden; 
    background: #000; 
    color: white; 
    font-family: sans-serif; 
    position: fixed;
}
#game-container { 
    width: 100vw; 
    height: 100vh; 
}
#ui-layer { 
    position: absolute; 
    top: 0; 
    left: 0; 
    padding: 10px; 
    pointer-events: none; 
}
#leaderboard { 
    background: rgba(0,0,0,0.8); 
    padding: 10px; 
    border-radius: 8px; 
    pointer-events: auto; 
}
.hidden { 
    display: none; 
}
`;
}

function generateClientJS(config) {
    const imports = [];
    let setupCode = `
const gameContainer = document.getElementById('game-container');

window.addEventListener('message', (ev) => {
    if (ev.data.type === 'config') {
        console.log('Config received:', ev.data.payload);
    }
});

window.parent.postMessage({ type: 'get-config' }, '*');
`;

    if (config.engine === 'phaser') {
        imports.push(`import Phaser from 'phaser';`);
        setupCode += `
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

new Phaser.Game({
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: 'game-container',
    scene: MainScene
});
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
gameContainer.innerHTML = '<h1>${config.title}</h1><button id="btn">Click Me</button>';
document.getElementById('btn').onclick = () => {
    alert('Hello from ${config.title}!');
};
`;
    }

    return `${imports.join('\n')}

(async function init() {
    ${setupCode}
})();
`;
}

