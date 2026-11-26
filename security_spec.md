# Security Specification — STD / UMH Wire Harness Studio

## 1. Data Invariants
1. **Verified Identity**: Every read/write requires `request.auth != null && request.auth.token.email_verified == true`.
2. **Strict PII Isolation + Shared Team Workspace**:
   - `users/{userId}` is strictly keyed to `request.auth.uid`, with `list` disabled (`false`) and `delete` disabled (`false`).
   - `masterConfigs/shared` (plus legacy read/write fallback for `masterConfigs/{uid}`), `assyRecords/{recordId}`, `refreshHistory/{historyId}`, and `recycleBin/{itemId}` are shared across all verified Google accounts so team members synchronize to the same database.
3. **Immutable Audit, Attribution & Soft-Delete Snapshots**:
   - `id`, `uid`, `ownerId`, `createdByUid` (once set), and `createdAt` can never be altered on `update`.
   - `ownerId == request.auth.uid` is enforced on every `create`; `updatedByUid == request.auth.uid` is enforced whenever `updatedByUid` is written.
   - `refreshHistory` and `recycleBin` entries are immutable snapshots (`update: if false`).
4. **Temporal Integrity**: `createdAt`, `updatedAt`, `refreshedAt`, and `deletedAt` must equal `request.time` on creation/update as applicable.
5. **Volumetric & Schema Enforcement**: All IDs match `^[a-zA-Z0-9_-]+$` (1–128 chars), every string has explicit `.size()` bounds, every array has `.size() <= MAX` and first-element type validation, and every write validates exact keys via `hasAll` + `hasOnly` (and `affectedKeys().hasOnly(...)` on update).

## 2. Adversarial Payloads (All MUST Fail with PERMISSION_DENIED)
1. **Unauthenticated read/write** to `assyRecords/any` or `recycleBin/any` (`request.auth == null`).
2. **Unverified email token** (`email_verified == false`) attempting any read/write.
3. **Cross-tenant PII read**: User B calling `get` on `users/{userA}` or `list` on `users` / `masterConfigs`.
4. **Identity spoofing on create**: User A creating `assyRecords/rec1`, `refreshHistory/h1`, or `recycleBin/bin1` with `ownerId: userB` or `createdByUid: userB`.
5. **Updater spoofing**: User A updating `assyRecords/rec1` or `masterConfigs/shared` with `updatedByUid: userB`.
6. **Shadow field injection**: Creating any document with undeclared fields such as `isAdmin: true`.
7. **Immutable attribution/owner tampering**: Updating `assyRecords/{id}` to alter `ownerId`, `id`, `createdByUid`, or `createdAt`.
8. **Timestamp tampering**: Creating or updating a document with a forged client timestamp instead of `request.time`.
9. **ID poisoning**: Writing to `assyRecords/{150-char-or-special-char-id}` or `recycleBin/{bad/id}`.
10. **Array overflow / type poisoning**: Writing `masterConfigs/shared` with `autoCutList.size() > 2000`, `params.size() > 300`, or `params: ["not-a-map"]`.
11. **Immutable snapshot mutation**: Attempting `update` on an existing `refreshHistory/{id}` or `recycleBin/{id}` document.
12. **Enum / string overflow**: Creating `recycleBin/{id}` with unknown `itemType` / `originalCollection` or oversized `title` / `subtitle`.
