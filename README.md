# daftari

PWA personal life organizer (Arabic, RTL).

## Sections

Car page sections:

- **fuel ⛽** — liters + price per liter + date.
- **الزيوت والفلاتر والبطارية** — three kinds of records, each one keeps
  its own type / price / date inside the month log:
  - 🛢️ **الزيوت** — type (e.g. زيت محرك 10W-40), quantity (لتر), price, date.
  - 🔧 **الفلاتر** — filter type, price, date.
  - 🔋 **البطارية** — battery type, price, date.
- **maintenance 🔧** — free-form car expense.

Old records (created before this split) are untouched: they are matched by
`kind` (`oil` / `filter` / `battery`) and still show up inside the month log.

## Tasks section (المهام)

The tasks section appears in both the personal page (**مهامي الشخصية**) and
the home page (**مهام البيت**). Each list has:

- **Summary cards** — كل المهام / مهام اليوم / المتأخرة / قيد التنفيذ /
  المكتملة. Numbers update automatically; tapping a card filters the list and
  tapping it again clears the filter.
- **Quick search** (name + notes) and **filters** for الحالة / الأولوية /
  التصنيف / التاريخ. All filters combine (e.g. البيت + عالية + غير مكتملة).
- **Auto ordering** (view only, never changes saved data):
  1) overdue, 2) high/urgent priority, 3) today, 4) upcoming by date,
  5) no date, 6) completed (always last).
- **Priority**: منخفضة / متوسطة / عالية / عاجلة.
- **Status**: جديدة / قيد التنفيذ / مكتملة (changed from the list itself).
  Completing a task keeps it — reopen it any time.
- **Category**: البيت / العمل / السيارة / شخصي / مشتريات / مواعيد / أخرى.
- **Due date + time**, shown as اليوم / غدًا / a specific date / متأخرة.
- **Task card**: name, then تصنيف | أولوية | تاريخ | حالة, a short note
  preview, and quick actions (إكمال / تعديل / حذف). Delete asks for
  confirmation so a stray tap never removes a task.

### Data compatibility

Tasks are still stored per month in the same place:

```
month.tasks = [{ id, listKey, title, note, date, time, priority, category, status, done }]
```

Every new field is optional and read with a safe default, so tasks created by
older versions (`{ id, listKey, title, note, done, date }`) keep working and are
never rewritten just by opening the page. `done` stays in sync with
`status` (`completed`).

## Firebase sync (everything)

All app data is stored per user account in **Firebase Firestore**:

```
users/{uid}/months/{YYYY-MM}   month: settings + expenses + car (fuel / oils /
                               filters / battery / maintenance) + home
                               expenses + tasks
users/{uid}/meta/ledger        cumulative savings: transactions + debtors
users/{uid}/carMonths/...      OLD car-only documents (read once, migrated)
```

`localStorage` stays as an offline cache only — nothing is deleted on
logout, and existing local data is migrated to the account on the first
sign-in. Car data saved by the previous version (`carMonths`) is merged in
automatically. The light/dark theme stays local to each device.

Conflicts: the latest edit wins per document (month / ledger). A document
this device never synced before is merged (union by record id) instead, so
nothing is lost on first sign-in from a second device.

### One-time setup

1. Paste your `firebaseConfig` into **`firebase-config.js`**
   (project `daftari-27563` values are already pre-filled; only
   `apiKey` — plus optional `appId` / `messagingSenderId` — are needed).
2. Firebase Console → **Authentication → Sign-in method → Email/Password → Enable**.
3. Deploy the rules from `firestore.rules`:
   `firebase deploy --only firestore:rules`
   (or paste the file into Firebase Console → Firestore → Rules).

Until the config is filled in, the app runs in **local-only mode** and
keeps working normally (status shows ⚙️ وضع محلي).

### UI

- 👤 button in the header → sign in / create account / sync now / sign out.
- Sync status line under the greeting: `💾 محلي` → `⏳ جارٍ المزامنة` → `✅ مزامن مع الحساب`.

### Tests

```
node tests/sync.test.js
node tests/car-parts.test.js
node tests/tasks.test.js
```

`sync.test.js` covers every section (month expenses, car, home, tasks,
settings, savings ledger): migration of existing data, save, restore on a
fresh device, logout/login, live propagation between devices, union merge
for never-synced devices, migration of the old `carMonths` documents, and
Arabic auth error messages.

`car-parts.test.js` covers the **الزيوت والفلاتر والبطارية** section:
the three record forms (type / quantity for oils / price / date), saving each
record with its date inside the month log, per-kind totals, ordering by date,
reload persistence, and that legacy records are never dropped.

`tasks.test.js` covers the **قسم المهام**: safe defaults for legacy tasks,
overdue / today / tomorrow detection, the five summary cards, combined
search + filters, the automatic display order, add / edit without losing any
field, complete / reopen, delete with confirmation, rendered markup, saving to
`localStorage`, and that both task lists (personal + home) work.

Files: `firestore-sync.js` (sync module), `firebase-config.js` (config),
`tests/fake-firebase.js` (in-memory Firebase stub),
`tests/car-parts.test.js` and `tests/tasks.test.js` (UI tests with a minimal
fake DOM).