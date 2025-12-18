// generator.js
// Simple Devvit project generator + wrapper for existing web projects

function uint8ToString(u8) {
  if (typeof u8 === 'string') return u8;
  if (!(u8 instanceof Uint8Array)) return String(u8 ?? '');
  return new TextDecoder().decode(u8);
}

function getBaseFiles(config) {
  const deps = {
    "@devvit/public-api": "latest"
  };

  const pkg = {
    name: config.slug || "my-reddit-game",
    version: "0.0.1",
    description: `Reddit game: ${config.title || "My Reddit Game"}`,
    type: "module",
    main: "src/main.tsx",
    scripts: {
      build: "devvit build",
      deploy: "devvit deploy",
      setup: "devvit upload"
    },
    dependencies: deps
  };

  const devvitYaml = `name: ${config.slug || "my-reddit-game"}
slug: ${config.slug || "my-reddit-game"}
version: 0.0.1
sdk: ^0
permissions:
  - posts
  - comments
  - subreddit-configuration
  - reddit-api
  - redis
  - modmail
  - webview
  - modlog
media:
  images: []
`;

  return {
    'package.json': JSON.stringify(pkg, null, 2),
    'devvit.yaml': devvitYaml
  };
}

function getMainTsx(webviewPath) {
  // Basic Devvit app that renders a webview pointing at our index.html
  return `import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
  web: true,
});

Devvit.addMenuItem({
  label: 'Play Game',
  location: 'subreddit',
  onPress: async (event, ctx) => {
    await ctx.ui.showWebView({
      id: 'game-webview',
      title: 'Game',
      url: '${webviewPath}',
    });
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
  files['src/main.tsx'] = getMainTsx(`${webRoot}/index.html`);
  files['tsconfig.json'] = JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "Node",
      strict: true,
      jsx: "react-jsx",
      jsxImportSource: "@devvit/public-api",
      types: ["@devvit/public-api"]
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
      files[target] = uint8ToString(content);
    }
    entryPath = `${webRoot}/${foundIndex}`;
  } else {
    // No index.html detected – just dump everything under webview/raw
    for (const [path, content] of Object.entries(filesMap)) {
      const normalized = path.replace(/\\/g, '/');
      const target = `${webRoot}/raw/${normalized}`;
      files[target] = uint8ToString(content);
    }
  }

  files['src/main.tsx'] = getMainTsx(entryPath);
  files['tsconfig.json'] = JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "Node",
      strict: true,
      jsx: "react-jsx",
      jsxImportSource: "@devvit/public-api",
      types: ["@devvit/public-api"]
    },
    include: ["src"]
  }, null, 2);

  return files;
}

