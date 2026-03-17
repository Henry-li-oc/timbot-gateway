# Contributing to timbot-gateway

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 8

### Development Setup

```bash
# Clone the repository
git clone https://github.com/Henry-li-oc/timbot-gateway.git
cd timbot-gateway

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests
pnpm test
```

### Local Development

```bash
# Copy the example config
cp timbot-gateway.example.yaml timbot-gateway.yaml

# Edit your local config (fill in real sdkAppId, secretKey, etc.)
# Then start the gateway
pnpm start

# Or with a custom config path
node dist/src/index.js --config /path/to/config.yaml
```

## Project Structure

```
timbot-gateway/
├── src/
│   ├── index.ts          # Entry point — CLI args, boot sequence, graceful shutdown
│   ├── types.ts           # TypeScript type definitions
│   ├── config.ts          # YAML config loading, validation & atomic persistence
│   ├── router.ts          # Route index (by timbotUserId), CRUD, FNV-1a hash
│   ├── server.ts          # HTTP server — webhook verification, routing, status API
│   ├── proxy.ts           # Request forwarding to backend OpenClaw nodes
│   ├── admin.ts           # IM-based admin commands (/addbot, /list, /status…)
│   ├── im-client.ts       # Tencent IM REST API client (UserSig + sendmsg)
│   ├── health.ts          # Periodic backend health checks
│   ├── logger.ts          # Leveled logging utility
│   └── debug/             # UserSig generation helpers
├── test/                  # Unit tests (Node.js built-in test runner)
├── timbot-gateway.example.yaml  # Example configuration
├── package.json
└── tsconfig.json
```

## Making Changes

### Branching Strategy

1. Fork the repository
2. Create a feature branch from `main`: `git checkout -b feat/your-feature`
3. Make your changes
4. Test thoroughly

### Code Style

- **TypeScript** with strict mode
- **ESM** modules (`"type": "module"`)
- Target **ES2022** with **NodeNext** module resolution
- Follow existing code conventions

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add sticky session support
fix: correct webhook signature validation edge case
docs: update configuration reference
chore: bump TypeScript to 5.x
```

### Testing

```bash
# Build and run all tests
pnpm test

# Run tests only (after build)
node --test test/*.test.mjs
```

- Add tests for new features in the `test/` directory
- Test files should use the `*.test.mjs` naming convention
- Use Node.js built-in test runner (`node:test`)

## Pull Request Process

1. **Ensure tests pass**: Run `pnpm test` before submitting
2. **Update documentation**: If your changes affect configuration or behavior, update README
3. **Describe your changes**: Clear description including what, why, and how to test
4. **Keep PRs focused**: One feature or fix per PR

## Reporting Issues

When filing a bug report, please include:

- **Environment**: Node.js version, OS
- **Configuration**: Relevant gateway config (redact `secretKey`!)
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Logs**: Output with `logging.level: "debug"`

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
