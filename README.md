# Pi Language Model Provider for VS Code

Integrate [Pi coding agent](https://github.com/badlogic/pi-mono) as a Language Model Chat Provider in VS Code, making Pi's LLM access available through VS Code's model picker for GitHub Copilot and any extension consuming `vscode.lm.*` APIs.

## Features

- **Universal Model Access**: Use Pi with any VS Code extension that supports language models
- **Dynamic Model Discovery**: Automatically detects all configured models from Pi
- **Tool Execution**: Pi handles tools internally (file operations, bash commands, etc.)
- **Streaming Responses**: Real-time streaming of LLM responses
- **Tool Transparency**: Optional display of tool execution as text annotations

## Prerequisites

1. **Pi CLI** must be installed and available in your PATH:
   ```bash
   npm install -g @mariozechner/pi-coding-agent
   ```

2. **API Keys** configured via Pi:
   ```bash
   pi auth add anthropic YOUR_ANTHROPIC_KEY
   pi auth add openai YOUR_OPENAI_KEY
   # etc.
   ```

## Installation

1. Install the extension from the VS Code Marketplace (or build from source)
2. Verify Pi is installed: `pi --version`
3. Open VS Code and Pi models will appear in the model picker

## Configuration

Access settings via `Ctrl/Cmd+,` and search for "Pi":

| Setting | Description | Default |
|---------|-------------|---------|
| `pi.binaryPath` | Path to Pi CLI binary | `pi` |
| `pi.workingDirectory` | Working directory for Pi agent | Workspace root |
| `pi.autoRestart` | Auto-restart on crash | `true` |
| `pi.maxRestartAttempts` | Max restart attempts | `3` |
| `pi.toolCallDisplay` | How to display tool execution | `text` |

## Usage

### With GitHub Copilot Chat

1. Open Copilot Chat (`Ctrl/Cmd+Shift+I`)
2. Click the model picker
3. Select a Pi model (e.g., `pi:anthropic:claude-sonnet-4-20250514`)
4. Start chatting!

### With Other Extensions

Any extension using `vscode.lm.*` APIs can use Pi models:

```typescript
const models = await vscode.lm.selectChatModels({ vendor: 'pi' });
const model = models[0];

const response = await model.sendRequest(messages, {}, token);
```

## Architecture

- **Process Isolation**: Pi runs in a separate process for stability
- **RPC Communication**: Uses Pi's RPC mode over stdin/stdout
- **Fresh Sessions**: Each request starts a fresh session (MVP)
- **Tool Handling**: Pi executes tools internally, only final text reaches VS Code

## Troubleshooting

### "Pi CLI not found"

Ensure Pi is installed and in your PATH:
```bash
which pi
# or
npm install -g @mariozechner/pi-coding-agent
```

### "API key not configured"

Configure your API keys:
```bash
pi auth add anthropic YOUR_KEY
```

### Check Logs

Open the Output panel (`Ctrl/Cmd+Shift+U`) and select "Pi Agent" from the dropdown to view logs.

## Development

```bash
# Clone and install
git clone <repo-url>
cd vscode-pi-model-chat-provider
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package
npx @vscode/vsce package
```

## Roadmap

- [x] MVP: Fresh session per request
- [ ] Persistent sessions for multi-turn context
- [ ] VS Code `SecretStorage` for API keys
- [ ] Structured tool call display
- [ ] Image input support

## License

MIT

## Links

- [Pi Repository](https://github.com/badlogic/pi-mono)
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)
