# @saidksi/localizer-cli

Command-line tool for automating i18n workflows in JavaScript/TypeScript projects. Scans for hardcoded strings, generates semantic i18n keys via AI, translates into target languages, and rewrites source code.

## Installation

```bash
# Global installation
npm install -g @saidksi/localizer-cli

# Per-project installation
npm install --save-dev @saidksi/localizer-cli
```

## Quick Start

```bash
# Initialize your project
localizer init

# Scan for hardcoded strings
localizer scan src/

# Full automation: scan → generate keys → translate → rewrite
localizer run --yes

# Validate translation coverage
localizer validate
```

## Before & After Example

### Before (Hardcoded Strings)

```jsx
import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!email || !password) {
      setError("Both email and password are required");
      return;
    }

    if (!email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
  };

  return (
    <div>
      <h1>Welcome to Our App</h1>
      <p>Sign in to your account to continue</p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <label>Email Address</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email address"
        />

        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
        />

        <button type="submit">Sign In</button>
      </form>
    </div>
  );
}
```

### After (i18n Ready)

```jsx
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function LoginForm() {
  const { t } = useTranslation("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!email || !password) {
      setError(t("login.error.required_fields"));
      return;
    }

    if (!email.includes("@")) {
      setError(t("login.error.invalid_email"));
      return;
    }
  };

  return (
    <div>
      <h1>{t("login.welcome_title")}</h1>
      <p>{t("login.welcome_subtitle")}</p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <label>{t("login.email_label")}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("login.email_placeholder")}
        />

        <label>{t("login.password_label")}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("login.password_placeholder")}
        />

        <button type="submit">{t("login.submit_button")}</button>
      </form>
    </div>
  );
}
```

**Translation Files Generated:**

```json
// messages/en/login.json
{
  "login.welcome_title": "Welcome to Our App",
  "login.welcome_subtitle": "Sign in to your account to continue",
  "login.error.required_fields": "Both email and password are required",
  "login.error.invalid_email": "Please enter a valid email address",
  "login.email_label": "Email Address",
  "login.email_placeholder": "Enter your email address",
  "login.password_label": "Password",
  "login.password_placeholder": "Enter your password",
  "login.submit_button": "Sign In"
}

// messages/fr/login.json
{
  "login.welcome_title": "Bienvenue dans notre application",
  "login.welcome_subtitle": "Connectez-vous à votre compte pour continuer",
  "login.error.required_fields": "L'email et le mot de passe sont obligatoires",
  "login.error.invalid_email": "Veuillez entrer une adresse e-mail valide",
  "login.email_label": "Adresse e-mail",
  "login.email_placeholder": "Entrez votre adresse e-mail",
  "login.password_label": "Mot de passe",
  "login.password_placeholder": "Entrez votre mot de passe",
  "login.submit_button": "Se connecter"
}
```

## Commands

### `localizer init`

Interactive setup wizard. Creates `.localizer/config.json` and stores API keys in `~/.localizer`.

### `localizer audit`

Count total untranslated strings in your project.

### `localizer scan <path>`

List all hardcoded strings found in a file or directory.

### `localizer translate [options]`

Generate semantic i18n keys and translate strings into target languages.

### `localizer rewrite <path> [options]`

Replace hardcoded strings with i18n function calls (`t('key')`).

### `localizer run [options]`

Full pipeline: scan → generate keys → translate → rewrite → validate.

### `localizer validate [options]`

Check translation coverage across all languages. Use `--ci` for CI/CD.

### `localizer add-lang <language>`

Add a new language and translate all existing keys.

### `localizer status`

Show project health snapshot (files, strings, translation coverage).

### `localizer diff <language>`

Show missing keys for a specific language.

## Configuration

Create `.localizer/config.json` in your project root:

```json
{
  "defaultLanguage": "en",
  "languages": ["en", "fr", "es"],
  "messagesDir": "./messages",
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/*.test.ts", "**/*.spec.ts"],
  "aiProvider": "anthropic",
  "aiModel": "claude-3-sonnet-20240229",
  "keyStyle": "dot.notation",
  "i18nLibrary": "react-i18next",
  "fileOrganization": "per-page",
  "strictMode": true,
  "glossary": {}
}
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## License

MIT

## Repository

https://github.com/SaidKSI/localizer-cli

## Related Projects

- **@saidksi/localizer-core** — Core i18n library (Scanner, AI, Rewriter, Validator)
  - GitHub: https://github.com/SaidKSI/localize-core
  - npm: https://www.npmjs.com/package/@saidksi/localizer-core

- **localizer-sample-app** — Example React app for testing
  - GitHub: https://github.com/SaidKSI/localizer-sample-app
