export function generateProject(config) {
    const files = {};
    const { slug, title, engine, features } = config;

    // --- 1. devvit.yaml ---
    // Removed explicit version to avoid schema validation errors in strict CLI environments
    files['devvit.yaml'] = `name: ${slug}
`;

    files['.gitignore'] = `node_modules
.devvit
dist
.env
`;

    // --- 2. package.json ---
    const deps = {
        "@devvit/public-api": "latest",
        "@devvit/web": "latest"
    };

    if (features.media) deps["@devvit/media"] = "latest";
    if (engine === 'phaser') deps["phaser"] = "^3.80.0";
    if (engine === 'three') deps["three"] = "^0.160.0";

    const pkgJson = {
        name: slug,
        version: "0.0.1",
        description: `A Reddit game: ${title}`,
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
            "typescript": "latest"
        }
    };
    files['package.json'] = JSON.stringify(pkgJson, null, 2);

    // --- 3. tsconfig.json ---
    files['tsconfig.json'] = JSON.stringify({
        "compilerOptions": {
            "target": "ES2022",
            "module": "Node16",
            "moduleResolution": "Node16",
            "lib": ["ES2022", "DOM", "DOM.Iterable"],
            "allowJs": true,
            "checkJs": false,
            "strict": true,
            "noEmit": true,
            "jsx": "react-jsx"
        },
        "include": ["src/**/*"]
    }, null, 2);


    // --- 4. Server Code (src/main.tsx) ---
    files['src/main.tsx'] = generateServerCode(config);

    // --- 5. Client HTML (src/webroot/index.html) ---
    // Note: Devvit expects web assets in a 'webroot' folder or configured path. 
    // We'll put them in src/webroot and user can configure vite if needed, 
    // but for simple playtest, putting them alongside might be easier.
    // For now, let's keep it simple.
    files['webroot/index.html'] = generateClientHTML(config);
    files['webroot/client.js'] = generateClientJS(config);
    files['webroot/style.css'] = generateClientCSS(config);

    // --- 8. Bridge / README ---
    files['README.md'] = `# ${title}

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
- Open the provided link in your browser to test your game.

## Troubleshooting

**Error: "App already initialized"**
- This occurs if you try to run \`npx devvit init\`. You do **not** need to run init, as this project is already generated. Just use \`npm run setup\` or \`npm run dev\`.

**Error: "Config is not allowed to have... version"**
- This project uses a minimal \`devvit.yaml\` to avoid this error. If you encounter issues, ensure your CLI is up to date.

## Bridge
The file \`bridge.js\` is included if you need a custom local server script, run it with \`npm run bridge\`.
`;

    files['bridge.js'] = `
// This is a simple bridge script if you need to run local tasks
console.log("Bridge connected for ${slug}!");
console.log("Run 'npm run dev' to start the actual Devvit app.");
`;

    return files;
}

function generateServerCode(config) {
    // Generate valid Devvit Main Entry
    return `import { Devvit, useState } from '@devvit/public-api';

Devvit.configure({
    redditAPI: true,
    redis: true,
    ${config.features.media ? 'media: true,' : ''}
    ${config.features.multiplayer ? 'realtime: true,' : ''}
});

Devvit.addCustomPostType({
    name: '${config.title}',
    height: 'tall',
    render: (context) => {
        return (
            <vstack height="100%" width="100%">
                <webview
                    id="game-view"
                    url="index.html"
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
                        // Add more handlers here for leaderboard/redis
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

