# BEACON Security and Privacy Policy

BEACON is an early-stage project. **Do not use an unreleased build as your only emergency plan, sole backup, or sole copy of important records.** At present, the repository contains planning documents, not audited security software.

## Intended trust boundaries
- Imported Markdown, text, filenames, links, documents, and future web content are **untrusted**.
- Local data remains on the user's device by default; importing a document must not trigger upload to an AI or external service.
- External links and future source synchronization must be clear user actions.
- The public repository must not contain personal documents, secrets, credentials, private keys, or data from Project E that has not been approved for publication.

## Security requirements before First Light release
- Validate imports by size, format and path.
- Use OS-specific application data directories, least-privilege Tauri capabilities, and safe IPC commands.
- Do not execute imported HTML, scripts, macros or executable content.
- Use SQL parameters and migrations; prevent file path traversal.
- Archive import must reject malicious paths, corrupt checksums, oversized/decompression-bomb inputs and unsupported manifest versions.
- Validate backup restoration on a clean installation.
- Hash-based integrity checks do not prove that an archive came from a trusted publisher.
- No claims of encrypted storage, secure messaging, anonymity, censorship resistance or signature authentication until designed, implemented and independently tested.
- Keep logs free of imported private content and secrets.
- Support reliable user deletion and export once the data model exists.
- Review supply-chain dependencies and release artifacts.

## Reporting vulnerabilities
Until a private vulnerability reporting mechanism is configured, **do not publish exploit details or personal data in a public issue**. Contact the repository owner privately using a GitHub-supported private channel. Maintainers should enable GitHub Private Vulnerability Reporting in repository security settings before public distribution.

## Threats we consider
Untrusted imports, malicious archives, source tampering, unexpected outbound network access, corrupt local databases, lost devices, supply-chain compromise and false confidence in emergency instructions.

## Operational limitations
Offline functionality requires a working, charged device. Local peer sharing and radio are future experiments, not current functionality. Verification and source review remain a human responsibility.
