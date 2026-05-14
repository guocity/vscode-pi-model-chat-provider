/**
 * Shared types for Pi Language Model Provider extension
 */

import type { CancellationToken } from 'vscode';
import type { AgentEvent } from '@earendil-works/pi-agent-core';

/**
 * Configuration for Pi agent
 */
export interface PiConfig {
    binaryPath: string;
    workingDirectory: string;
    autoRestart: boolean;
    maxRestartAttempts: number;
    additionalArgs: string[];
}

/**
 * Model identifier parsed from VS Code model ID
 */
export interface ParsedModelId {
    provider: string;
    modelId: string;
}

/**
 * Event handler for Pi RPC events
 */
export type PiEventHandler = (event: AgentEvent) => void;

/**
 * Options for sending a prompt to Pi
 */
export interface SendPromptOptions {
    prompt: string;
    model: ParsedModelId;
    onEvent: PiEventHandler;
    token: CancellationToken;
}
