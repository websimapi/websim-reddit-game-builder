import { generateProject } from './generator.js';
import { ProjectZipper, saveAs } from './zip-utils.js';

// State
let selectedEngine = 'vanilla';

// Initialize random slug to avoid collision errors
const randomSuffix = Math.floor(Math.random() * 10000);
const slugInput = document.getElementById('gameName');
if (slugInput) {
    slugInput.value = `my-reddit-game-${randomSuffix}`;
}

// UI Elements
const engineOptions = document.querySelectorAll('#engineOptions .option-card');
const generateBtn = document.getElementById('generateBtn');
const statusDiv = document.getElementById('status');

// Handle Engine Selection
engineOptions.forEach(card => {
    card.addEventListener('click', () => {
        // Remove active class from all
        engineOptions.forEach(c => c.classList.remove('selected'));
        // Add to clicked
        card.classList.add('selected');
        selectedEngine = card.dataset.value;
    });
});

// Handle Generation
generateBtn.addEventListener('click', async () => {
    const config = {
        slug: document.getElementById('gameName').value || 'my-game',
        title: document.getElementById('gameTitle').value || 'My Game',
        engine: selectedEngine,
        features: {
            leaderboard: document.getElementById('feat-leaderboard').checked,
            multiplayer: document.getElementById('feat-multiplayer').checked,
            media: document.getElementById('feat-media').checked
        }
    };

    statusDiv.textContent = "Generating project...";
    
    try {
        // 1. Generate file content
        const files = generateProject(config);

        // 2. Zip it
        const zipper = new ProjectZipper();
        for (const [path, content] of Object.entries(files)) {
            zipper.addFile(path, content);
        }

        // 3. Download
        const blob = await zipper.generateBlob();
        saveAs(blob, `${config.slug}.zip`);
        
        statusDiv.textContent = "Download started! Unzip and run 'npm run dev'.";
        statusDiv.style.color = "#4CAF50";
    } catch (e) {
        console.error(e);
        statusDiv.textContent = "Error generating project. Check console.";
        statusDiv.style.color = "red";
    }
});

