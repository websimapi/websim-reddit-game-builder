// generator.js
// Simple Devvit project generator + wrapper for existing web projects

function uint8ToString(u8) {
  if (typeof u8 === 'string') return u8;
  if (!(u8 instanceof Uint8Array)) return String(u8 ?? '');
  return new TextDecoder().decode(u8);
}

function getBaseFiles(config) {
  const deps = {
    "@devvit/public-api": "latest",
    "@devvit/tsconfig": "latest",
    "devvit": "latest",
    "typescript": "latest"
  };

  if (config.features?.media) deps["@devvit/media"] = "latest";
  if (config.features?.multiplayer) deps["@devvit/realtime"] = "latest";

  const pkg = {
    name: config.slug || "my-reddit-game",
    version: "0.0.1",
    description: `Reddit game: ${config.title || "My Reddit Game"}`,
    type: "module",
    main: "src/main.tsx",
    scripts: {
      "dev": "devvit playtest",
      "build": "devvit build",
      "deploy": "devvit deploy",
      "upload": "devvit upload",
      "setup": "devvit upload"
    },
    dependencies: deps
  };

  const devvitYaml = `name: ${config.slug || "my-reddit-game"}
slug: ${config.slug || "my-reddit-game"}
version: 0.0.1
sdk: ^0
webroot: webview
permissions:
  - posts
  - comments
  - subreddit-configuration
  - reddit-api
  - redis
  - modmail
  - webview
  - modlog
  ${config.features?.media ? '- media' : ''}
media:
  images: []
`;

  const readme = `# ${config.title || "My Reddit Game"}

This project was generated with Reddit Game Builder.

## Getting Started

1. **Install Dependencies**
   \`\`\`bash
   npm install
   \`\`\`

2. **Start Development**
   This runs the live developer environment (Playtest), watching for changes.
   \`\`\`bash
   npm run dev
   \`\`\`

3. **Deploy**
   When ready to publish a version:
   \`\`\`bash
   npm run deploy
   \`\`\`

## Troubleshooting

- If you see "Subreddit id is missing", ensure you are running in a valid subreddit environment.
- If you have trouble uploading, try running \`npm run setup\` again.
`;

  return {
    'package.json': JSON.stringify(pkg, null, 2),
    'devvit.yaml': devvitYaml,
    'README.md': readme
  };
}

function getMainTsx(config, webviewPath) {
  const features = config.features || {};
  const gameTitle = config.title || "Game";
  
  return `import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
  ${features.media ? 'media: true,' : ''}
  ${features.multiplayer ? 'realtime: true,' : ''}
});

// Defines the custom post type that renders the game
Devvit.addCustomPostType({
  name: 'GamePost',
  height: 'tall',
  render: (_context) => {
    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview
          id="game-webview"
          url="${webviewPath}"
          width="100%"
          height="100%"
        />
      </vstack>
    );
  },
});

// Menu item to create a new game post
Devvit.addMenuItem({
  label: 'Create Game',
  location: 'subreddit',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    
    try {
      const subreddit = await reddit.getCurrentSubreddit();
      await reddit.submitPost({
        title: ${JSON.stringify(gameTitle)},
        subredditName: subreddit.name,
        // The preview appears while the post is loading
        preview: (
          <vstack height="100%" width="100%" alignment="middle center">
            <text size="large">Loading Game...</text>
          </vstack>
        ),
      });
      ui.showToast({ text: 'Created new game post! Refresh to play.' });
    } catch (error) {
      console.error(error);
      ui.showToast({ text: 'Failed to create post' });
    }
  },
});

export default Devvit;
`;
}

