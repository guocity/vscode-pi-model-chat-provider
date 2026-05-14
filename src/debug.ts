/**
 * Debug logging utility
 * Conditionally logs messages based on pi.debug configuration
 */

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/**
 * Shared "Pi Agent" output channel. All logging (RPC traffic and debug
 * output) goes here so users have a single place to inspect.
 */
export function getOutputChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('Pi Agent');
    }
    return channel;
}

/**
 * Debug logger that respects the pi.debug configuration setting.
 * Writes to the shared "Pi Agent" output channel.
 */
export function debug(...args: any[]): void {
    const isDebugEnabled = vscode.workspace.getConfiguration('pi').get<boolean>('debug', false);

    if (isDebugEnabled) {
        const msg = args
            .map(a => {
                if (typeof a === 'string') {
                    return a;
                }
                try {
                    return JSON.stringify(a);
                } catch {
                    return String(a);
                }
            })
            .join(' ');
        getOutputChannel().appendLine(`[debug] ${msg}`);
    }
}
