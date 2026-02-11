/**
 * Pi Chat Provider - VS Code Language Model Chat Provider implementation
 */

import * as vscode from 'vscode';
import type { PiBridge } from './pi-bridge.js';
import { extractLastUserMessage } from './message-converter.js';
import type { AgentEvent } from '@mariozechner/pi-agent-core';

export class PiChatProvider implements vscode.LanguageModelChatProvider {
    // Store mapping of model ID -> provider for lookup
    private modelProviderMap = new Map<string, string>();

    constructor(
        private bridge: PiBridge
    ) {}

    /**
     * Provide information about available models
     */
    async provideLanguageModelChatInformation(
        _options: vscode.PrepareLanguageModelChatModelOptions,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelChatInformation[]> {
        try {
            const models = await this.bridge.getAvailableModels();
            
            // Safety check
            if (!models || !Array.isArray(models)) {
                console.error('getAvailableModels returned invalid data:', models);
                return [];
            }

            return models.map((model: { id: string; provider: string; contextWindow: number }) => {
                // Use colon separator to avoid conflicts with dashes in provider names
                // Format: "provider:model-id" (e.g., "github-copilot:grok-code-fast-1")
                const modelId = `${model.provider}:${model.id}`;
                
                // Store provider mapping for later lookup
                this.modelProviderMap.set(modelId, model.provider);
                
                // Extract family name (e.g., "claude-sonnet-4-20250514" -> "claude-sonnet-4")
                const family = model.id.split('-').slice(0, -1).join('-') || model.id;

                const modelInfo = {
                    id: modelId,
                    name: `pi/ ${model.provider}/${model.id}`,
                    family,
                    version: model.id,
                    maxInputTokens: model.contextWindow,
                    maxOutputTokens: 16384,
                    tooltip: 'Pi Coding Agent with tool-calling capabilities',
                    detail: `Autonomous agent using ${model.provider} models`,
                    capabilities: {
                        toolCalling: true  // Pi supports tool execution (bash, file ops, etc.)
                    }
                } satisfies vscode.LanguageModelChatInformation;

                console.log('[Pi Provider] Registering model:', { id: modelId, provider: model.provider, modelId: model.id });
                return modelInfo;
            });
        } catch (error) {
            // Return empty array on error - VS Code will handle gracefully
            console.error('Failed to get Pi models:', error);
            return [];
        }
    }

    /**
     * Provide streaming chat response
     */
    async provideLanguageModelChatResponse(
        model: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        _options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Debug logging
        console.log('[Pi Provider] ========================================');
        console.log('[Pi Provider] Received request for model:', {
            id: model.id,
            name: model.name,
            family: model.family,
            vendor: (model as any).vendor  // Check if vendor property exists
        });
        
        // Parse the model ID flexibly
        // VS Code may send: "pi/provider:model-id" or just "provider:model-id"
        let modelId = model.id;
        
        // Strip vendor prefix if present
        if (modelId.includes('/')) {
            const parts = modelId.split('/');
            modelId = parts.slice(1).join('/');
            console.log('[Pi Provider] Stripped vendor prefix, model ID:', modelId);
        }
        
        // Look up provider from our map (we stored it during registration)
        const provider = this.modelProviderMap.get(modelId);
        if (!provider) {
            console.error('[Pi Provider] Model ID not found in map:', modelId);
            console.error('[Pi Provider] Available models:', Array.from(this.modelProviderMap.keys()));
            throw new Error(
                `Unknown model: "${modelId}". ` +
                `This model was not registered by the Pi provider. ` +
                `Available Pi models: ${Array.from(this.modelProviderMap.keys()).join(', ')}`
            );
        }
        
        // Extract the actual model ID (after the colon)
        const colonIndex = modelId.indexOf(':');
        if (colonIndex === -1) {
            console.error('[Pi Provider] Model ID has no colon separator:', modelId);
            throw new Error(`Invalid model ID format: "${modelId}". Expected "provider:model-id".`);
        }
        
        const parsedModel = {
            provider: provider,
            modelId: modelId.substring(colonIndex + 1)
        };
        console.log('[Pi Provider] Parsed model:', parsedModel);

        // Extract prompt from message history
        const prompt = extractLastUserMessage(messages);

        // Event handler for streaming
        const onEvent = (event: AgentEvent) => {
            this.handleEvent(event, progress);
        };

        // Send prompt and stream response
        await this.bridge.sendPrompt({
            prompt,
            model: parsedModel,
            onEvent,
            token
        });
    }

    /**
     * Provide token count estimation
     */
    async provideTokenCount(
        _model: vscode.LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatRequestMessage,
        _token: vscode.CancellationToken
    ): Promise<number> {
        const content = typeof text === 'string' 
            ? text 
            : this.extractTextFromMessage(text);

        // Heuristic: ~4 characters per token
        return Math.ceil(content.length / 4);
    }

    /**
     * Handle Pi events and map to VS Code progress reports
     */
    private handleEvent(
        event: AgentEvent,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>
    ): void {
        console.log('[Pi Provider] Event received:', event.type, event);
        
        if (event.type === 'message_update') {
            const { assistantMessageEvent } = event;
            console.log('[Pi Provider] assistantMessageEvent:', assistantMessageEvent);

            // Stream text deltas
            if (assistantMessageEvent.type === 'text_delta') {
                console.log('[Pi Provider] Text delta:', assistantMessageEvent.delta);
                progress.report(
                    new vscode.LanguageModelTextPart(assistantMessageEvent.delta)
                );
            }

            // Optionally stream thinking (if enabled in future)
            // if (assistantMessageEvent.type === 'thinking_delta') {
            //     progress.report(
            //         new vscode.LanguageModelTextPart(`[Thinking: ${assistantMessageEvent.delta}]`)
            //     );
            // }
        }

        // Display tool calls using VS Code's native tool visualization
        if (event.type === 'tool_execution_start') {
            console.log('[Pi Provider] Tool execution start:', event.toolName, event.args);
            progress.report(
                new vscode.LanguageModelToolCallPart(
                    event.toolCallId,
                    event.toolName,
                    event.args
                )
            );
        }

        if (event.type === 'tool_execution_end') {
            console.log('[Pi Provider] Tool execution end:', event.toolName, event.isError ? 'error' : 'success');
            
            // Extract and display tool result text
            if (event.result?.content && Array.isArray(event.result.content)) {
                const resultText = event.result.content
                    .filter((c: any) => c.type === 'text')
                    .map((c: any) => c.text)
                    .join('\n');
                
                if (resultText) {
                    progress.report(new vscode.LanguageModelTextPart(resultText));
                }
            }
        }
    }

    /**
     * Extract text from a chat message
     */
    private extractTextFromMessage(message: vscode.LanguageModelChatRequestMessage): string {
        const textParts: string[] = [];
        
        for (const part of message.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                textParts.push(part.value);
            }
        }

        return textParts.join('\n');
    }
}
