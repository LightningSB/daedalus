---
name: daedalus-miniapp
description: Create and deploy Telegram Mini Apps to the Daedalus platform. Use when building micro-apps, dashboards, tools, or utilities that run inside Telegram. Handles React setup, single-file bundling, MinIO upload, and catalog registration. Integrates Telegram SDK, optional DuckDB-WASM for data persistence, and Wheelbase API access.
---

# Daedalus Mini App Skill

Create Telegram Mini Apps from the template, customize them, build to single HTML, deploy to MinIO, and register in the app catalog.

## Quick Start

```bash
# 1. Copy template to working directory
cp -r skills/daedalus-miniapp/template-app ./my-app
cd my-app

# 2. Install dependencies
pnpm install

# 3. Customize (edit src/App.tsx, components, styles)

# 4. Build single HTML
pnpm build

# 5. Deploy to MinIO + register in catalog
skills/daedalus-miniapp/scripts/deploy.sh my-app "My App Name" "🎯" "Short description"
```

## Architecture

```
User opens Telegram → Shell App → Loads your app from MinIO (iframe)
                                      ↓
                              Your Mini App runs
                                      ↓
                     Optional: DuckDB-WASM for data queries
                     Optional: Daedalus API for persistence
```

**Endpoints:**
- Shell: `https://daedalus.wheelbase.io`
- Apps: `https://minio.wheelbase.io/daedalus/apps/{app-id}/index.html`
- API: `https://api.daedalus.wheelbase.io/api`
- Wheelbase VIN API: `https://api.wheelbase.io/v1/vin/decode/{vin}`

## Template Structure

```
template-app/
├── package.json          # React 18, Vite, Tailwind
├── vite.config.ts        # vite-plugin-singlefile
├── tsconfig.json
├── index.html
├── postcss.config.js
├── tailwind.config.js
└── src/
    ├── main.tsx          # Entry point
    ├── App.tsx           # Main component (customize this)
    ├── index.css         # Tailwind + custom styles
    ├── hooks/
    │   ├── useTelegram.ts    # Telegram SDK integration
    │   └── useDuckDB.ts      # Optional DuckDB-WASM
    ├── components/       # Reusable components
    └── lib/
        └── api.ts        # Daedalus API helpers
```

## Customization Guide

### 1. Edit App.tsx

Replace the template content with your app logic:

```tsx
import { useTelegram } from './hooks/useTelegram';
import './index.css';

export default function App() {
  const { user, themeParams, haptic } = useTelegram();
  
  return (
    <div className="app">
      <h1>Hello {user?.first_name || 'there'}!</h1>
      {/* Your app content */}
    </div>
  );
}
```

### 2. Telegram SDK Features

The `useTelegram` hook provides:

```tsx
const {
  webApp,           // Raw Telegram WebApp object
  user,             // { id, first_name, last_name, username }
  tgUserId,         // User ID string (for API calls)
  themeParams,      // { bg_color, text_color, button_color, etc. }
  haptic,           // { impact(), notification(), selection() }
  showBackButton,   // Show/hide back button
  setHeaderColor,   // Change header color
  close,            // Close the mini app
  expand,           // Expand to full height
} = useTelegram();
```

### 3. Optional: Add DuckDB for Data

For apps that query data, add DuckDB-WASM:

```tsx
import { useDuckDB } from './hooks/useDuckDB';

function MyDataApp() {
  const { conn, isLoading, error } = useDuckDB();
  
  const runQuery = async () => {
    if (!conn) return;
    const result = await conn.query(`SELECT * FROM my_table LIMIT 10`);
    // Process result
  };
}
```

Load remote Parquet files:

```tsx
// In useDuckDB initialization, load from MinIO:
await conn.query(`
  CREATE TABLE my_data AS 
  SELECT * FROM read_parquet('https://minio.wheelbase.io/daedalus/data/my-data.parquet')
`);
```

### 4. Persist User Data

Use the Daedalus API for user-specific storage:

```tsx
import { saveUserData, loadUserData } from './lib/api';

// Save
await saveUserData(tgUserId, 'my-app', { score: 100, level: 5 });

// Load
const data = await loadUserData(tgUserId, 'my-app');
```

## Design Guidelines

Follow these principles for polished Mini Apps:

### Typography
- Use distinctive fonts (not Inter/Arial/system)
- Pair display font with readable body font
- Template uses Nunito (matches shell)

