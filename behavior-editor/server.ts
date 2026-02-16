#!/usr/bin/env bun
// server.ts - Behavior Editor HTTP server
//
// Serves the visual editor UI and provides REST API for profile CRUD.
// Uses Bun.serve() following the same pattern as gateway.ts.

import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import type { BehaviorProfile, BehaviorInfo } from './types';
import { INTERRUPT_PRIORITIES } from '../rs-sdk/bot-core/task-manager';

const EDITOR_PORT = parseInt(process.env.EDITOR_PORT || '3000');
const PROFILES_DIR = join(import.meta.dir, 'profiles');
const PUBLIC_DIR = join(import.meta.dir, 'public');
const GENERATED_DIR = join(import.meta.dir, '../rs-sdk/behaviors/generated');
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:7780';

// Ensure directories exist
await mkdir(PROFILES_DIR, { recursive: true });
await mkdir(GENERATED_DIR, { recursive: true });

// Available behaviors with their params (from the 5 built-in behaviors)
const AVAILABLE_BEHAVIORS: BehaviorInfo[] = [
    {
        name: 'idle',
        description: 'Do nothing, wait for something to happen',
        params: [
            { name: 'maxTicks', type: 'number', default: 100, description: 'How long to idle (~0.42s per tick)', portType: 'number' },
        ],
    },
    {
        name: 'wander',
        description: 'Walk around randomly, exploring the area',
        params: [
            { name: 'maxMoves', type: 'number', default: 5, description: 'Number of random walks before completing', portType: 'number' },
            { name: 'wanderRadius', type: 'number', default: 5, description: 'How far to wander in tiles', portType: 'number' },
        ],
    },
    {
        name: 'follower',
        description: 'Follow another player using leash mechanics',
        params: [
            { name: 'targetName', type: 'string', default: '', description: 'Name of the player to follow', portType: 'player' },
            { name: 'leashRange', type: 'number', default: 8, description: 'Start following when target is further than this', portType: 'number' },
            { name: 'comfortRange', type: 'number', default: 3, description: 'Stop following when within this range', portType: 'number' },
            { name: 'lostRange', type: 'number', default: 50, description: 'Give up if target is further than this', portType: 'number' },
        ],
    },
    {
        name: 'social',
        description: 'Be social and chat with nearby players',
        params: [
            { name: 'maxTicks', type: 'number', default: 500, description: 'How long to stay in social mode (~0.42s per tick)', portType: 'number' },
        ],
    },
    {
        name: 'wow-chat',
        description: 'Handle periodic NPC encounters: fight hostiles, chat with travellers',
        params: [
            { name: 'respondToHostiles', type: 'boolean', default: true, description: 'Whether to auto-attack hostile NPCs' },
        ],
    },
];

// MIME types for static file serving
const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: any, status = 200): Response {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
}

function errorResponse(message: string, status = 400): Response {
    return jsonResponse({ error: message }, status);
}

async function serveStaticFile(filePath: string): Promise<Response> {
    try {
        const file = Bun.file(filePath);
        if (!(await file.exists())) return new Response('Not found', { status: 404 });
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        return new Response(file, {
            headers: { 'Content-Type': contentType, ...CORS_HEADERS },
        });
    } catch {
        return new Response('Not found', { status: 404 });
    }
}

// Profile CRUD helpers
async function listProfiles(): Promise<Array<{ id: string; name: string; description: string; updatedAt: string }>> {
    try {
        const files = await readdir(PROFILES_DIR);
        const profiles = [];
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            try {
                const raw = await readFile(join(PROFILES_DIR, file), 'utf-8');
                const profile: BehaviorProfile = JSON.parse(raw);
                profiles.push({
                    id: profile.id,
                    name: profile.name,
                    description: profile.description,
                    updatedAt: profile.updatedAt,
                });
            } catch { /* skip malformed files */ }
        }
        return profiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
        return [];
    }
}

