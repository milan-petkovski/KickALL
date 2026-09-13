# Contributing to KickALL Ecosystem

Thank you for your interest in contributing to the KickALL ecosystem! This document outlines guidelines for setting up your local development environment, running tests, checking code style, and submitting Pull Requests.

---

## Local Development Environment

### Prerequisites
- **Node.js**: v22.x or later
- **npm**: v10.x or later

### Cloning and Installation
```bash
# 1. Clone the repository
git clone https://github.com/milan-petkovski/kickALL.git
cd kickALL

# 2. Install dependencies for the root workspace and Bot
npm install
cd Bot && npm install && cd ..
```

### Environment Configuration
Copy the environment variable example files:
```bash
cp Bot/.env.example Bot/.env
cp Website/.env.example Website/.env
```
Set `INTERNAL_API_SECRET` to matching values across both `.env` files for secure inter-service communication.

---

## Testing & Code Quality

Before opening a Pull Request, ensure that all automated checks pass cleanly:

```bash
# Run all native unit tests
npm test

# Run Bot unit tests only
npm run test:bot

# Run Website unit tests only
npm run test:website

# Generate code coverage report
npm run test:coverage

# Check code style with ESLint (must pass with 0 errors)
npm run lint

# Audit dependencies for security vulnerabilities
npm run audit

# Verify static resources and asset integrity
npm run verify
```

---

## Code Style & Contribution Guidelines

1. **UTF-8 Encoding**: All files must enforce clean UTF-8 character encoding without BOM. Never introduce mojibake (`\uFFFD`) and preserve all regional characters (e.g. Serbian Latin: `č, ć, š, đ, ž`).
2. **Security by Default**: All administrative and operational routes must enforce token verification with fail-closed security logic.
3. **Icons & UI Design**: Never use emoji symbols for UI components. Always use clean custom SVG icons.
4. **Unit Tests**: Every new feature, command in `Bot/src/`, or endpoint in `Website/` must include automated tests using Node's native test runner (`node:test` and `node:assert/strict`) located in the respective `tests/` directory.
5. **Clean Pull Requests**: Ensure all linting, security audits, and tests pass before submitting your Pull Request. Keep commits atomic and descriptive.
