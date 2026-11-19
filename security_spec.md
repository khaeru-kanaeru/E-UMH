# Security Specification — STD / UMH Wire Harness Studio

## 1. Data Invariants
1. **Verified Identity**: Every read/write requires `request.auth != null && request.auth.token.email_verified == true`.
2. **Strict Ownership Isolation**:
   - `users/{userId}` and `masterConfigs/{userId}` are strictly keyed to `request.auth.uid`, with `list` disabled (`false`) and `delete` disabled (`false`).
   - `assyRecords/{recordId}` and `refreshHistory/{historyId}` store immutable `ownerId == request.auth.uid`; both `get` and `list` enforce `resource.data.ownerId == request.auth.uid`.
3. **Immutable Audit & Identity Fields**: `id`, `uid`, `ownerId`, and `createdAt` can never be altered on `update`. `refreshHistory` is append-only (`update: if false`).
4. **Temporal Integrity**: `createdAt` and `updatedAt` (and `refreshedAt` on `refreshHistory`) must equal `request.time`.
5. **Volumetric & Schema Enforcement**: All IDs match `^[a-zA-Z0-9_-]+$` (1–128 chars), every string has explicit `.size()` bounds, every array has `.size() <= MAX` and first-element type validation, and every write validates exact keys via `hasAll` + `hasOnly` (and `affectedKeys().hasOnly(...)` on update).

## 2. The "Dirty Dozen" Adversarial Payloads (All MUST Fail with PERMISSION_DENIED)
1. **Unauthenticated read/write** to `assyRecords/any` (`request.auth == null`).
2. **Unverified email token** (`email_verified == false`) attempting to create `users/{uid}`.
3. **Cross-tenant PII read**: User B calling `get` on `users/{userA}`.
4. **Blanket collection scrape**: Calling `list` on `users` or `masterConfigs`, or querying `assyRecords` without `where('ownerId', '==', uid)`.
5. **Identity spoofing on create**: User A creating `assyRecords/rec1` with `ownerId: userB`.
6. **Shadow field injection**: Creating `users/{uid}` with extra field `isAdmin: true`.
7. **Owner reassignment on update**: Updating `assyRecords/{id}` to change `ownerId` or `id`.
8. **CreatedAt tampering**: Creating or updating a document with a forged client timestamp instead of `request.time`.
9. **ID poisoning**: Writing to `assyRecords/{150-char-or-special-char-id}`.
10. **Array overflow / type poisoning**: Writing `masterConfigs/{uid}` with `autoCutList.size() > 2000` or `autoCutList: ["not-a-map"]`.
11. **History mutation**: Attempting `update` on an existing `refreshHistory/{id}` audit log.
12. **String overflow**: Writing `assyNo` longer than 120 chars or `photoURL` longer than 1000 chars.
