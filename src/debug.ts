/**
 * Debug logging utility
 * Conditionally logs messages based on pi.debug configuration
 */

import * as vscode from 'vscode';

/**
 * Debug logger that respects the pi.debug configuration setting
 */
export function debug(...args: any[]): void {
    const isDebugEnabled = vscode.workspace.getConfiguration('pi').get<boolean>('debug', false);
    
    if (isDebugEnabled) {
        console.log(...args);
    }
}
