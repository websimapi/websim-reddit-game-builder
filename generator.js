export function generateProject(config) {
    const files = {};
    const { slug, title, engine, features } = config;

    // --- 1. devvit.json ---
    const devvitConfig = {
        name: slug,
        version: "0.0.1",
        versioning: {
            "source": "package.json"
        },
        permissions: {
            // Basic permissions
        }
    };

    if (features.media) {
        devvitConfig.permissions.media = true;
    }

    files['devvit.json'] = JSON.stringify(devvitConfig, null, 2);

    // --- 2. package.json ---
    const deps = {
        "@devvit/public-api": "latest",
        "@devvit/web": "latest",
        "@devvit/redis": "latest" // Always useful
    };

    if (features.media) deps["@devvit/media"] = "latest";
    if (engine === 'phaser') deps["phaser"] = "^3.80.0";
    if (engine === 'three') deps["three"] = "^0.160.0";

    const pkgJson = {
        name: slug,
        version: "0.0.1",
        description: `A Reddit game: ${title}`,
        type: "module",
        scripts: {
            "dev": "devvit playtest",
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


    // --- 4. Server Code (src/server/index.ts) ---
    files['src/server/index.ts'] = generateServerCode(config);

    // --- 5. Client HTML (src/client/index.html) ---
    files['src/client/index.html'] = generateClientHTML(config);

    // --- 6. Client Code (src/client/client.js) ---
    files['src/client/client.js'] = generateClientJS(config);

    // --- 7. Styles (src/client/style.css) ---
    files['src/client/style.css'] = generateClientCSS(config);

    // --- 8. Bridge / README ---
    files['README.md'] = `# ${title}

## Getting Started

1. Unzip this folder.
2. Open a terminal in this folder.
3. Run \`npm install\` to install dependencies (including the devvit CLI).
4. Run \`npm run dev\` to start the Devvit development environment.
   - Note: If you don't have devvit installed globally, this uses the local version in node_modules.
5. Open the link provided in the terminal (usually looks like https://reddit.com/r/subreddit?playtest=...).

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
    const imports = [
        `import { Devvit } from '@devvit/public-api';`,
        `import { context, redis, cache } from '@devvit/web/server';`
    ];
    
    if (config.features.media) imports.push(`import { media } from '@devvit/media';`);

    let endpointCode = `
// Basic Configuration Endpoint
context.app.get('/api/config', async (req, res) => {
    // Examples of using settings (configure these in your app settings page)
    const maxPlayers = await context.settings.get('maxPlayers') || 100;
    const difficulty = await context.settings.get('difficulty') || 'normal';

    res.json({ 
        gameTitle: "${config.title}",
        maxPlayers,
        difficulty
    });
});
`;

    // Leaderboard Feature
    if (config.features.leaderboard) {
        endpointCode += `
// Leaderboard: Submit Score
context.app.post('/api/submit-score', async (req, res) => {
    const { score } = req.body;
    const userId = context.userId;
    
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    // Store in global leaderboard
    await redis.zAdd('global_leaderboard', { member: userId, score });
    
    // Get rank
    const rank = await redis.zRank('global_leaderboard', userId);
    
    res.json({ success: true, rank });
});

// Leaderboard: Get Top Scores (Cached)
context.app.get('/api/leaderboard', async (req, res) => {
    const scores = await cache(
        async () => {
            return await redis.zRange('global_leaderboard', 0, 9, { 
                reverse: true, 
                withScores: true 
            });
        },
        { key: 'leaderboard-top-10', ttl: 30 } // Cache for 30s
    );
    res.json(scores);
});
`;
    }

    // Multiplayer Feature
    if (config.features.multiplayer) {
        endpointCode += `
// Realtime: Game State
context.app.post('/api/gamestate', async (req, res) => {
    const { postId } = context;
    // Broadcast update to all listeners on this post
    await context.realtime.send(\`game:\${postId}\`, {
        type: 'update',
        data: req.body
    });
    res.json({ ok: true });
});
`;
    }

    // Media Feature
    if (config.features.media) {
        endpointCode += `
// Media: Upload
context.app.post('/api/upload-avatar', async (req, res) => {
    const { url } = req.body;
    const result = await media.upload({ url, type: 'image' });
    res.json({ url: result.mediaUrl });
});
`;
    }

    return `
${imports.join('\n')}

Devvit.configure({
    redditAPI: true,
    redis: true,
    ${config.features.media ? 'media: true,' : ''}
    ${config.features.multiplayer ? 'realtime: true,' : ''}
});

// Add a custom post type for the game
Devvit.addCustomPostType({
    name: '${config.title}',
    height: 'tall',
    render: context.render
});

${endpointCode}

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
    const imports = [`import { context } from '@devvit/web/client';`];
    let setupCode = `
// Initial Setup
const gameContainer = document.getElementById('game-container');
`;

    if (config.engine === 'phaser') {
        imports.push(`import Phaser from 'phaser';`);
        setupCode += `
// Phaser Game Setup
class MainScene extends Phaser.Scene {
    preload() {
        this.load.setBaseURL('https://labs.phaser.io');
        this.load.image('sky', 'assets/skies/space3.png');
        this.load.image('logo', 'assets/sprites/phaser3-logo.png');
    }
    create() {
        this.add.image(400, 300, 'sky');
        const logo = this.add.image(400, 150, 'logo');
        
        this.tweens.add({
            targets: logo,
            y: 450,
            duration: 2000,
            ease: "Power2",
            yoyo: true,
            loop: -1
        });
        
        // Example: Send score on click
        this.input.on('pointerdown', async () => {
             ${config.features.leaderboard ? 'await submitScore(100);' : 'console.log("Click!");'}
        });
    }
}

const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: 'game-container',
    physics: { default: 'arcade' },
    scene: MainScene
};

new Phaser.Game(config);
`;
    } else if (config.engine === 'three') {
        imports.push(`import * as THREE from 'three';`);
        setupCode += `
// Three.js Setup
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

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
`;
    } else {
        // Vanilla
        setupCode += `
// Vanilla JS Setup
gameContainer.innerHTML = '<h1>${config.title}</h1><button id="clickMe">Click Me</button>';
const btn = document.getElementById('clickMe');
btn.onclick = async () => {
    alert('Clicked!');
    ${config.features.leaderboard ? 'await submitScore(50);' : ''}
};
`;
    }

    let featureFunctions = '';
    if (config.features.leaderboard) {
        featureFunctions += `
async function submitScore(score) {
    try {
        const res = await fetch('/api/submit-score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ score })
        });
        const data = await res.json();
        console.log('New Rank:', data.rank);
        refreshLeaderboard();
    } catch(e) { console.error(e); }
}

async function refreshLeaderboard() {
    const res = await fetch('/api/leaderboard');
    const scores = await res.json();
    const list = document.getElementById('score-list');
    if(list) {
        list.innerHTML = scores.map(s => \`<li>\${s.member}: \${s.score}</li>\`).join('');
        document.getElementById('leaderboard').classList.remove('hidden');
    }
}
`;
    }

    if (config.features.multiplayer) {
        imports.push(`import { connectRealtime } from '@devvit/web/client';`);
        setupCode += `
// Connect Realtime
const connection = await connectRealtime({
    channel: \`game:\${context.postId}\`,
    onMessage: (msg) => {
        console.log('Realtime msg:', msg);
    }
});
`;
    }

    return `
${imports.join('\n')}

${featureFunctions}

(async function init() {
    ${setupCode}
})();
`;
}

