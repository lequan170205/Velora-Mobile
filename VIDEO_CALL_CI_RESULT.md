# Video Call CI Result

- Typecheck exit: 2
- Tests exit: 1
- Lint exit: 1

## Typecheck
```text

> tmp_expo@1.0.0 type-check /home/runner/work/Velora-Mobile/Velora-Mobile
> tsc --noEmit

app/conversation/[id]/info.tsx(650,38): error TS2339: Property 'email' does not exist on type 'PublicFriendProfile'.
src/providers/CallProvider.tsx(2700,27): error TS2367: This comparison appears to be unintentional because the types '"VOICE"' and '"VIDEO"' have no overlap.
 ELIFECYCLE  Command failed with exit code 2.
```

## Tests
```text
            })
          }, PEER_LEFT_GRACE_MS)
        }
    
        socket.on('connect', handleConnect)
        socket.on('call_socket_ready', handleSocketReady)
        socket.on('disconnect', handleDisconnect)
        socket.on('incoming_call', (payload) => {
          void handleIncomingCall(payload)
        })
        socket.on('new_producer', (payload) => {
          void consumeRemoteProducer(payload)
        })
        socket.on('producer_closed', handleProducerClosed)
        socket.on('call_type_changed', handleCallTypeChanged)
        socket.on('call_answered', (payload) => {
          if (isCurrentCall(payload.callId)) {
            callAnsweredRef.current = true
          }
        })
        socket.on('call_rejected', handleCallRejected)
        socket.on('peer_reconnecting', handlePeerReconnecting)
        socket.on('peer_reconnected', handlePeerReconnected)
        socket.on('peer_left', handlePeerLeft)
        socket.on('call_ended', handleCallEnded)
    
        void ensureCallSocketConnected('runtime').catch(() => undefined)
    
        return () => {
          socket.off('connect', handleConnect)
          socket.off('call_socket_ready', handleSocketReady)
          socket.off('disconnect', handleDisconnect)
          socket.off('call_rejected', handleCallRejected)
          socket.off('peer_reconnecting', handlePeerReconnecting)
          socket.off('peer_reconnected', handlePeerReconnected)
          socket.off('peer_left', handlePeerLeft)
          socket.off('call_ended', handleCallEnded)
          socket.off('incoming_call')
          socket.off('new_producer')
          socket.off('producer_closed', handleProducerClosed)
          socket.off('call_type_changed', handleCallTypeChanged)
          socket.off('call_answered')
        }
      }, [
        consumeRemoteProducer,
        currentUserId,
        activateLocalVideo,
        clearRemoteVideoRuntime,
        deactivateLocalVideo,
        beginReconnectRecovery,
        clearSocketDisconnectGraceTimeout,
        handlePeerReconnected,
        handlePeerReconnecting,
        handleIncomingCall,
        handleTerminalCall,
        ensureCallSocketConnected,
        isAuthenticated,
        isCurrentCall,
        isLoading,
        presentError,
        recoverActiveCall,
        restorePreActiveCallMembership,
        teardownOnce,
        clearPeerLeftFallback,
      ])
    
      useEffect(() => {
        const waitRegistry = waitRegistryRef.current
    
        return () => {
          socketRef.current?.removeAllListeners()
          socketRef.current?.disconnect()
          socketRef.current = null
          clearSocketDisconnectGraceTimeout()
          callSocketPromisesRef.current.clear()
          socketConnectPromiseRef.current = null
          callSocketAuthenticatedRef.current = false
          stopTimer()
          clearNativeActionRetryTimeout()
          clearRemoteAudioFallback()
          clearPeerLeftFallback()
          clearMediaTransportDisconnectTimeouts()
          clearWaitRegistry(waitRegistry)
        }
      }, [
        clearNativeActionRetryTimeout,
        clearMediaTransportDisconnectTimeouts,
        clearPeerLeftFallback,
        clearRemoteAudioFallback,
        clearSocketDisconnectGraceTimeout,
        stopTimer,
      ])
    
      const value = useMemo<UseCallValue>(
        () => ({
          startVoiceCall,
          startVideoCall,
          acceptIncomingCall,
          rejectIncomingCall,
          endCall,
          toggleMute,
          toggleSpeaker,
          toggleCamera,
          switchCamera,
          switchCallType,
          dismissCallError,
        }),
        [
          acceptIncomingCall,
          dismissCallError,
          endCall,
          rejectIncomingCall,
          startVoiceCall,
          startVideoCall,
          toggleMute,
          toggleSpeaker,
          toggleCamera,
          switchCamera,
          switchCallType,
        ],
      )
    
      return <CallContext.Provider value={value}>{children}</CallContext.Provider>
    }
    
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (/home/runner/work/Velora-Mobile/Velora-Mobile/tests/video-call-1to1-contract.test.cjs:22:10)
    Test.runInAsyncScope (node:async_hooks:206:9)
    Test.run (node:internal/test_runner/test:796:25)
    Test.processPendingSubtests (node:internal/test_runner/test:526:18)
    Test.postRun (node:internal/test_runner/test:889:19)
    Test.run (node:internal/test_runner/test:835:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:526:7)
  ...
# Subtest: active call screen renders RTC video and both conversion directions
ok 60 - active call screen renders RTC video and both conversion directions
  ---
  duration_ms: 0.428685
  ...
# Subtest: conversation video entry point remains direct-chat only
ok 61 - conversation video entry point remains direct-chat only
  ---
  duration_ms: 0.29834
  ...
# Subtest: native call surfaces preserve callType
ok 62 - native call surfaces preserve callType
  ---
  duration_ms: 0.592033
  ...
1..62
# tests 62
# suites 0
# pass 58
# fail 1
# cancelled 0
# skipped 0
# todo 3
# duration_ms 1807.887769
 ELIFECYCLE  Test failed. See above for more details.
```

