/**
 * Message Converter - Extract prompts from VS Code message history
 */

import * as vscode from 'vscode';
import { debug } from './debug.js';

/**
 * Extract the last user message from VS Code chat history
 * 
 * Strategy for MVP: Fresh session per request
 * - Extract only the last user message
 * - Pi manages its own conversation history internally
 */
export function extractLastUserMessage(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
): string {
    // Filter to user messages only
    const userMessages = messages.filter(
        m => m.role === vscode.LanguageModelChatMessageRole.User
    );

    if (userMessages.length === 0) {
        throw new Error('No user messages found in conversation history');
    }

    // Get the last user message
    const lastMessage = userMessages[userMessages.length - 1];

    // Extract text content from all parts
    const textParts: string[] = [];
    
    for (const part of lastMessage.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
            textParts.push(part.value);
        }
        // Note: Image support can be added in Phase 2
        // if (part instanceof vscode.LanguageModelImagePart) {
        //     // Convert to base64 and add to images array
        // }
    }

    if (textParts.length === 0) {
        throw new Error('Last user message contains no text content');
    }

    let fullText = textParts.join('\n');
    
    // Strip VS Code instruction attachments that cause issues with Pi
    // These are added by VS Code and contain vscode-userdata:// URIs
    // Extract just the user's actual prompt from <prompt>...</prompt> tags
    const promptMatch = fullText.match(/<prompt>\s*([\s\S]*?)\s*<\/prompt>/);
    if (promptMatch) {
        return promptMatch[1].trim();
    }
    
    // If no <prompt> tags, return the full text (fallback)
    return fullText;
}

/**
 * Parse VS Code model ID into provider and model components
 * 
 * Format: "pi:<provider>:<model-id>"
 * Example: "pi:anthropic:claude-sonnet-4-20250514"
 */
export function parseModelId(modelId: string): { provider: string; modelId: string } {
    debug('[parseModelId] Input:', modelId);
    
    const parts = modelId.split(':');
    
    if (parts.length < 3 || parts[0] !== 'pi') {
        const error = new Error(
            `Invalid model ID format: "${modelId}". Expected format: "pi:<provider>:<model-id>". ` +
            `This usually means a non-Pi model was selected. Please select a model starting with "pi:" from the model picker.`
        );
        console.error('[parseModelId] Error:', error.message);
        throw error;
    }

    const result = {
        provider: parts[1],
        modelId: parts.slice(2).join(':'), // Handle model IDs with colons
    };
    
    debug('[parseModelId] Result:', result);
    return result;
}
