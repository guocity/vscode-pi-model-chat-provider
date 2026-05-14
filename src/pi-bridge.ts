/**
 * Pi Bridge - RPC client wrapper with VS Code lifecycle integration
 */

import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import type { PiConfig, SendPromptOptions } from './types.js';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { getOutputChannel, debug } from './debug.js';

interface RpcResponse {
    type: 'response';
    id: string;
    command?: string;
    success?: boolean;
    data?: unknown;
    error?: string;
}

// Type guard for RpcResponse
function isRpcResponse(msg: any): msg is RpcResponse {
    return msg && typeof msg === 'object' && msg.type === 'response' && typeof msg.id === 'string';
}

export class PiBridge {
    private process: ChildProcess | null = null;
    private rl: readline.Interface | null = null;
    private eventListeners: Array<(event: AgentEvent) => void> = [];
    private pendingRequests = new Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }>();
    private requestId = 0;
    private outputChannel: vscode.OutputChannel;
    private restartAttempts = 0;
    private isShuttingDown = false;
    private stderr = '';
    private currentModelKey: string | null = null;  // `${provider}/${modelId}` last set on this process

    constructor(private config: PiConfig) {
        // Shared channel — every bridge logs to the same "Pi Agent" output.
        this.outputChannel = getOutputChannel();
    }

    /**
     * Ensure the Pi RPC process is started
     */
    async ensureStarted(): Promise<void> {
        if (this.process) {
            return;
        }

        this.outputChannel.appendLine('Starting Pi agent...');

        try {
            const workingDir = this.config.workingDirectory || 
                               vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 
                               process.cwd();

            const args = ['--mode', 'rpc', '--no-session', ...this.config.additionalArgs];

            this.process = spawn(this.config.binaryPath, args, {
                cwd: workingDir,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            // Collect stderr for debugging
            this.process.stderr?.on('data', (data) => {
                this.stderr += data.toString();
            });

            // Set up line reader for stdout
            this.rl = readline.createInterface({
                input: this.process.stdout!,
                terminal: false,
            });

            this.rl.on('line', (line) => {
                this.handleLine(line);
            });

            // Wait a moment for process to initialize
            await new Promise((resolve) => setTimeout(resolve, 100));

            if (this.process.exitCode !== null) {
                throw new Error(`Agent process exited immediately with code ${this.process.exitCode}. Stderr: ${this.stderr}`);
            }

            this.outputChannel.appendLine('Pi agent started successfully');
            this.restartAttempts = 0;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to start Pi agent: ${errorMessage}`);
            
            if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
                throw new Error(
                    `Pi CLI not found at "${this.config.binaryPath}". ` +
                    `Please install Pi from https://github.com/badlogic/pi-mono or configure 'pi.binaryPath' setting.`
                );
            }
            
            throw error;
        }
    }

    /**
     * Handle a line of JSON output from the RPC process
     */
    private handleLine(line: string): void {
        if (!line.trim()) {
            return;
        }

        try {
            const msg = JSON.parse(line);

            // Handle responses to commands
            if (isRpcResponse(msg)) {
                this.outputChannel.appendLine(`[RPC Recv] ${line}`);
                const pending = this.pendingRequests.get(msg.id);
                if (pending) {
                    this.pendingRequests.delete(msg.id);
                    if (msg.error) {
                        this.outputChannel.appendLine(`[RPC Response] Error: ${msg.error}`);
                        this.outputChannel.appendLine(`[RPC Response] Full response: ${JSON.stringify(msg)}`);
                        pending.reject(new Error(msg.error));
                    } else {
                        this.outputChannel.appendLine(`[RPC Response] Success: ${JSON.stringify(msg.data)}`);
                        pending.resolve(msg.data as any);
                    }
                }
                return;
            }

            // Extension UI requests: the agent blocks on confirm/select/input/
            // editor until the client replies, so handle them here instead of
            // forwarding them as events.
            if (msg && typeof msg === 'object' && msg.type === 'extension_ui_request') {
                this.handleExtensionUIRequest(msg);
                return;
            }

            // Handle events (AgentEvent) - anything that's not a response.
            // The channel is user-facing, so keep the always-on trace readable
            // (just the type); the full payload goes behind the debug flag.
            if (msg && typeof msg === 'object' && 'type' in msg) {
                const event = msg as AgentEvent;
                this.outputChannel.appendLine(`[RPC Event] ${event.type}`);
                debug(`[RPC Event] ${line}`);
                for (const listener of this.eventListeners) {
                    listener(event);
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Failed to parse RPC message: ${line}`);
            this.outputChannel.appendLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle an extension UI request so the agent never blocks waiting on a
     * dialog.
     *
     * - confirm: surfaced as a real modal Allow/Deny dialog - the agent is
     *   genuinely blocked, so the user must decide (e.g. running a command).
     * - select/input/editor: cancelled (we have no meaningful value to supply,
     *   equivalent to the user dismissing the dialog).
     * - notify/setStatus/setWidget/setTitle/set_editor_text: fire-and-forget,
     *   no response expected.
     */
    private handleExtensionUIRequest(request: {
        id: string;
        method: string;
        title?: string;
        message?: string;
    }): void {
        const { id, method } = request;
        this.outputChannel.appendLine(`[RPC Event] extension_ui_request (${method})`);

        if (method === 'confirm') {
            void this.promptConfirm(request);
            return;
        }

        if (method === 'select' || method === 'input' || method === 'editor') {
            this.sendExtensionUIResponse({ type: 'extension_ui_response', id, cancelled: true });
        }
        // Everything else is a fire-and-forget UI update - no response expected.
    }

    /**
     * Show a modal Allow/Deny dialog for a `confirm` request and reply with the
     * user's choice. Dismissing the dialog counts as Deny.
     */
    private async promptConfirm(request: {
        id: string;
        title?: string;
        message?: string;
    }): Promise<void> {
        const choice = await vscode.window.showWarningMessage(
            request.title || 'Pi agent wants to perform an action',
            { modal: true, detail: request.message },
            'Allow',
            'Deny'
        );
        this.sendExtensionUIResponse({
            type: 'extension_ui_response',
            id: request.id,
            confirmed: choice === 'Allow'
        });
    }

    /**
     * Write an extension UI response back to the agent over stdin.
     */
    private sendExtensionUIResponse(response: Record<string, unknown>): void {
        const payload = JSON.stringify(response) + '\n';
        this.outputChannel.appendLine(`[RPC Send] ${payload.trim()}`);
        this.process?.stdin?.write(payload);
    }

    /**
     * Send a command to the RPC process and wait for response
     */
    private async send<T = any>(command: string, params: any = {}): Promise<T> {
        await this.ensureStarted();

        if (!this.process || !this.process.stdin) {
            throw new Error('Pi agent process not available');
        }

        const requestId = `req_${this.requestId++}`;
        const message = JSON.stringify({ type: command, id: requestId, ...params }) + '\n';
        
        this.outputChannel.appendLine(`[RPC Send] ${message.trim()}`);

        return new Promise<T>((resolve, reject) => {
            // Timeout after 30 seconds
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`RPC command "${command}" timed out after 30 seconds`));
            }, 30000);

            // Store promise handlers with timeout cleanup
            this.pendingRequests.set(requestId, {
                resolve: (value: any) => {
                    clearTimeout(timeout);
                    resolve(value);
                },
                reject: (error: any) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });

            this.process!.stdin!.write(message);
        });
    }

    /**
     * Subscribe to agent events
     */
    private onEvent(handler: (event: AgentEvent) => void): () => void {
        this.eventListeners.push(handler);
        return () => {
            const index = this.eventListeners.indexOf(handler);
            if (index !== -1) {
                this.eventListeners.splice(index, 1);
            }
        };
    }

    /**
     * Send a prompt to Pi with streaming event handling
     */
    async sendPrompt(options: SendPromptOptions): Promise<void> {
        await this.ensureStarted();

        // Set the model - but only when it actually changed. The model is a
        // process-level setting that survives across turns, so re-sending it
        // every turn is a wasted RPC round-trip on the hot path.
        const modelKey = `${options.model.provider}/${options.model.modelId}`;
        if (this.currentModelKey !== modelKey) {
            try {
                const setModelCmd = {
                    provider: options.model.provider,
                    modelId: options.model.modelId,
                };
                this.outputChannel.appendLine(`[sendPrompt] Sending set_model command: ${JSON.stringify(setModelCmd)}`);
                await this.send('set_model', setModelCmd);
                this.currentModelKey = modelKey;
                this.outputChannel.appendLine(`[sendPrompt] Model set successfully`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`Failed to set model: ${errorMessage}`);
                throw new Error(`Model ${modelKey} not available. ${errorMessage}`);
            }
        }

        // Subscribe to events
        const unsubscribe = this.onEvent(options.onEvent);

        // Handle cancellation - need to track if cancelled for promise rejection
        let isCancelled = false;
        const cancellationListener = options.token.onCancellationRequested(() => {
            this.outputChannel.appendLine('Request cancelled, aborting...');
            isCancelled = true;
            this.send('abort').catch((err: unknown) => {
                this.outputChannel.appendLine(`Error aborting: ${err}`);
            });
        });

        try {
            // Create a promise that resolves when agent_end is received
            let completionUnsubscribe: (() => void) | null = null;
            let completionTimeout: NodeJS.Timeout | null = null;
            
            const completionPromise = new Promise<void>((resolve, reject) => {
                let completed = false;
                
                const completionHandler = (event: AgentEvent) => {
                    if (event.type === 'agent_end') {
                        completed = true;
                        if (completionTimeout) clearTimeout(completionTimeout);
                        if (completionUnsubscribe) completionUnsubscribe();
                        
                        // Check if operation was cancelled
                        if (isCancelled) {
                            reject(new Error('Operation cancelled by user'));
                        } else {
                            resolve();
                        }
                    }
                };
                
                // Subscribe to agent_end event
                completionUnsubscribe = this.onEvent(completionHandler);
                
                // Timeout after 2 minutes
                completionTimeout = setTimeout(() => {
                    if (!completed) {
                        if (completionUnsubscribe) completionUnsubscribe();
                        reject(new Error('Agent response timed out after 2 minutes'));
                    }
                }, 120000);
            });
            
            // Send the prompt
            await this.send('prompt', { message: options.prompt });
            this.outputChannel.appendLine(`[sendPrompt] Prompt sent, waiting for completion...`);
            
            // Wait for agent_end event
            await completionPromise;
            this.outputChannel.appendLine(`[sendPrompt] Agent completed`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Error during prompt: ${errorMessage}`);
            
            // Log stderr for debugging
            if (this.stderr) {
                this.outputChannel.appendLine(`Pi stderr: ${this.stderr}`);
            }
            
            // Attempt restart on crash if enabled
            if (this.config.autoRestart && !this.isShuttingDown) {
                await this.handleCrash();
            }
            
            throw error;
        } finally {
            unsubscribe();
            cancellationListener.dispose();
        }
    }

    /**
     * Start a new session (reset conversation context)
     */
    async newSession(): Promise<void> {
        await this.ensureStarted();
        try {
            await this.send('new_session');
            this.outputChannel.appendLine('[PiBridge] Started new session');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to start new session: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Get session statistics (token usage, cost)
     */
    async getSessionStats(): Promise<any> {
        await this.ensureStarted();
        try {
            const response = await this.send('get_session_stats');
            this.outputChannel.appendLine(`get_session_stats response: ${JSON.stringify(response)}`);
            return response || {};
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to get session stats: ${errorMessage}`);
            return {};
        }
    }

    /**
     * Get session state (model, settings, streaming status)
     */
    async getState(): Promise<any> {
        await this.ensureStarted();
        try {
            const response = await this.send('get_state');
            this.outputChannel.appendLine(`get_state response: ${JSON.stringify(response)}`);
            return response || {};
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to get state: ${errorMessage}`);
            return {};
        }
    }

    /**
     * Get the text of the last assistant message. This is the model-agnostic
     * way to retrieve a turn's answer - it does not depend on how a particular
     * model structures its streamed content blocks.
     */
    async getLastAssistantText(): Promise<string | null> {
        await this.ensureStarted();
        try {
            const response = await this.send('get_last_assistant_text');
            const text = response && typeof response === 'object'
                ? (response as { text?: string | null }).text ?? null
                : null;
            this.outputChannel.appendLine(
                `[getLastAssistantText] ${text ? `${text.length} chars` : 'null'}`
            );
            return text;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to get last assistant text: ${errorMessage}`);
            return null;
        }
    }

    /**
     * Get available models from Pi
     */
    async getAvailableModels(): Promise<any[]> {
        await this.ensureStarted();
        try {
            const response = await this.send('get_available_models');
            this.outputChannel.appendLine(`get_available_models response: ${JSON.stringify(response)}`);
            
            // Response format: { models: [...] }
            if (response && typeof response === 'object' && 'models' in response) {
                return (response as any).models || [];
            }
            
            // If response is already an array, return it
            if (Array.isArray(response)) {
                return response;
            }
            
            this.outputChannel.appendLine(`Unexpected response format: ${JSON.stringify(response)}`);
            return [];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`Failed to get available models: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Handle client crash with restart logic
     */
    private async handleCrash(): Promise<void> {
        if (this.restartAttempts >= this.config.maxRestartAttempts) {
            this.outputChannel.appendLine(
                `Max restart attempts (${this.config.maxRestartAttempts}) reached. Giving up.`
            );
            await this.cleanup();
            return;
        }

        this.restartAttempts++;
        const backoffMs = Math.pow(2, this.restartAttempts - 1) * 1000; // 1s, 2s, 4s...

        this.outputChannel.appendLine(
            `Attempting restart ${this.restartAttempts}/${this.config.maxRestartAttempts} after ${backoffMs}ms...`
        );

        // Clean up crashed process
        await this.cleanup();

        // Wait before restarting
        await new Promise(resolve => setTimeout(resolve, backoffMs));

        // Restart will happen on next ensureStarted() call
    }

    /**
     * Clean up process resources
     */
    private async cleanup(): Promise<void> {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }

        if (this.process) {
            // Try graceful shutdown first
            this.process.kill('SIGTERM');
            
            // Wait a bit for graceful shutdown
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Force kill if still running
            if (!this.process.killed) {
                this.process.kill('SIGKILL');
            }
            
            this.process = null;
        }

        this.pendingRequests.clear();
        this.eventListeners = [];
        this.stderr = '';
        this.currentModelKey = null;  // process is gone; the model must be re-set
    }

    /**
     * Restart the Pi process
     */
    async restart(): Promise<void> {
        this.outputChannel.appendLine('Restarting Pi agent...');
        await this.shutdown();
        await this.ensureStarted();
    }

    /**
     * Shutdown the Pi process
     */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;

        if (this.process) {
            this.outputChannel.appendLine('Stopping Pi agent...');
            try {
                // Send stop command if process is still running
                if (this.process.stdin) {
                    await this.send('stop').catch(() => {
                        // Ignore errors if process is already dead
                    });
                }
                await this.cleanup();
                this.outputChannel.appendLine('Pi agent stopped');
            } catch (error) {
                this.outputChannel.appendLine(`Error stopping Pi agent: ${error}`);
                await this.cleanup();
            }
        }

        this.isShuttingDown = false;
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.shutdown().catch(() => {
            // Ignore errors during disposal
        });
        // outputChannel is shared across bridges — do not dispose it here.
    }
}
