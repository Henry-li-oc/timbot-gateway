# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-03-16

### Added
- Webhook gateway proxy for Tencent Cloud IM callbacks
- SHA256 signature verification with timestamp validation
- C2C (single chat) routing by `To_Account` → `timbotUserId`
- Group chat smart filtering: only forward when target bot is explicitly `@mentioned`
- Built-in admin commands via IM: `/addbot`, `/removebot`, `/list`, `/status`, `/enable`, `/disable`, `/reload`, `/help`
- Dynamic route management with automatic YAML config persistence (atomic write)
- Periodic backend health checks (configurable interval & timeout)
- `GET /gateway/status` HTTP management endpoint
- YAML-based configuration with validation and sensible defaults
- Graceful shutdown on SIGINT/SIGTERM

[1.0.0]: https://github.com/Henry-li-oc/timbot-gateway/releases/tag/v1.0.0
