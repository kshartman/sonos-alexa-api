# Contributing to Sonos HTTP API

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and constructive
- Welcome newcomers and help them get started
- Focus on what is best for the community
- Show empathy towards other community members

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

When creating a bug report, include:
- A clear and descriptive title
- Steps to reproduce the problem
- Expected behavior
- Actual behavior
- Your environment (Node version, OS, Sonos system)
- Any relevant logs or error messages

### Suggesting Features

Feature requests are welcome! Please provide:
- A clear and descriptive title
- The motivation for this feature
- Detailed explanation of how it should work
- Any examples from similar projects

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

#### Pull Request Guidelines

- Follow the existing code style
- Write tests for new functionality
- Update documentation as needed
- Keep PRs focused - one feature/fix per PR
- Write clear commit messages

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/sonos-http-api.git
cd sonos-http-api

# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test
```

## Code Style

- Use TypeScript for all new code
- Follow existing formatting (the project uses prettier)
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Prefer async/await over callbacks
- Handle errors appropriately

## Testing

- Write unit tests for new functionality
- Ensure all tests pass before submitting PR
- Aim to maintain or increase test coverage
- Test with actual Sonos devices when possible

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm test -- --mock-only

# Run specific test file
npm test -- integration/playback-tests.ts

# Run tests with grep pattern
npm test -- --grep "Volume"
```

## Project Structure

```
src/
├── server.ts              # Entry point
├── api-router.ts          # HTTP endpoint routing
├── discovery.ts           # SSDP device discovery
├── sonos-device.ts        # Device control
├── actions/               # High-level actions
├── services/              # Music services, TTS, etc.
├── types/                 # TypeScript types
├── upnp/                  # UPnP/SOAP communication
└── utils/                 # Utilities and helpers

test/
├── unit/                  # Unit tests
├── integration/           # Integration tests
└── helpers/               # Test utilities
```

## Adding Music Services

To add a new music service:

1. Create a new service class extending `MusicService`
2. Implement required methods (search, play, etc.)
3. Add service to `MusicServiceFactory`
4. Write tests for the service
5. Update documentation

## Debugging

Enable debug logging:
```bash
curl http://localhost:5005/debug/enable-all
curl http://localhost:5005/debug/level/debug
```

View logs:
```bash
docker logs -f sonos-http-api
# or
npm run dev
```

## Questions?

Feel free to open an issue for questions or join the discussions!