# Guildspace Security Specification (Phase 0)

## 1. Data Invariants
1. **PII Isolation**: User email addresses are stored exclusively in `/users/{userId}/private/{docId}` and are readable/writable only by `{userId}`. Public `/users/{userId}` profiles never contain email, phone, or private account fields.
2. **Identity Integrity**: On creation, `uid`, `authorId`, `ownerId`, `fromId`, `actorId`, or `createdBy` must equal `request.auth.uid`. Verified email (`request.auth.token.email_verified == true`) is required for all writes.
3. **Guild Master Gate**: Channel reads/writes, message reads/writes, and role reads require active membership in `/guilds/{guildId}/members/{request.auth.uid}`.
4. **Role & Privilege Escalation Prevention**: Users joining a guild can only create their own membership with `role == 'member'` (unless they are the guild `ownerId` creating initial ownership), and only `owner` or `admin` can promote/demote roles or create/delete channels and custom roles.
5. **Direct Message & Friendship Isolation**: `dmThreads`, `dmThreads/messages`, and `friendships` can only be read or written by users listed in `participants`.
6. **Temporal Integrity**: All `createdAt`, `updatedAt`, `joinedAt`, `lastSeenAt`, `lastMessageAt` timestamps must match `request.time`.
7. **Immutable Lineage**: `uid`, `ownerId`, `authorId`, `guildId`, `channelId`, `threadId`, and `createdAt` cannot be modified after creation.

## 2. Dirty Dozen Adversarial Payloads
1. **Shadow Field Injection on Profile**: Creating `/users/u1` with an extra `isAdmin: true` field -> MUST FAIL (`keys().hasOnly(...)`).
2. **PII Leak Attempt**: Signed-in user `u2` attempting `get /users/u1/private/account` -> MUST FAIL (`isOwner(userId)`).
3. **Self-Promotion in Guild**: User `u2` joining `/guilds/g1/members/u2` with `role: 'owner'` when `g1.ownerId != 'u2'` -> MUST FAIL.
4. **Private Guild Join Without Invite Code**: User `u2` joining private guild `g1` with wrong `inviteCodeUsed` -> MUST FAIL.
5. **Channel Message Spoofing**: Member `u2` posting a message with `authorId: 'u1'` -> MUST FAIL.
6. **Unauthenticated / Non-Member Channel Snooping**: Non-member `u3` reading `/guilds/g1/channels/c1/messages` -> MUST FAIL.
7. **Privilege Escalation Update**: Regular `member` `u2` updating `/guilds/g1/members/u2` to `role: 'admin'` -> MUST FAIL.
8. **Channel Creation by Regular Member**: Regular `member` `u2` creating `/guilds/g1/channels/c99` -> MUST FAIL.
9. **1MB String Resource Poisoning**: Member posting a channel message with `content` of 10,000 chars (`> 2000`) -> MUST FAIL.
10. **ID Poisoning**: Creating document with 300-char invalid ID containing spaces or slashes -> MUST FAIL (`isValidId`).
11. **DM Thread Eavesdropping**: User `u3` reading `/dmThreads/u1_u2/messages/m1` -> MUST FAIL (`!(u3 in participants)`).
12. **Backdated Timestamp Spoofing**: Creating a message with client-fabricated `createdAt` in the past -> MUST FAIL (`incoming().createdAt == request.time`).
