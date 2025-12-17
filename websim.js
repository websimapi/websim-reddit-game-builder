// WebSim API Integration
// Using relative path to avoid CORS when running inside WebSim
const API_BASE = '/api/v1';

async function makeRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }
    
    return response.json();
}

// --- Core API Functions ---

export function getProjectById(projectId) {
    return makeRequest(`/projects/${projectId}`);
}

export function getProjectBySlug(username, slug) {
    return makeRequest(`/users/${username}/slugs/${slug}`);
}

export function getProjectRevisions(projectId, params = {}) {
    const query = new URLSearchParams(params).toString();
    return makeRequest(`/projects/${projectId}/revisions?${query}`);
}

export async function getAllProjectRevisions(projectId) {
    let allRevisions = [];
    let hasNextPage = true;
    let afterCursor = null;

    while (hasNextPage) {
        const params = { first: 100 }; // Fetch 100 at a time
        if (afterCursor) {
            params.after = afterCursor;
        }

        const response = await getProjectRevisions(projectId, params);
        
        if (response.revisions && response.revisions.data) {
            allRevisions = allRevisions.concat(response.revisions.data);
        }
        
        hasNextPage = response.revisions?.meta?.has_next_page || false;
        afterCursor = response.revisions?.meta?.end_cursor;

        // Safety break if there's no cursor to advance
        if (!afterCursor) {
            hasNextPage = false;
        }
    }

    return allRevisions;
}

export function getProjectRevision(projectId, version) {
    return makeRequest(`/projects/${projectId}/revisions/${version}`);
}

export function getAssets(projectId, version) {
    return makeRequest(`/projects/${projectId}/revisions/${version}/assets`);
}

export async function getUser(username) {
    return makeRequest(`/users/${username}`);
}

// --- Helper Utilities for Builder ---

export function parseProjectIdentifier(input) {
    if (!input) return null;
    
    // 1. Try to parse as a URL
    try {
        const url = new URL(input.startsWith('http') ? input : `https://${input}`);
        const pathname = url.pathname;

        // https://websim.com/p/PROJECT_ID...
        const projectMatch = pathname.match(/^\/p\/([a-z0-9_-]{20})/);
        if (projectMatch) {
            return { type: 'id', value: projectMatch[1] };
        }

        // https://websim.com/@USERNAME/SLUG...
        const slugMatch = pathname.match(/^\/(@[^/]+)\/([^/]+)/);
        if (slugMatch) {
            return { type: 'slug', username: slugMatch[1].substring(1), slug: slugMatch[2] };
        }
        
        // /c/UUID (Conversation/Creation ID)
        const cMatch = pathname.match(/^\/c\/([a-z0-9_-]{20})/);
        if (cMatch) {
            return { type: 'id', value: cMatch[1] };
        }

    } catch (e) {
        // Not a valid URL, proceed to other checks
    }

    // 2. Try to parse as @username/slug
    const atSlugMatch = input.match(/^@([^/]+)\/([^/]+)/);
    if (atSlugMatch) {
        return { type: 'slug', username: atSlugMatch[1], slug: atSlugMatch[2] };
    }

    // 3. Try to parse as username/slug
    const slugMatch = input.match(/^([a-zA-Z0-9_]{3,32})\/([a-zA-Z0-9-]{3,50})$/);
    if (slugMatch) {
        return { type: 'slug', username: slugMatch[1], slug: slugMatch[2] };
    }

    // 4. Assume it's a project ID
    if (/^[a-z0-9_-]{20}$/.test(input)) {
        return { type: 'id', value: input };
    }

    throw new Error(`Invalid project identifier: "${input}".`);
}

export async function fetchProjectMetadata(identifier) {
    if (identifier.type === 'id') {
        return getProjectById(identifier.value);
    } else {
        return getProjectBySlug(identifier.username, identifier.slug);
    }
}

export async function fetchProjectAssets(projectId, version) {
    if (!version) {
        // Get current version if not specified
        const projectData = await getProjectById(projectId);
        version = projectData.project.current_version;
    }
    return getAssets(projectId, version);
}

// Converts WebSim asset list to the format expected by the generator { "path/to/file": Uint8Array }
export function processAssets(assetList) {
    const files = {};
    const encoder = new TextEncoder();

    if (!assetList || !Array.isArray(assetList)) {
        console.warn("processAssets received invalid list:", assetList);
        return files;
    }

    for (const asset of assetList) {
        if (!asset.path) continue;
        
        // Ensure path doesn't start with slash (normalize)
        // Remove all leading slashes and ./
        const path = asset.path.replace(/^(\.|\/)+/, '');
        
        let content = asset.content;
        
        if (typeof content === 'string') {
            files[path] = encoder.encode(content);
        } else if (content) {
            // If it's already structured or binary, try to stringify
            files[path] = encoder.encode(JSON.stringify(content));
        } else {
            // Handle empty content or binary placeholders
            files[path] = new Uint8Array(0);
        }
    }
    
    return files;
}

