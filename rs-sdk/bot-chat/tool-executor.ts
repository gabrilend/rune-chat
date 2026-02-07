// tool-executor.ts - Tool discovery and execution for bot-chat
//
// This module provides utilities to discover tools from a directory and
// execute them following the tool protocol (--tool-info, stdin/stdout JSON).
//
// Lua port note: This mirrors the tool discovery in libs/chatbot/core/chat.lua
// The key difference is TypeScript uses child_process.spawn vs Lua's io.popen.
// For C port: fork/exec with pipe() for stdin/stdout communication.

import { spawn } from 'child_process';
import { readdir, stat, access, constants } from 'fs/promises';
import { join, basename } from 'path';
import type { ToolDefinition, ToolResult, ToolExecutor } from './ollama-client';

/**
 * Discover tools in a directory by executing each executable with --tool-info.
 * Returns an array of ToolDefinition objects for tools that respond correctly.
 *
 * Lua port note: In Lua, this uses lfs.dir() to iterate and io.popen for execution.
 * C port: opendir/readdir + fork/exec pattern.
 *
 * @param toolsDir Path to the tools directory
 * @returns Array of discovered tool definitions
 */
export async function discoverTools(toolsDir: string): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];

    try {
        const entries = await readdir(toolsDir);

        for (const entry of entries) {
            // Skip hidden files and common non-tool patterns
            if (entry.startsWith('.') || entry.startsWith('_')) {
                continue;
            }

            const toolPath = join(toolsDir, entry);

            // Check if it's executable
            try {
                const stats = await stat(toolPath);
                if (!stats.isFile()) continue;

                await access(toolPath, constants.X_OK);
            } catch {
                // Not executable or doesn't exist
                continue;
            }

            // Execute with --tool-info to get the tool definition
            try {
                const info = await getToolInfo(toolPath);
                if (info) {
                    tools.push({
                        type: 'function',
                        function: {
                            name: info.name || basename(entry),
                            description: info.description || '',
                            parameters: info.parameters || {
                                type: 'object',
                                properties: {},
                            },
                        },
                    });
                }
            } catch (err) {
                // Tool didn't respond correctly, skip it
                console.warn(`Tool discovery failed for ${entry}:`, err);
            }
        }
    } catch (err) {
        console.error(`Failed to read tools directory ${toolsDir}:`, err);
    }

    return tools;
}

/**
 * Get tool info by executing the tool with --tool-info flag.
 *
 * Lua port note: Equivalent to running `io.popen(tool_path .. " --tool-info")`.
 */
async function getToolInfo(toolPath: string): Promise<any | null> {
    return new Promise((resolve, reject) => {
        const proc = spawn(toolPath, ['--tool-info'], {
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Tool exited with code ${code}: ${stderr}`));
                return;
            }

            try {
                const info = JSON.parse(stdout.trim());
                resolve(info);
            } catch {
                reject(new Error(`Invalid JSON from tool: ${stdout}`));
            }
        });

        proc.on('error', reject);
    });
}

/**
 * Execute a tool with the given arguments.
 * Writes JSON arguments to stdin and reads JSON result from stdout.
 *
 * Lua port note: In Lua, write args to a temp file, then:
 *   local handle = io.popen(tool_path .. " < " .. tmp_file)
 *   local result = handle:read("*a")
 * C port: fork, pipe, dup2, exec pattern with read/write to pipes.
 *
 * @param toolPath Path to the tool executable
 * @param args Arguments to pass to the tool
 * @param timeout Timeout in milliseconds (default 30000)
 * @returns Tool result
 */
export async function executeTool(
    toolPath: string,
    args: Record<string, any>,
    timeout: number = 30000
): Promise<ToolResult> {
    return new Promise((resolve) => {
        const proc = spawn(toolPath, [], {
            timeout,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code !== 0 && !stdout.trim()) {
                resolve({
                    success: false,
                    error: `Tool exited with code ${code}: ${stderr || 'unknown error'}`,
                });
                return;
            }

            try {
                const result = JSON.parse(stdout.trim());
                resolve(result);
            } catch {
                resolve({
                    success: false,
                    error: `Invalid JSON from tool: ${stdout.substring(0, 200)}`,
                });
            }
        });

        proc.on('error', (err) => {
            resolve({
                success: false,
                error: `Failed to execute tool: ${err.message}`,
            });
        });

        // Write arguments to stdin
        proc.stdin.write(JSON.stringify(args));
        proc.stdin.end();
    });
}

/**
 * Create a ToolExecutor function for use with OllamaContext.
 * The executor discovers tools in the given directory and executes them by name.
 *
 * Lua port note: This is a closure factory. In Lua, return a function that
 * captures the toolsDir and tool paths in upvalues.
 *
 * @param toolsDir Path to the tools directory
 * @returns ToolExecutor function
 */
export function createToolExecutor(toolsDir: string): ToolExecutor {
    // Cache tool paths after discovery
    const toolPaths: Map<string, string> = new Map();
    let discovered = false;

    return async (name: string, args: Record<string, any>): Promise<ToolResult> => {
        // Lazy discovery on first call
        if (!discovered) {
            try {
                const entries = await readdir(toolsDir);
                for (const entry of entries) {
                    if (entry.startsWith('.') || entry.startsWith('_')) continue;
                    const toolPath = join(toolsDir, entry);
                    try {
                        const stats = await stat(toolPath);
                        if (!stats.isFile()) continue;
                        await access(toolPath, constants.X_OK);

                        // Get the tool name from --tool-info or use filename
                        const info = await getToolInfo(toolPath);
                        const toolName = info?.name || entry;
                        toolPaths.set(toolName, toolPath);
                    } catch {
                        // Skip non-executable files
                    }
                }
                discovered = true;
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to discover tools: ${err}`,
                };
            }
        }

        const toolPath = toolPaths.get(name);
        if (!toolPath) {
            return {
                success: false,
                error: `Unknown tool: ${name}`,
            };
        }

        return executeTool(toolPath, args);
    };
}

/**
 * Helper to create a ToolExecutor with pre-loaded tool definitions.
 * Useful when you've already discovered tools and want to avoid re-discovery.
 *
 * @param toolsDir Path to the tools directory
 * @param tools Pre-discovered tool definitions
 * @returns ToolExecutor function
 */
export function createToolExecutorWithTools(
    toolsDir: string,
    tools: ToolDefinition[]
): ToolExecutor {
    // Build a map of tool names to paths
    const toolPaths: Map<string, string> = new Map();
    for (const tool of tools) {
        toolPaths.set(tool.function.name, join(toolsDir, tool.function.name));
    }

    return async (name: string, args: Record<string, any>): Promise<ToolResult> => {
        const toolPath = toolPaths.get(name);
        if (!toolPath) {
            return {
                success: false,
                error: `Unknown tool: ${name}`,
            };
        }

        return executeTool(toolPath, args);
    };
}
