import { generateProject, wrapProject } from './generator.js';
import { ProjectZipper, saveAs } from './zip-utils.js';
import { parseProjectIdentifier, fetchProjectMetadata, fetchProjectAssets, processAssets } from './websim.js';
import JSZip from 'jszip';

// State
let selectedEngine = 'vanilla';
let mode = 'upload'; // 'upload', 'websim', 'template'
let uploadedZipFiles = null; // Stores extracted file data: { path: content }

// Initialize random slug
const randomSuffix = Math.floor(Math.random() * 10000);
const slugInput = document.getElementById('gameName');
if (slugInput) {
    slugInput.value = `my-reddit-game-${randomSuffix}`;
}

// UI Elements
const engineOptions = document.querySelectorAll('#engineOptions .option-card');
const generateBtn = document.getElementById('generateBtn');
const statusDiv = document.getElementById('status');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileInfo = document.getElementById('file-info');
const filenameDisplay = document.getElementById('filename');
const removeFileBtn = document.getElementById('removeFile');

// --- Tab Handling ---
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Switch visuals
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        tabContents.forEach(c => c.classList.add('hidden'));
        const target = document.getElementById(`tab-${btn.dataset.tab}`);
        if (target) target.classList.remove('hidden');

        // Switch State
        mode = btn.dataset.tab;
        updateGenerateButtonState();
    });
});

// --- WebSim Handling ---
const websimUrlInput = document.getElementById('websimUrl');
const fetchWebsimBtn = document.getElementById('fetchWebsimBtn');
const websimStatus = document.getElementById('websim-status');
const websimInfo = document.getElementById('websim-info');

fetchWebsimBtn.addEventListener('click', async () => {
    const url = websimUrlInput.value.trim();
    if (!url) return;

    websimStatus.textContent = "Parsing URL...";
    websimStatus.classList.remove('hidden');
    websimStatus.style.color = "var(--text-secondary)";
    
    try {
        const identifier = parseProjectIdentifier(url);
        if (!identifier) throw new Error("Could not parse WebSim URL.");

        websimStatus.textContent = "Fetching project metadata...";
        const metaData = await fetchProjectMetadata(identifier);
        
        if (!metaData || !metaData.project) throw new Error("Project not found.");

        const project = metaData.project;
        
        // Update Preview
        document.getElementById('ws-title').textContent = project.title || "Untitled";
        document.getElementById('ws-meta').textContent = `v${project.current_version} • @${project.created_by?.username || 'unknown'}`;
        websimInfo.classList.remove('hidden');
        
        // Update Main Config Inputs automatically
        document.getElementById('gameTitle').value = project.title || "WebSim Game";
        if (project.slug) {
            document.getElementById('gameName').value = project.slug; // Update slug
        }

        websimStatus.textContent = "Fetching assets...";
        
        const assetsData = await fetchProjectAssets(project.id, project.current_version);
        
        // Handle various API response structures (data, assets, project_assets)
        const rawAssets = assetsData.assets || assetsData.project_assets || assetsData.data;
        
        if (!rawAssets || !Array.isArray(rawAssets)) throw new Error("No assets found.");

        // Process assets into standard format
        uploadedZipFiles = await processAssets(rawAssets);
        
        websimStatus.textContent = `Successfully loaded ${Object.keys(uploadedZipFiles).length} files! Ready to generate.`;
        websimStatus.style.color = "#4CAF50";
        
        // Force engine detection in console preview
        wrapProject({ slug: 'temp', title: 'temp', features: {} }, uploadedZipFiles);

    } catch (e) {
        console.error(e);
        websimStatus.textContent = `Error: ${e.message}`;
        websimStatus.style.color = "red";
        websimInfo.classList.add('hidden');
        uploadedZipFiles = null;
    }
});

// --- Engine Selection ---
engineOptions.forEach(card => {
    card.addEventListener('click', () => {
        engineOptions.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedEngine = card.dataset.value;
    });
});

// --- Drag & Drop / File Handling ---
browseBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
    }
});

removeFileBtn.addEventListener('click', () => {
    uploadedZipFiles = null;
    dropZone.querySelector('.drop-content').classList.remove('hidden');
    fileInfo.classList.add('hidden');
    fileInput.value = '';
    updateGenerateButtonState();
});

async function handleFile(file) {
    if (!file || !file.name.endsWith('.zip')) {
        alert("Please upload a .zip file.");
        return;
    }

    statusDiv.textContent = "Reading zip file...";
    
    try {
        const zip = await JSZip.loadAsync(file);
        const files = {};
        
        // Extract all files
        let hasIndexHtml = false;
        
        const promises = [];
        zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir) {
                // Normalize path (fix Windows backslashes)
                const normalizedPath = relativePath.replace(/\\/g, '/');

                if (normalizedPath.includes('index.html')) hasIndexHtml = true;
                
                // Store promise to read file
                const promise = zipEntry.async('uint8array').then(content => {
                    files[normalizedPath] = content;
                });
                promises.push(promise);
            }
        });

        await Promise.all(promises);

        if (!hasIndexHtml) {
            alert("The .zip file must contain an index.html file.");
            statusDiv.textContent = "";
            return;
        }

        uploadedZipFiles = files;
        
        // Update UI
        dropZone.querySelector('.drop-content').classList.add('hidden');
        fileInfo.classList.remove('hidden');
        filenameDisplay.textContent = file.name;
        statusDiv.textContent = "File ready. Click Download to convert.";
        
    } catch (e) {
        console.error(e);
        alert("Error reading .zip file.");
        statusDiv.textContent = "";
    }
}

function updateGenerateButtonState() {
    // Optional: disable button if in upload mode but no file
}

// --- Generation ---
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

    if ((mode === 'upload' || mode === 'websim') && !uploadedZipFiles) {
        alert("Please upload a .zip file or import a WebSim project first.");
        return;
    }

    statusDiv.textContent = (mode === 'upload' || mode === 'websim') ? "Analyzing & converting project..." : "Generating project...";
    
    try {
        let files;
        if (mode === 'upload' || mode === 'websim') {
            files = wrapProject(config, uploadedZipFiles);
        } else {
            files = generateProject(config);
        }

        // 2. Zip it
        const zipper = new ProjectZipper();
        for (const [path, content] of Object.entries(files)) {
            zipper.addFile(path, content);
        }

        // 3. Download
        const blob = await zipper.generateBlob();
        saveAs(blob, `${config.slug}.zip`);
        
        statusDiv.textContent = "Download started! Unzip folder -> Run 'npm install' -> Run 'npm run setup'.";
        statusDiv.style.color = "#4CAF50";
    } catch (e) {
        console.error(e);
        statusDiv.textContent = "Error generating project. Check console.";
        statusDiv.style.color = "red";
    }
});