async function readProfile(id: string): Promise<BehaviorProfile | null> {
    try {
        const raw = await readFile(join(PROFILES_DIR, `${id}.json`), 'utf-8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function writeProfile(profile: BehaviorProfile): Promise<void> {
    await writeFile(
        join(PROFILES_DIR, `${profile.id}.json`),
        JSON.stringify(profile, null, 2),
    );
}

async function deleteProfile(id: string): Promise<boolean> {
    try {
        await unlink(join(PROFILES_DIR, `${id}.json`));
        return true;
    } catch {
        return false;
    }
}

// Code generation
async function compileProfile(profile: BehaviorProfile): Promise<string> {
    const { generateProfileCode } = await import('./codegen');
    const code = generateProfileCode(profile);
    const fileName = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    const outPath = join(GENERATED_DIR, `${fileName}.ts`);
    await writeFile(outPath, code);
    return code;
}

// ============ Server ============

console.log(`[BehaviorEditor] Starting on port ${EDITOR_PORT}...`);

const server = Bun.serve({
    port: EDITOR_PORT,

    async fetch(req) {
        const url = new URL(req.url);

        // CORS preflight
        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        // ---- API Routes ----

        // GET /api/behaviors - list available behaviors
        if (url.pathname === '/api/behaviors' && req.method === 'GET') {
            return jsonResponse(AVAILABLE_BEHAVIORS);
        }

        // GET /api/interrupts - list interrupt types with priorities
        if (url.pathname === '/api/interrupts' && req.method === 'GET') {
            return jsonResponse(INTERRUPT_PRIORITIES);
        }

        // GET /api/profiles - list profiles
        if (url.pathname === '/api/profiles' && req.method === 'GET') {
            return jsonResponse(await listProfiles());
        }

        // POST /api/profiles - create new profile
        if (url.pathname === '/api/profiles' && req.method === 'POST') {
            const body = await req.json().catch(() => null);
            const now = new Date().toISOString();
            const id = crypto.randomUUID();
            const profile: BehaviorProfile = {
                id,
                name: body?.name || 'Untitled Profile',
                description: body?.description || '',
                version: 1,
                createdAt: now,
                updatedAt: now,
                initialStateId: '',
                states: [],
                transitions: [],
                editorMeta: { canvasOffsetX: 0, canvasOffsetY: 0, zoom: 1 },
                ...(body || {}),
                // Force these fields
            };
            profile.id = id;
            profile.createdAt = now;
            profile.updatedAt = now;
            profile.version = 1;
            await writeProfile(profile);
            return jsonResponse(profile, 201);
        }

        // Profile-specific routes: /api/profiles/:id
        const profileMatch = url.pathname.match(/^\/api\/profiles\/([a-f0-9-]+)$/);
        if (profileMatch) {
            const id = profileMatch[1];

            // GET /api/profiles/:id
            if (req.method === 'GET') {
                const profile = await readProfile(id);
                if (!profile) return errorResponse('Profile not found', 404);
                return jsonResponse(profile);
            }

            // PUT /api/profiles/:id
            if (req.method === 'PUT') {
                const body = await req.json().catch(() => null);
                if (!body) return errorResponse('Invalid JSON body');
                const existing = await readProfile(id);
                if (!existing) return errorResponse('Profile not found', 404);
                const updated: BehaviorProfile = {
                    ...existing,
                    ...body,
                    id, // Cannot change ID
                    updatedAt: new Date().toISOString(),
                    version: 1,
                };
                await writeProfile(updated);
                return jsonResponse(updated);
            }

            // DELETE /api/profiles/:id
            if (req.method === 'DELETE') {
                const deleted = await deleteProfile(id);
                if (!deleted) return errorResponse('Profile not found', 404);
                return jsonResponse({ success: true });
            }
        }

        // POST /api/profiles/:id/compile
        const compileMatch = url.pathname.match(/^\/api\/profiles\/([a-f0-9-]+)\/compile$/);
        if (compileMatch && req.method === 'POST') {
            const id = compileMatch[1];
            const profile = await readProfile(id);
            if (!profile) return errorResponse('Profile not found', 404);
            try {
                const code = await compileProfile(profile);
                return jsonResponse({ success: true, code });
            } catch (e: any) {
                return errorResponse(`Compilation failed: ${e.message}`, 500);
            }
        }

        // GET /api/bots - proxy to gateway for connected bots
        if (url.pathname === '/api/bots' && req.method === 'GET') {
            try {
                const res = await fetch(`${GATEWAY_URL}/status`);
                const data = await res.json();
                return jsonResponse(data);
            } catch {
                return jsonResponse({ status: 'gateway_unreachable', bots: {} });
            }
        }

        // POST /api/bots/:username/activate - activate a profile on a bot
        const activateMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/activate$/);
        if (activateMatch && req.method === 'POST') {
            const username = decodeURIComponent(activateMatch[1]);
            const body = await req.json().catch(() => null);
            if (!body?.profileId) return errorResponse('profileId required');
            const profile = await readProfile(body.profileId);
            if (!profile) return errorResponse('Profile not found', 404);
            try {
                const botDir = join(import.meta.dir, '..', 'rs-sdk', 'bots', username);
                await mkdir(botDir, { recursive: true });
                await writeFile(
                    join(botDir, 'active-profile.json'),
                    JSON.stringify(profile, null, 2),
                );
                return jsonResponse({ success: true, username, profileId: profile.id });
            } catch (e: any) {
                return errorResponse(`Failed to activate: ${e.message}`, 500);
            }
        }

        // ---- Static Files ----
        let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
        return serveStaticFile(join(PUBLIC_DIR, filePath));
    },
});

console.log(`[BehaviorEditor] Editor running at http://localhost:${EDITOR_PORT}`);
console.log(`[BehaviorEditor] Gateway proxy: ${GATEWAY_URL}`);