function getTemplateIndexHtml(config, engine) {
  const title = config.title || 'My Reddit Game';
  const baseHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #111;
      color: #f4f4f4;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      height: 100%;
      overflow: hidden;
    }
    #game-root {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      padding: 16px 20px;
      border-radius: 8px;
      background: #1e1e1e;
      border: 1px solid #333;
      text-align: center;
      max-width: 320px;
    }
    button {
      margin-top: 12px;
      padding: 8px 16px;
      border-radius: 999px;
      border: none;
      background: #ff4500;
      color: white;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div id="game-root">
    <div class="card">
      <h1>${title}</h1>
      <p>Starter template (${engine}). Replace this with your game.</p>
      <button onclick="alert('Game start!')">Start</button>
    </div>
  </div>
  <script type="module" src="main.js"></script>
</body>
</html>
`;

  return baseHtml;
}

function getTemplateMainJs(engine) {
  // For now just a minimal stub, engine-specific logic can be added later
  return `// ${engine} starter
console.log('Game template loaded (${engine}). Replace this file with your game logic.');\n`;
}

/**
 * Generate a fresh Devvit project from a template (no uploaded files).
 * Returns an object: { "path/to/file": "content" }
 */
export function generateProject(config) {
  const files = {};
  const base = getBaseFiles(config);

  Object.assign(files, base);

  const engine = config.engine || 'vanilla';
  const webRoot = 'webview';

  files[`${webRoot}/index.html`] = getTemplateIndexHtml(config, engine);
  files[`${webRoot}/main.js`] = getTemplateMainJs(engine);
  files['src/main.tsx'] = getMainTsx(config, 'index.html');
  
  // Use a self-contained tsconfig to avoid resolution errors with 'extends'
  files['tsconfig.json'] = JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      jsx: "react",
      jsxFactory: "Devvit.createElement",
      jsxFragmentFactory: "Devvit.Fragment",
      types: ["@devvit/public-api"],
      lib: ["ES2020", "DOM"],
      skipLibCheck: true,
      esModuleInterop: true
    },
    include: ["src"]
  }, null, 2);

  return files;
}

/**
 * Wrap an existing web project (filesMap) into a Devvit app.
 * filesMap: { "path/in/zip": Uint8Array | string }
 * Returns an object: { "path/in/devvit-project": "content" }
 */
export function wrapProject(config, filesMap) {
  if (!filesMap || typeof filesMap !== 'object') {
    // Fallback to template generation if no files provided
    return generateProject(config);
  }

  const files = {};
  const base = getBaseFiles(config);
  Object.assign(files, base);

  const webRoot = 'webview';
  let entryPath = `${webRoot}/index.html`;

  // Detect index.html inside uploaded files
  let foundIndex = null;
  for (const key of Object.keys(filesMap)) {
    const normalized = key.replace(/\\/g, '/');
    if (normalized.toLowerCase().endsWith('index.html')) {
      if (!foundIndex || normalized.length < foundIndex.length) {
        foundIndex = normalized;
      }
    }
  }

  if (foundIndex) {
    // Copy all uploaded files under webview/
    for (const [path, content] of Object.entries(filesMap)) {
      const normalized = path.replace(/\\/g, '/');
      const target = `${webRoot}/${normalized}`;
      files[target] = content;
    }
    // With webroot set to 'webview', the URL is relative to that folder
    entryPath = foundIndex;
  } else {
    // No index.html detected – create a placeholder
    files[`${webRoot}/index.html`] = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Error</title></head>
<body style="background:#111;color:#f0f0f0;font-family:sans-serif;padding:20px;">
  <h1>Unable to launch game</h1>
  <p>No <code>index.html</code> was found in the uploaded files.</p>
  <p><strong>Files detected:</strong></p>
  <ul>
    ${Object.keys(filesMap).map(k => `<li>${k}</li>`).join('')}
  </ul>
</body>
</html>`;
    entryPath = 'index.html';

    // Dump files anyway so they can be inspected if needed
    for (const [path, content] of Object.entries(filesMap)) {
      const normalized = path.replace(/\\/g, '/');
      const target = `${webRoot}/${normalized}`;
      files[target] = content;
    }
  }

  files['src/main.tsx'] = getMainTsx(config, entryPath);
  
  // Use a self-contained tsconfig to avoid resolution errors with 'extends'
  files['tsconfig.json'] = JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      jsx: "react",
      jsxFactory: "Devvit.createElement",
      jsxFragmentFactory: "Devvit.Fragment",
      types: ["@devvit/public-api"],
      lib: ["ES2020", "DOM"],
      skipLibCheck: true,
      esModuleInterop: true
    },
    include: ["src"]
  }, null, 2);

  return files;
}

