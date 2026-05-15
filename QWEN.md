# Velora Mobile - Context Guide

## Project Overview

**Velora** is a real-time communication mobile application built with React Native and Expo SDK 54. The app features authentication, real-time chat with Socket.IO, and video call capabilities.

### Technology Stack

- **Framework:** Expo SDK 54 with Expo Router (file-based routing)
- **Language:** TypeScript with strict mode
- **Styling:** NativeWind v4 (Tailwind CSS for React Native)
- **State Management:** Zustand (client state), React Query (server state)
- **Real-time:** Socket.IO for chat, WebRTC/Mediasoup planned for video calls
- **Authentication:** Cookie-based with Google Sign-In support
- **HTTP Client:** Axios with custom interceptors
- **Form Handling:** React Hook Form + Zod validation
- **Engine:** Hermes JS engine

### Architecture Notes

- **Path Aliases:** `@/*` → `src/*`, `@ui/*` → `src/components/ui/*`, `@hooks/*`, `@stores/*`, `@api/*`, `@types/*`, `@utils/*`, `@constants/*`
- **Route Groups:** `(auth)` for authentication screens, `(tabs)` for main app navigation
- **Dark Theme:** Custom color palette with semantic naming (bg-primary, surface-card, brand, etc.)

---

## Building and Running

### Development

```bash
# Install dependencies
pnpm install

# Start Metro bundler (all platforms)
pnpm start

# Run on Android
pnpm android

# Run on iOS
pnpm ios

# Run on web
pnpm web
```

### Fresh Clone Requirements

```bash
# Generate native directories before running on mobile
npx expo prebuild

# Then run the platform
pnpm android  # or pnpm ios
```

### Quality Checks (Required Before Commit)

```bash
# Lint code
pnpm lint
pnpm lint:fix  # Auto-fix lint issues

# Format code
pnpm format

# Type check
pnpm type-check
```

### EAS Build

```bash
# Development build
eas build -p android -e development
eas build -p ios -e development

# Preview build
eas build -p android -e preview
eas build -p ios -e preview

# Production build
eas build -p android -e production
eas build -p ios -e production
```

### Testing

```bash
# TODO: Add test commands when test framework is configured
```

---

## Development Conventions

### Code Style

- **No semicolons** (Prettier config: `semi: false`)
- **Single quotes** for strings
- **Trailing commas** all (`trailingComma: 'all'`)
- **Print width:** 100 characters
- **No console.log** (only `console.warn` and `console.error` allowed)
- **Use `const`**, not `var`
- **Strict equality:** `eqeqeq: 'always'`

### TypeScript Rules

- **No `any`** type (warn on usage)
- **Explicit return types** preferred but not enforced
- **Type imports** preferred over value imports (`consistent-type-imports`)
- **No non-null assertions** (`!`) unless necessary
- **Strict null checks** enabled

### Import Order

```typescript
// 1. Built-in
// 2. External packages
// 3. Internal (@/*) aliases
// 4. Parent/sibling relative imports
// 5. Type imports
```

### Component Architecture

- UI components stored in `src/components/` with subdirectories for domain features
- Custom hooks in `src/hooks/`
- State stores in `src/stores/`
- API clients in `src/api/`
- Types in `src/types/`

### Critical Implementation Details

#### Authentication (Cookie-Based)

- **Fully cookie-based** with `withCredentials: true`
- **Do NOT use** `expo-secure-store` for auth (dead code in `src/utils/storage.ts`)
- Login → `POST /auth/login` → `GET /auth/me` → `store.setUser()`
- 401 interceptor auto-refreshes via `POST /auth/refresh` with `_retry` flag
- `authStore` does NOT have persist middleware; app uses `hydrateAuth()` on startup
- Refresh fail (401) → reject, DO NOT auto-redirect to login

#### Real-Time Chat

- **Single Socket.IO instance** managed by `SocketProvider`
- **Message sending:** `socket.emit('send_message', payload)` — NOT REST API
- **Message fetching:** React Query `useInfiniteQuery` (cursor-based)
- **Optimistic updates:** Managed in Zustand `chatStore`
- **Typing indicators:** `socket.emit('typing_start'/'typing_stop')` with 2s debounce
- **Offline queue:** Messages queued in Zustand, flushed on socket `connect`
- **Performance:** `inverted` FlatList with `removeClippedSubviews`, memoized components

#### Video Calls (Not Yet Implemented)

- **Current status:** UI scaffold only, no WebRTC/Mediasoup implementation
- `IncomingCallModal` is not rendered
- Socket `call:incoming` handler is empty stub
- **Future implementation:** Create `src/hooks/useWebRTC.ts`, wire up `IncomingCallModal`

### Pre-commit Hooks

- ESLint auto-fix and Prettier format run on staged files
- **Required:** Both `pnpm lint` and `pnpm type-check` must pass before commit

### Environment Variables

- Use `EXPO_PUBLIC_*` prefix for client-side vars
- Access via `Constants.expoConfig.extra` or `process.env` in EAS builds
- **Do NOT use** `process.env` directly outside of EAS builds

### Known Pitfalls

1. `src/utils/storage.ts` is dead code (SecureStore wrapper not used)
2. Auth store does not persist; `user` resets on app kill but `hydrateAuth()` recovers via cookie
3. Refresh 401 failures do NOT auto-redirect to login
4. `react-native-reanimated` plugin must be **last** in `babel.config.js`
5. iOS Google Sign-In URL scheme must match Google Cloud Console exactly
6. Message `FlatList` is inverted without `getItemLayout` (heights are variable)
