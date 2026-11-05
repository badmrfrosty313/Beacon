# BEACON Network: Offline-capable private messaging

**Status:** Proposal and high-priority research track, not implemented or security-reviewed.
**Decision owner:** BEACON product owner.
**Prepared:** 2026-11-04.
**See:** [ARCHITECTURE.md](../ARCHITECTURE.md) and [ROADMAP.md](../ROADMAP.md).

## Purpose

Enable **person-to-person encrypted messaging** between two BEACON users even when neither device has internet service. BEACON must remain a functional offline knowledge/reference application if messaging is unavailable. This is separate from the owner's one-to-many **Dispatch** publishing feed and from Seed's public knowledge packs.

**Important physical constraint:** "No internet required" is not "no connection required." Sending still needs a feasible link (direct local connectivity, a radio transport, physically carried file, or intermediaries that later exchange data). A peer who never meets any reachable path cannot receive a message. State queued, pending, received and verified distinctly. Do not promise immediate or guaranteed delivery.

## Design principles

1. **Independent installations:** A user's content, keys, contacts and conversations are theirs. No centralized account, BEACON service, cloud sync or required telemetry for core messaging.
2. **Cryptography is not invented here:** Select a mature, independently reviewed E2EE design and implementations. A transport must never get private key material or plaintext. Do not roll a homegrown key exchange, encryption, ratchet, handshake, or routing security layer.
3. **Verify peers:** Exchange and verify public-key identity fingerprints out of band (for example scanning a QR code in person). Key changes must be conspicuous, never silently substituted.
4. **Transport-agnostic envelopes:** Encryption/authentication/validation above a replaceable transport adapter; use explicit versioning, recipient identity, unique message ID, expiry and bounds as justified by the protocol. Never confuse transport authentication with actual end-to-end identity.
5. **Local-first UX:** Queue outbound encrypted messages without a connection. Explicitly report when they leave the device and what delivery, if any, was actually acknowledged. The interface must clearly distinguish *queued*, *transmitted*, *delivered* and *read*.
6. **No private/public leakage:** Public installers, Scripture content, optional public knowledge packs, public Dispatch, bug reports and telemetry must never include private contacts, key material or conversations by default.
7. **Conservative claims:** E2EE does not by itself conceal metadata, protect lost/unlocked devices, prevent traffic analysis or guarantee that a peer is who they claim without verification.

## Layer sketch

```text
User-to-user conversation UI (opt-in)
       |
Verified contacts and device identity
       |
Reviewed E2EE session/protocol + local key management
       |
Authenticated, versioned message envelope + replay protections
       |
Outbound/inbound queue, validation, rate/size limits
       |
Transport adapters
  - local file/USB or QR transfer (first low-risk feasibility candidate)
  - local network / direct Wi-Fi
  - Android Bluetooth or nearby-device APIs (device-specific permissions)
  - later: relay/store-and-forward, supported external radio gateway
```

A relay or transport can carry ciphertext; it is not trusted to attest recipient identity or decrypt contents. Key storage, secure erasure and OS protection must be evaluated separately on Windows and Android. No design choice here is an assurance that storage encryption currently exists.

## Delivery paths and feasibility

| Path | Internet needed? | Other precondition | Status |
| --- | --- | --- | --- |
| Local file / USB exchange | No | People or devices physically transfer the encrypted envelope | Design candidate; simplest to validate first |
| Same LAN / Wi-Fi Direct | No internet | Common local network or verified peer-to-peer Wi-Fi connection | Research and platform tests required |
| Bluetooth | No | Nearby compatible radios, pairing/discovery permissions and working native APIs | Android + Windows feasibility to prove separately |
| Delay-tolerant forwarding | No internet in principle | Other carriers/relays eventually connect to both endpoints | Future research; reliability, spam and metadata concerns |
| LoRa/Meshtastic gateway | No internet in principle | Additional compatible hardware, radio path, regulatory compliance, payload/airtime budget | Future integration research, not built-in range |

Avoid assuming the browser demo can supply the same native proximity capabilities as a Tauri Windows/Android build. Browser support requires separate capability and permission review.

## Threat model: initial questions

| Threat | Required design response to evaluate |
| --- | --- |
| False contact / substituted public key | In-person fingerprint or QR verification; visible key-change warnings |
| Intercepted/transit-modified ciphertext | Authenticated encryption and message-integrity checks from a reviewed protocol |
| Replay, duplication, reordered/stale messages | Protocol-specific replay protection, bounded identifiers, expirations and UX |
| Lost, stolen or unlocked device | Evaluate OS-backed secret storage, local database encryption, lock and recovery practices |
| Compromised endpoint | Explicitly state that messages on a compromised or unlocked endpoint can be exposed |
| Metadata exposure | Minimize retained metadata; assess discovery broadcasts, contacts, timing and radio proximity |
| Relay abuse / spam / storage exhaustion | Limits, peer consent, deduplication, expiration, blocking and bounded queues |
| Key loss and reinstall | Secure recovery design with no unverified auto-restoration or silent identity replacement |
| Public release leakage | CI/packaging checks exclude personal user data, keys, contacts and message histories |

## First feasibility spike (N-001 / N-002)

Conduct this as **separate engineering/research work**, without interrupting active Sprint 003 or weakening the offline-only app's security restrictions.

Deliver:
- A realistic two-device user story for Windows-to-Windows and Windows-to-Android.
- A reviewed list of candidate libraries/protocols, their maintenance/licensing, key-storage and platform compatibility; explicitly choose or reject candidates.
- A practical transport decision for the first proof of concept; local file/USB exchange is the initial default, not a permanent mandate.
- A threat model covering contact impersonation, metadata, endpoint compromise, replay, spam and local persistence.
- A list of new Tauri/Android permissions/network dependencies, if any, and how they stay opt-in.
- A test plan proving **no internet** is required for the chosen direct path, plus controlled tampering, wrong recipient, key rotation, replay, crash/restart and offline queue tests.
- An owner-facing decision record (ADR) and a go/no-go gate **before** integrating code into BEACON.

## Future proof-of-concept acceptance (N-003)

On two test installations, an operator can create local identities; verify each other's fingerprints; prepare a message without internet; physically deliver its encrypted envelope using the chosen transport; and decrypt only on the recipient device. Corruption, replay and wrong-recipient cases must be rejected. The receiving app must not describe messages as delivered until the transport or recipient provides the specified acknowledgment. Tests must inspect the actual persisted bytes and ensure no private plaintext/keys are unintentionally packaged or logged. No claim of a secure product before security review.

## Explicitly deferred

- General-purpose mesh networking and automatic routing.
- Radio hardware support or arbitrary long-distance delivery.
- Anonymous, untraceable or censorship-resistant communication guarantees.
- Multi-party chat, cross-device sync, large attachments or voice/video.
- A homegrown cryptographic protocol, improvised key management or a rushed public launch.
- Silent subscription/collection of contacts, GPS location or nearby devices.

**Priority note:** The research is urgent to evaluate, but security-critical production messaging must not bypass an independent review, threat-model gates, or device acceptance just to meet a calendar date.
