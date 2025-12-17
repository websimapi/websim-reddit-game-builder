// Helper to get standard dependencies
function getDependencies(features, engine = 'vanilla') {
    const deps = {
        "@devvit/public-api": "^0.10.0",
        "@devvit/web": "^0.10.0",
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
    };

    if (features.media) deps["@devvit/media"] = "^0.10.0";
    if (engine === 'phaser') deps["phaser"] = "^3.80.0";
    if (engine === 'three') deps["three"] = "^0.160.0";
    
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
            "typescript": "5.3.0",
            "@types/react": "18.2.0",
            "@types/react-dom": "18.2.0",
            "esbuild": "0.19.0" 
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
version: 0.0.1
`;
}

// Generates the standard README
function getReadme(slug, title) {
    return `# ${title}

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

    // Standard Devvit Files
    files['devvit.yaml'] = getDevvitYaml(slug);
    files['.gitignore'] = `node_modules\n.devvit\ndist\n.env\n`;
    files['tsconfig.json'] = getTsConfig();
    
    // Package.json - General deps since we don't know the engine
    const deps = getDependencies(features, 'vanilla');
    files['package.json'] = getPackageJson(config, deps);

    // README
    files['README.md'] = getReadme(slug, title);

    // Bridge
    files['bridge.js'] = `console.log("Bridge connected for ${slug}!");`;

    // Server Code (src/main.tsx)
    // For wrapped projects, we assume 'index.html' is the entry point
    files['src/main.tsx'] = generateServerCode(config, 'index.html');

    // Content
    // We need to place uploaded files into 'webroot'.
    // If the zip has a root folder (e.g. game/index.html), we might want to flatten it,
    // but for safety, we'll just put everything in webroot and locate index.html.
    // NOTE: Devvit expects webroot to be flat or configured. The simplest is putting everything in `webroot`.
    
    // Check if there is a single top-level directory and strip it if needed
    // Filter out system files first to get accurate paths
    const validPaths = Object.keys(uploadedFiles).filter(p => !p.startsWith('__MACOSX') && !p.includes('.DS_Store'));
    
    let commonPrefix = "";
    if (validPaths.length > 0) {
        const firstSlash = validPaths[0].indexOf('/');
        if (firstSlash !== -1) {
            const potentialPrefix = validPaths[0].substring(0, firstSlash + 1);
            if (validPaths.every(p => p.startsWith(potentialPrefix))) {
                commonPrefix = potentialPrefix;
            }
        }
    }

    // Copy files
    for (const [path, content] of Object.entries(uploadedFiles)) {
        // Skip system files
        if (path.startsWith('__MACOSX') || path.includes('.DS_Store')) continue;

        let cleanPath = path;
        if (commonPrefix && path.startsWith(commonPrefix)) {
            cleanPath = path.substring(commonPrefix.length);
        }
        
        files[`webroot/${cleanPath}`] = content;
    }
    
    return files;
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
    return `import { Devvit, useState } from '@devvit/public-api';
import React from 'react';

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
        await reddit.submitPost({
            title: '${config.title}',
            subredditName: subreddit.name,
            // The preview appears while the post loads
            preview: (
                <vstack height="100%" width="100%" alignment="middle center">
                    <text size="large">Loading Game...</text>
                </vstack>
            ),
        });

        ui.showToast("Game post created!");
    },
});

Devvit.addCustomPostType({
    name: '${config.title}',
    height: 'tall',
    render: (context) => {
        return (
            <vstack height="100%" width="100%">
                <webview
                    id="game-view"
                    url="${entryFile}"
                    height="100%"
                    width="100%"
                    onMessage={async (msg) => {
                        const data = msg as any;
                        // Basic Bridge for Features
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

