# CHANGE LOG

# 0.2.0 - Beta (Daemon v2)

    - Everything is changed to make Daemon simpler, faster, more flexible.
    - /message returns an observable that you can subscribe to for the message lifecycle.
    - types got an overhaul to support new features
    - the way daemon handles tools is done per tool rather than per server
    - MCPServer info is now just one method that returns all tools ("getDaemonServerInfo")

## 0.1.17 - 2025-01-23 5:44 PM

    - Took out embedding key from Daemon
    - Took out additional args from IHook

## 0.1.16 - 2025-01-21 5:04 PM

    - Modified system prompt to try and get it to hallucinate less
    - Took out embeddings from message lifecycle
    - Took out functions from IDaemonMCPServer (they should be added as serverTools not exposed functions)

## 0.1.15 - 2025-01-15 2:54 PM

    - Added hook system to daemon that allows you to run internal tools and hook back to servers

### 0.1.14 - 2025-01-15 2:00 PM

    - Added tools to message lifecycle
    - Added generated prompt to message lifecycle
    - Fixed sign method returning b64 of b64 bug
    - Added channelId to approval & checkApproval

### 0.1.13 - 2025-01-14 8:22 PM

    - Build moved to roll down with poly fills
    - Added sign method

### 0.1.12 - Initial Release
