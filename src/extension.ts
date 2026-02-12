/**
 * Pi Language Model Provider Extension
 * Entry point with activate/deactivate lifecycle
 */

import * as vscode from 'vscode';
import { SessionPool } from './session-pool.js';
import { PiChatProvider } from './provider.js';
import type { PiConfig } from './types.js';
import { debug } from './debug.js';

let pool: SessionPool | undefined;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
    debug('Pi Language Model Provider extension activating...');

    // Load configuration
    const config = loadConfiguration();
    const maxSessions = vscode.workspace.getConfiguration('pi').get<number>('maxSessions', 20);
    const sessionIdleTimeout = vscode.workspace.getConfiguration('pi').get<number>('sessionIdleTimeout', 600);

    // Create session pool
    pool = new SessionPool(config, maxSessions, sessionIdleTimeout * 1000);

    // Create provider
    const provider = new PiChatProvider(pool);

    // Register language model chat provider
    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider('pi', provider)
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('pi')) {
                const newConfig = loadConfiguration();
                const newMaxSessions = vscode.workspace.getConfiguration('pi').get<number>('maxSessions', 20);
                const newIdleTimeout = vscode.workspace.getConfiguration('pi').get<number>('sessionIdleTimeout', 600);
                
                // Dispose old pool and create new one
                if (pool) {
                    await pool.dispose();
                }
                pool = new SessionPool(newConfig, newMaxSessions, newIdleTimeout * 1000);
                
                vscode.window.showInformationMessage(
                    'Pi configuration updated. New sessions will use updated settings.'
                );
            }
        })
    );

    // Add pool to subscriptions for cleanup
    // Note: subscriptions don't await async, so we rely on deactivate() for proper cleanup
    context.subscriptions.push({
        dispose: () => {
            // Fire-and-forget cleanup as fallback
            pool?.dispose().catch(console.error);
        }
    });

    debug('Pi Language Model Provider extension activated');
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
    debug('Pi Language Model Provider extension deactivating...');
    
    if (pool) {
        await pool.dispose();
    }
    
    debug('Pi Language Model Provider extension deactivated');
}

/**
 * Load configuration from VS Code settings
 */
function loadConfiguration(): PiConfig {
    const config = vscode.workspace.getConfiguration('pi');

    return {
        binaryPath: config.get<string>('binaryPath') || 'pi',
        workingDirectory: config.get<string>('workingDirectory') || '',
        autoRestart: config.get<boolean>('autoRestart') ?? true,
        maxRestartAttempts: config.get<number>('maxRestartAttempts') ?? 3,
        additionalArgs: config.get<string[]>('additionalArgs') || [],
    };
}