### Color
- Dark theme default (`#0f1419` background)
- Emerald/teal accent (`#10b981`)
- Use CSS variables for theming
- Respect `themeParams` from Telegram when available

### Layout
- Mobile-first (320px minimum width)
- Safe area padding for notches
- Touch targets minimum 44x44px
- Glass morphism cards with `backdrop-blur`

### Motion
- Subtle fade-ins on mount
- Staggered animations for lists
- Haptic feedback on key interactions
- CSS transitions over JS animations

### Accessibility
- Semantic HTML elements
- Sufficient color contrast (4.5:1 minimum)
- Focus states for keyboard navigation
- ARIA labels where needed

See `references/design-patterns.md` for component examples.

## Build & Deploy

### Local Development

```bash
cd my-app
pnpm dev    # Starts Vite dev server at localhost:5173
```

### Production Build

```bash
pnpm build  # Outputs dist/index.html (single file, ~50-400KB)
```

### Deploy Script

```bash
# Usage: deploy.sh <app-id> <name> <icon> <description>
skills/daedalus-miniapp/scripts/deploy.sh \
  habit-tracker \
  "Habit Tracker" \
  "✅" \
  "Track daily habits with streaks"
```

The script:
1. Builds the app (`pnpm build`)
2. Uploads `dist/index.html` to MinIO at `apps/{app-id}/index.html`
3. Adds entry to `catalog.parquet` (global app list)

### Manual Deploy

If the script isn't available:

```bash
# Build
pnpm build

# Upload to MinIO
mc cp dist/index.html minio/daedalus/apps/my-app/index.html

# Update catalog (use scripts/update-catalog.py)
python3 scripts/update-catalog.py add \
  --id my-app \
  --name "My App" \
  --icon "🎯" \
  --description "App description" \
  --path "/apps/my-app/index.html"
```

## API Reference

### Daedalus API

Base URL: `https://api.daedalus.wheelbase.io/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/catalog` | List all apps |
| GET | `/users/{tgId}/sessions` | List user sessions |
| POST | `/users/{tgId}/sessions` | Create session |
| GET | `/users/{tgId}/sessions/{key}/messages` | Get messages |
| POST | `/users/{tgId}/sessions/{key}/messages` | Append messages |

### Wheelbase API

VIN decoding available at `https://api.wheelbase.io/v1/vin/decode/{vin}`

## MinIO Structure

```
daedalus/
├── catalog.parquet           # App catalog (global)
├── apps/
│   ├── {app-id}/
│   │   └── index.html        # Your bundled app
├── data/
│   └── {app-id}/
│       └── *.parquet         # App data files
└── users/
    └── {tgUserId}/
        └── {app-id}.json     # Per-user data
```

## Credentials

**MinIO:**
- Endpoint: `https://minio.wheelbase.io`
- Access Key: `wheelbase-admin`
- Secret Key: `uDtIQzNGC8bIdTOhiTHy60an`
- Bucket: `daedalus`

**Telegram Bot:**
- Username: `@ai_icarus_bot`
- Token: `8440442465:AAHx7SEBBw09UBZKZ923e_v9mPb5MYMvSFM`

## Examples

### Simple Counter App

```tsx
import { useState } from 'react';
import { useTelegram } from './hooks/useTelegram';

export default function App() {
  const [count, setCount] = useState(0);
  const { haptic } = useTelegram();
  
  const increment = () => {
    setCount(c => c + 1);
    haptic.impact('light');
  };
  
  return (
    <div className="app flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-6xl font-bold mb-8">{count}</h1>
      <button 
        onClick={increment}
        className="px-8 py-4 bg-emerald-500 rounded-xl text-xl font-semibold"
      >
        Tap to count
      </button>
    </div>
  );
}
```

### Data Dashboard with DuckDB

See `references/examples.md` for a complete data dashboard example.

## Troubleshooting

**Build fails with missing dependency:**
```bash
pnpm install  # Ensure all deps installed
```

**App doesn't load in Telegram:**
- Check CORS (MinIO bucket allows public read)
- Verify the path in catalog matches upload path
- Check browser console for errors

**DuckDB fails to load Parquet:**
- Ensure file is publicly accessible
- Check httpfs extension is installed
- Verify Parquet file isn't corrupted

**Telegram SDK not available:**
- App must be opened via Telegram (not direct browser)
- Check `window.Telegram.WebApp` exists before using
