# Change Log

All notable changes to the "vscode-pi-model-chat-provider" extension will be documented in this file.

## [0.1.0] - 2026-02-12

### Added
- Initial release
- Language Model Chat Provider integration for Pi coding agent
- Multi-turn conversation persistence with session pooling
- Support for up to 20 concurrent chat sessions
- LRU eviction and idle timeout cleanup (10 minutes)
- Status bar showing context window utilization
- Dynamic model enumeration from Pi
- Streaming responses with tool execution display
- Cancellation support (stop button)
- Automatic context (environment, workspace) injection

### Features
- Session isolation per chat thread
- Context window tracking and display
- Graceful error handling for empty/image-only messages
- Model caching for fast startup
- Persistent metadata bridge for quick model enumeration
- Debug logging configurable via settings (disabled by default)

### Configuration
- `pi.binaryPath` - Path to Pi CLI binary
- `pi.workingDirectory` - Working directory for Pi agent
- `pi.autoRestart` - Auto-restart on crash
- `pi.maxRestartAttempts` - Max restart attempts
- `pi.additionalArgs` - Additional CLI arguments
- `pi.debug` - Enable debug logging (default: false)
