// WebSim API Integration
const API_BASE = 'https://websim.ai/api/v1';

async function makeRequest(endpoint, options = {}) {
    try {
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
    } catch (e) {
        console.error("WebSim API Error:", e);
        throw e;
    }
}

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
        
        // /c/UUID (Conversation/Creation ID) - Handle as project ID often works or needs redirect
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

    // 3. Assume it's a project ID
    if (/^[a-z0-9_-]{20}$/.test(input)) {
        return { type: 'id', value: input };
    }

    throw new Error(`Invalid project identifier: "${input}".`);
}

export async function fetchProjectMetadata(identifier) {
    if (identifier.type === 'id') {
        return makeRequest(`/projects/${identifier.value}`);
    } else {
        return makeRequest(`/users/${identifier.username}/slugs/${identifier.slug}`);
    }
}

export async function fetchProjectAssets(projectId, version) {
    if (!version) {
        // Get current version if not specified
        const projectData = await makeRequest(`/projects/${projectId}`);
        version = projectData.project.current_version;
    }
    return makeRequest(`/projects/${projectId}/revisions/${version}/assets`);
}

// Converts WebSim asset list to the format expected by the generator { "path/to/file": Uint8Array }
export function processAssets(assetList) {
    const files = {};
    const encoder = new TextEncoder();

    for (const asset of assetList) {
        // Ensure path doesn't start with slash
        const path = asset.path.startsWith('/') ? asset.path.substring(1) : asset.path;
        
        // Handle content
        // WebSim API typically returns content as string for text files.
        // For binary/images, this implementation assumes text or checks type.
        // Real WebSim API for assets often returns text content for code files.
        
        let content = asset.content;
        
        if (typeof content === 'string') {
            files[path] = encoder.encode(content);
        } else {
            // If it's already structured or binary (unlikely in this specific API endpoint variant, but possible)
            // We'll treat as string
            files[path] = encoder.encode(JSON.stringify(content));
        }
    }
    
    return files;
}

