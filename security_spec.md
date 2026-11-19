# Security Specification — STD / UMH Wire Harness Studio

## 1. Data Invariants
1. **Verified Identity**: Every read/write requires `request.auth != null && request.auth.token.email_verified == true`.
2. **Strict Ownership Isolation**:
   - `users/{userId}` and `masterConfigs/{userId}` are strictly keyed to `request.auth.uid`, with `list` disabled (`false`) and `delete` disabled (`false`).
   - `assyRecords/{recordId}`, `refreshHistory/{historyId}`, and `recycleBin/{itemId}` store immutable `ownerId == request.auth.uid`; both `get` and `list` enforce `resource.data.ownerId == request.auth.uid`.
3. **Immutable Audit, Identity & Soft-Delete Snapshots**:
   - `id`, `uid`, `ownerId`, and `createdAt` can never be altered on `update`.
   - `refreshHistory` is append-only (`update: if false`).
   - `recycleBin` entries are immutable soft-delete snapshots (`update: if false`); users may only create (move to recycle bin), read/list their own items, or delete (on restore or explicit permanent deletion).
4. **Temporal Integrity**: `createdAt`, `updatedAt`, `refreshedAt`, and `deletedAt` must equal `request.time` on creation/update as applicable.
5. **Volumetric & Schema Enforcement**: All IDs match `^[a-zA-Z0-9_-]+$` (1–128 chars), every string has explicit `.size()` bounds, every array has `.size() <= MAX` and first-element type validation, and every write validates exact keys via `hasAll` + `hasOnly` (and `affectedKeys().hasOnly(...)` on update).

## 2. The "Dirty Dozen" Adversarial Payloads (All MUST Fail with PERMISSION_DENIED)
1. **Unauthenticated read/write** to `assyRecords/any` or `recycleBin/any` (`request.auth == null`).
2. **Unverified email token** (`email_verified == false`) attempting to create `users/{uid}` or `recycleBin/{id}`.
3. **Cross-tenant PII read**: User B calling `get` on `users/{userA}` or `recycleBin/{userAItem}`.
4. **Blanket collection scrape**: Calling `list` on `users` or `masterConfigs`, or querying `assyRecords` / `recycleBin` without `where('ownerId', '==', uid)`.
5. **Identity spoofing on create**: User A creating `assyRecords/rec1` or `recycleBin/bin1` with `ownerId: userB`.
6. **Shadow field injection**: Creating `users/{uid}` or `recycleBin/{id}` with extra field `isAdmin: true`.
7. **Owner reassignment on update**: Updating `assyRecords/{id}` to change `ownerId` or `id`.
8. **Timestamp tampering**: Creating or updating a document (`createdAt`, `updatedAt`, `deletedAt`, `refreshedAt`) with a forged client timestamp instead of `request.time`.
9. **ID poisoning**: Writing to `assyRecords/{150-char-or-special-char-id}` or `recycleBin/{bad/id}`.
10. **Array overflow / type poisoning**: Writing `masterConfigs/{uid}` with `autoCutList.size() > 2000`, `processDiscs.size() > 100`, or `processDiscs: ["not-a-map"]`.
11. **Immutable snapshot mutation**: Attempting `update` on an existing `refreshHistory/{id}` or `recycleBin/{id}` document.
12. **Enum / string overflow**: Creating `recycleBin/{id}` with unknown `itemType: "admin_drop"`, unknown `originalCollection`, or `title.size() > 160` / `subtitle.size() > 240`.
