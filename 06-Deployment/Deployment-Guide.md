# Asama AI — Setup and Deployment Guide

## Web development

Use the initialized project at its repository root. Install with the pinned package manager (`pnpm@10.18.0`), then run `pnpm dev`. The configured port is 3000. Verify `GET /api/health` returns a success response and `GET /manus-routes.json` returns the route manifest JSON. Preserve the existing Express, Vite, tRPC, OAuth, and build conventions.

The web application uses the managed MySQL-compatible database and platform-provided Manus service credentials at runtime. Keep credentials in environment/configuration, never in source or browser bundles. Development and published deployment share the managed database; migrations are additive, and tests must not seed/delete shared records.

## Local Linux hardware assistant

The Python CLI is a separate local package under `local-assistant/`; it is not included in the web container and is never exposed as a web endpoint. Run it from the repository using the documented local package command. The user supplies a running Ollama instance on the CLI's fixed `127.0.0.1:11434` endpoint and a model that supports tool use; `--model` selects a model already installed there. The URL is not configurable and there is no cloud fallback. Hardware facts and in-memory conversation context remain local. The CLI does not invoke `sudo` or arbitrary shell commands.

## Production restrictions

The current project configuration has Auto Publish disabled. Do not turn it on. Do not deploy or publish unless the owner gives separate explicit approval. Preserve port 3000, publicly accessible `/api/health`, and the Preview cookie requirements (`SameSite=None; Secure` in the cross-site HTTPS Preview context). Do not put the Python CLI into the web container or make it callable over the web API.
