# Velora-M

React Native mobile app (Expo SDK 54, expo-router, NativeWind, Hermes JS engine).

## Commands

- Dev: `pnpm start`
- Android: `pnpm android` (run `npx expo prebuild` first on fresh clone)
- iOS: `pnpm ios` (run `npx expo prebuild` first on fresh clone)
- Web: `pnpm web`
- Lint: `pnpm lint`
- Lint fix: `pnpm lint:fix`
- Format: `pnpm format`
- Type check: `pnpm type-check`

> Bắt buộc pass `pnpm lint` và `pnpm type-check` trước mọi commit.

## Path Aliases

`@/*` → `src/*`; `@ui/*` → `src/components/ui/*`; `@hooks/*`, `@stores/*`, `@api/*`, `@types/*`, `@utils/*`, `@constants/*`

## Core Features Architecture

### Auth (`app/(auth)/`, `src/stores/authStore.ts`, `src/providers/AuthProvider.tsx`)

- **Cookie-based hoàn toàn** (`withCredentials: true`). KHÔNG dùng expo-secure-store — `src/utils/storage.ts` là dead code.
- Login: `POST /auth/login` → `GET /auth/me` → `store.setUser()`. Google OAuth: `GoogleSignin.signIn()` → `verifyGoogleToken`.
- 401 interceptor trong `src/api/client.ts`: auto `POST /auth/refresh` với `_retry` flag (ngăn loop). Refresh fail → reject, KHÔNG redirect auto.
- `authStore` KHÔNG có persist middleware. Khởi tạo `isLoading: true` → `app/_layout.tsx` gọi `hydrateAuth()` → `GET /auth/me`.
- Route protection: `AuthProvider` redirect: unauth → `/login`, auth trong `(auth)` group → `/`.

### Chat (`app/conversation/`, `src/providers/SocketProvider.tsx`, `src/stores/chatStore.ts`)

- **Real-time: Socket.IO** (single instance, `SocketProvider`). URL: `EXPO_PUBLIC_WS_URL`.
- Gửi tin nhắn: `socket.emit('send_message', payload)` — KHÔNG dùng REST.
- Fetch: React Query `useInfiniteQuery` (messages, cursor-based), `useQuery` (conversation list, no polling).
- Zustand `chatStore`: optimistic messages, typing users, online users, offline queue, seen receipts.
- Typing: `socket.emit('typing_start'/'typing_stop')`, debounce 2s.
- Offline: queue trong Zustand `offlineQueue`, flush khi socket `connect`.
- FlatList: `inverted`, `removeClippedSubviews`, `initialNumToRender=20`, `maxToRenderPerBatch=10`. Memo `MessageBubble`, `ConversationItem`, `MessageInput`.
- Cleanup: `socket.removeAllListeners()` + `socket.disconnect()` trong `SocketProvider` useEffect return.

### Video Call (`app/call/`, `src/stores/callStore.ts`)

- **CHƯA implement WebRTC/Mediasoup.** Code hiện chỉ là UI scaffold + mock history.
- `IncomingCallModal` scaffolded nhưng chưa được render. Socket `call:incoming` handler empty stub.
- Khi implement WebRTC: bắt buộc cleanup trong useEffect return — `close()` transport, `producer.close()`, `consumer.close()`.
- Hiện tại: `callStore.endCall()` chỉ clear timer interval, không có media teardown.

## Push Notifications

- **Chưa install.** Muốn enable: cài `expo-notifications`, thêm plugin vào `app.json`, config APNs entitlement (`aps-environment: development/production`), thêm `AppDelegate` push token handler.
- `Info.plist` đã khai báo `UIBackgroundModes: [audio, voip]` — placeholder cho VoIP push.

## Tech Stack Notes

- Expo SDK 54 / React Native 0.81.5 / Hermes JS engine
- `react-native-reanimated` v4: babel plugin `react-native-reanimated/plugin` phải là **plugin cuối cùng** trong `babel.config.js`
- Google Sign-In: iOS URL scheme trong `app.json` plugins phải khớp Google Cloud Console
- `expo-router` typed routes enabled (`experiments.typedRoutes: true`) — chạy `npx expo-router-type-gen` sau khi thêm route mới
- Zustand (global state), React Query + Axios (server state), Zod + react-hook-form (validation)
- `.env` vars dùng `expo-constants`, KHÔNG dùng `process.env` ngoài EAS builds

## Environment Setup

- Fresh clone: `npx expo prebuild` trước `pnpm android`/`pnpm ios` để generate native dirs
- EAS Build: `eas build -p android/ios -e preview/production`
- `EXPO_NO_TELEMETRY=1` để suppress telemetry

## Pitfalls

- `src/utils/storage.ts`: dead code — SecureStore wrapper không được sử dụng, auth hoàn toàn cookie-based
- `authStore` không persist — app kill rồi restart thì `user`/`isAuthenticated` reset, nhưng cookie vẫn còn nên `hydrateAuth()` recover được
- Refresh 401 fail KHÔNG auto-redirect login — screen phải handle 401 error riêng
- FlatList inverted trong `ChatScreen` không dùng `getItemLayout` — message heights biến đổi
- `verify-email.tsx` — `handleResend` chỉ show Alert, không gọi API resend
- `register.tsx` không setUser sau khi đăng ký — user object chỉ set sau email verify
- Video call: CHƯA có WebRTC, muốn implement thì bắt đầu từ `src/hooks/useWebRTC.ts` + `IncomingCallModal` wiring
- Push notification: entitlements file empty, AppDelegate không có push handlers