## Lint
```text

> tmp_expo@1.0.0 lint /home/runner/work/Velora-Mobile/Velora-Mobile
> eslint .


/home/runner/work/Velora-Mobile/Velora-Mobile/app/_layout.tsx
   49:80  error    Insert `⏎···`                                                                                                                                                                                                                                                                                                                            prettier/prettier
   78:6   warning  React Hook useMemo has an unnecessary dependency: 'cacheVersion'. Either exclude it or remove the dependency array                                                                                                                                                                                                                       react-hooks/exhaustive-deps
  123:7   error    Replace `(phase·!==·'active'·&&·phase·!==·'reconnecting')·||·!callId·||·pathname.startsWith('/call/')` with `⏎····(phase·!==·'active'·&&·phase·!==·'reconnecting')·||⏎····!callId·||⏎····pathname.startsWith('/call/')⏎··`                                                                                                               prettier/prettier
  141:16  error    Insert `⏎·········`                                                                                                                                                                                                                                                                                                                      prettier/prettier
  149:25  error    Replace `·name={callType·===·'VIDEO'·?·'videocam'·:·'call'}·size={16}·color="#ffffff"` with `⏎············name={callType·===·'VIDEO'·?·'videocam'·:·'call'}⏎············size={16}⏎············color="#ffffff"⏎·········`                                                                                                                 prettier/prettier
  203:33  error    Replace `·console.warn('[ReelVideoCache]·Failed·to·start·iOS·HLS·cache',·error)` with `⏎········console.warn('[ReelVideoCache]·Failed·to·start·iOS·HLS·cache',·error),⏎······`                                                                                                                                                           prettier/prettier
  268:49  error    Replace `·animation:·'slide_from_right',·animationDuration:·220,·freezeOnBlur:·false` with `⏎········································animation:·'slide_from_right',⏎········································animationDuration:·220,⏎········································freezeOnBlur:·false,⏎·····································`  prettier/prettier
  272:49  error    Replace `·animation:·'slide_from_right',·animationDuration:·250` with `⏎········································animation:·'slide_from_right',⏎········································animationDuration:·250,⏎·····································`                                                                                    prettier/prettier
  276:49  error    Replace `·animation:·'slide_from_right',·animationDuration:·250` with `⏎········································animation:·'slide_from_right',⏎········································animationDuration:·250,⏎·····································`                                                                                    prettier/prettier
  280:49  error    Replace `·animation:·'slide_from_right',·animationDuration:·250` with `⏎········································animation:·'slide_from_right',⏎········································animationDuration:·250,⏎·····································`                                                                                    prettier/prettier
  282:50  error    Replace `·name="reels/create"·options={{·presentation:·'fullScreenModal'·}}` with `⏎······································name="reels/create"⏎······································options={{·presentation:·'fullScreenModal'·}}⏎···································`                                                                   prettier/prettier
  283:50  error    Replace `·name="call/[id]"·options={{·presentation:·'fullScreenModal'·}}` with `⏎······································name="call/[id]"⏎······································options={{·presentation:·'fullScreenModal'·}}⏎···································`                                                                         prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/app/call/[id].tsx
    7:1   error    `react-native-safe-area-context` import should occur before import of `react-native-webrtc`                                                                                                                                                                 import/order
   47:10  error    Replace `⏎····endCall,⏎····switchCallType,⏎····switchCamera,⏎····toggleCamera,⏎····toggleMute,⏎····toggleSpeaker,⏎··}·=` with `·endCall,·switchCallType,·switchCamera,·toggleCamera,·toggleMute,·toggleSpeaker·}·=⏎···`                                     prettier/prettier
  104:62  error    Insert `⏎·····`                                                                                                                                                                                                                                             prettier/prettier
  123:15  error    Replace `·source={{·uri:·peerAvatarUrl·}}·style={{·width:·144,·height:·144,·borderRadius:·72·}}` with `⏎··········source={{·uri:·peerAvatarUrl·}}⏎··········style={{·width:·144,·height:·144,·borderRadius:·72·}}⏎·······`                                  prettier/prettier
  131:12  error    Replace `·className="mt-5·px-8·text-center·text-[25px]·font-bold·text-text-primary"·numberOfLines={1}` with `⏎········className="mt-5·px-8·text-center·text-[25px]·font-bold·text-text-primary"⏎········numberOfLines={1}⏎······`                           prettier/prettier
  145:21  error    Replace `·streamURL={remoteStreamUrl!}·objectFit="cover"·mirror={false}·style={{·flex:·1·}}` with `⏎··············streamURL={remoteStreamUrl!}⏎··············objectFit="cover"⏎··············mirror={false}⏎··············style={{·flex:·1·}}⏎···········`  prettier/prettier
  145:33  warning  Forbidden non-null assertion                                                                                                                                                                                                                                @typescript-eslint/no-non-null-assertion
  147:33  warning  Forbidden non-null assertion                                                                                                                                                                                                                                @typescript-eslint/no-non-null-assertion
  149:80  error    Replace `{avatarFallback}` with `⏎··············{avatarFallback}⏎············`                                                                                                                                                                              prettier/prettier
  168:27  error    Replace `·name="keyboard-arrow-down"·size={32}·color={isVideo·?·'#FFFFFF'·:·'#1C1C1E'}` with `⏎··············name="keyboard-arrow-down"⏎··············size={32}⏎··············color={isVideo·?·'#FFFFFF'·:·'#1C1C1E'}⏎···········`                          prettier/prettier
  170:16  error    Replace `·className={`flex-row·items-center·rounded-full·px-3·py-1.5·${isVideo·?·'bg-black/35'·:·''}`}` with `⏎············className={`flex-row·items-center·rounded-full·px-3·py-1.5·${isVideo·?·'bg-black/35'·:·''}`}⏎··········`                         prettier/prettier
  172:18  error    Replace `·className={`ml-1·text-xs2·font-medium·${isVideo·?·'text-white'·:·'text-text-secondary'}`}` with `⏎··············className={`ml-1·text-xs2·font-medium·${isVideo·?·'text-white'·:·'text-text-secondary'}`}⏎············`                           prettier/prettier
  190:47  error    Replace `·?·`${reconnectSecondsLeft}s·to·restore`` with `⏎··················?·`${reconnectSecondsLeft}s·to·restore`⏎·················`                                                                                                                      prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/app/conversation/[id]/info.tsx
  637:31  error  Replace `·source={{·uri:·item.user.picture·}}·className="h-10·w-10·rounded-full"` with `⏎··························source={{·uri:·item.user.picture·}}⏎··························className="h-10·w-10·rounded-full"⏎·······················`  prettier/prettier
  813:33  error  Replace `⏎····················closeMemberActionsAndRun(selectedMember,·confirmTransferOwnership)⏎··················` with `·closeMemberActionsAndRun(selectedMember,·confirmTransferOwnership)`                                               prettier/prettier
  835:72  error  Replace `⏎····················Remove·from·group⏎··················` with `Remove·from·group`                                                                                                                                                  prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/plugins/withPodfileCodeSign.js
  44:9  warning  Unexpected console statement  no-console

/home/runner/work/Velora-Mobile/Velora-Mobile/plugins/withVeloraSystemCalls.js
  2:14  error  There should be at least one empty line between import groups  import/order

/home/runner/work/Velora-Mobile/Velora-Mobile/src/api/conversation.api.ts
   54:47  error  Replace `⏎··conversation:·Conversation,⏎` with `conversation:·Conversation`                                                                                                                                                  prettier/prettier
  244:20  error  Replace `'[ConversationApi]·Group·V2·member·projection·unavailable;·using·roster·fallback',·error` with `⏎········'[ConversationApi]·Group·V2·member·projection·unavailable;·using·roster·fallback',⏎········error,⏎······`  prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/src/components/chat/MessageBubble.tsx
  21:31  error  Replace `·typeof·participant.email·===·'string'·&&` with `⏎······typeof·participant.email·===·'string'·&&⏎·····`  prettier/prettier
  30:16  error  Insert `⏎···`                                                                                                     prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/src/hooks/useMessages.ts
  323:3  warning  'latestSyncRange' is defined but never used. Allowed unused args must match /^_/u  unused-imports/no-unused-vars

/home/runner/work/Velora-Mobile/Velora-Mobile/src/lib/messageIdentity.ts
  309:2  error  Insert `⏎`  prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/src/providers/CallProvider.tsx
  1454:15  error    Empty block statement                                                                                                                                                                                                                                                                      no-empty
  1457:15  error    Empty block statement                                                                                                                                                                                                                                                                      no-empty
  1530:15  error    Empty block statement                                                                                                                                                                                                                                                                      no-empty
  1533:15  error    Empty block statement                                                                                                                                                                                                                                                                      no-empty
  2068:23  error    Replace `.getState()` with `⏎············.getState()⏎············`                                                                                                                                                                                                                         prettier/prettier
  2069:1   error    Replace `············payload.kind·===·'audio'·?·{·remoteAudioState:·'waiting'·}` with `··············payload.kind·===·'audio'⏎················?·{·remoteAudioState:·'waiting'·}⏎···············`                                                                                           prettier/prettier
  2070:1   error    Insert `··`                                                                                                                                                                                                                                                                                prettier/prettier
  2076:61  error    Insert `⏎···············`                                                                                                                                                                                                                                                                  prettier/prettier
  2139:76  error    Insert `⏎·······`                                                                                                                                                                                                                                                                          prettier/prettier
  2140:1   error    Insert `··`                                                                                                                                                                                                                                                                                prettier/prettier
  2141:9   error    Insert `··`                                                                                                                                                                                                                                                                                prettier/prettier
  2142:9   error    Insert `··`                                                                                                                                                                                                                                                                                prettier/prettier
  2143:1   error    Insert `··`                                                                                                                                                                                                                                                                                prettier/prettier
  2144:11  error    Insert `··`                                                                                                                                                                                                                                                                                prettier/prettier
  2145:9   error    Insert `··`                                                                                                                                                                                                                                                                                prettier/prettier
  2146:1   error    Insert `··`                                                                                                                                                                                                                                                                                prettier/prettier
  2184:52  error    Insert `⏎·······`                                                                                                                                                                                                                                                                          prettier/prettier
  2237:82  error    Replace `·?·'connected'` with `⏎··········?·'connected'⏎·········`                                                                                                                                                                                                                         prettier/prettier
  3042:36  error    Replace `ringingPreviewStreamRef.current?.toURL()·??·null` with `(ringingPreviewStreamRef.current?.toURL()·??·null)`                                                                                                                                                                       prettier/prettier
  3081:79  error    Replace `setupToken,·joined.callId` with `⏎··········setupToken,⏎··········joined.callId,⏎········`                                                                                                                                                                                        prettier/prettier
  3342:7   error    Replace `|·(MediaStreamTrack·&·{·_switchCamera?:·()·=>·void·})⏎·····` with `(MediaStreamTrack·&·{·_switchCamera?:·()·=>·void·})`                                                                                                                                                           prettier/prettier
  3390:6   error    Replace `activateLocalVideo,·clearRemoteVideoRuntime,·deactivateLocalVideo,·ensureCameraPermission,·presentError` with `⏎······activateLocalVideo,⏎······clearRemoteVideoRuntime,⏎······deactivateLocalVideo,⏎······ensureCameraPermission,⏎······presentError,⏎····`                      prettier/prettier
  3701:12  error    Replace `·remoteStream?.removeTrack(consumer.track·as·unknown·as·MediaStreamTrack)` with `⏎········remoteStream?.removeTrack(consumer.track·as·unknown·as·MediaStreamTrack)⏎·····`                                                                                                         prettier/prettier
  3701:94  error    Empty block statement                                                                                                                                                                                                                                                                      no-empty
  3702:12  error    Replace `·consumer.close()` with `⏎········consumer.close()⏎·····`                                                                                                                                                                                                                         prettier/prettier
  3702:38  error    Empty block statement                                                                                                                                                                                                                                                                      no-empty
  3815:29  warning  The ref value 'callSocketPromisesRef.current' will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by React, copy 'callSocketPromisesRef.current' to a variable inside the effect, and use that variable in the cleanup function  react-hooks/exhaustive-deps

✖ 63 problems (57 errors, 6 warnings)
  51 errors and 0 warnings potentially fixable with the `--fix` option.

 ELIFECYCLE  Command failed with exit code 1.
```
