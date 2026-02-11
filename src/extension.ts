/**
 * Pi Language Model Provider Extension
 * Entry point with activate/deactivate lifecycle
 */

import * as vscode from 'vscode';
import { PiBridge } from './pi-bridge.js';
import { PiChatProvider } from './provider.js';
import type { PiConfig } from './types.js';

let bridge: PiBridge | undefined;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('Pi Language Model Provider extension activating...');

    // Load configuration
    const config = loadConfiguration();

    // Create Pi bridge
    bridge = new PiBridge(config);

    // Create provider
    const provider = new PiChatProvider(bridge);

    // Register language model chat provider
    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider('pi', provider)
    );

    // Register configuration command
    context.subscriptions.push(
        vscode.commands.registerCommand('pi.configure', async () => {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'pi'
            );
        })
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('pi')) {
                const newConfig = loadConfiguration();
                
                // Restart bridge with new configuration
                if (bridge) {
                    await bridge.shutdown();
                }
                bridge = new PiBridge(newConfig);
                
                vscode.window.showInformationMessage(
                    'Pi configuration updated. Agent will restart on next request.'
                );
            }
        })
    );

    // Add bridge to subscriptions for cleanup
    context.subscriptions.push({
        dispose: () => bridge?.dispose()
    });

    console.log('Pi Language Model Provider extension activated');
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
    console.log('Pi Language Model Provider extension deactivating...');
    
    if (bridge) {
        await bridge.shutdown();
    }
    
    console.log('Pi Language Model Provider extension deactivated');
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
        toolCallDisplay: config.get<'text' | 'hidden'>('toolCallDisplay') || 'text',
    };
}
