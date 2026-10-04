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

## Money inputs (فواصل الآلاف)

Every money field (`data-money`) shows thousands separators while typing
(`1250000` -> `1,250,000`) and keeps the caret in place. The separators are
display only: `numberValue()` / `parseDecimal()` strip them, so storage,
Firestore and all calculations only ever see plain numbers. Quantity / liters
fields are not formatted.

## Fuel log

The fuel log (`fuelRecordsList`) is shown inside the fuel section of the car
page. Records are unchanged (`month.carExpenses`, `kind: "fuel"`); the
maintenance log below it shows the remaining car records.

## محفظتي (wallet)

Personal -> مصروف -> **محفظتي**: an independent card placed above
"المصروفات الأساسية" and styled exactly like the basic-expense cards. It is
collapsed by default and reveals only two options when tapped — **إيداع** and
**صرف** (no log and no big balance in the main view; the current balance is
shown inside the amount modal). A deposit adds to the balance, a withdraw
(never more than the balance) subtracts from it.

```
users/{uid}/meta/ledger.walletTransactions = [{ id, type: "deposit"|"withdraw", amount, date, monthKey }]
```

Stored in the existing ledger document (cumulative, never reset by a month
change). `monthKey` is the month the operation was made in: a deposit lowers
that month's available balance (المتبقي), a withdrawal gives it back.

## المواد المنزلية (home groceries)

Home -> مالي -> **المواد المنزلية** -> فواكه / خضروات / لحوم (لحم / دجاج /
سمك + أنواع جديدة) / مواد منزلية. Each purchase is a record in the existing
`month.homeExpenses` list:

```
{ id, kind: "grocery", group, subtype, title, quantity, unit, unitPrice, amount (= total), date, note }
```

so it is part of the home total / remaining automatically and syncs with no
schema change. Total = quantity x unit price.

Units: فواكه/خضروات default **كغم**؛ اللحوم كغم؛ المواد المنزلية
قطعة / علبة / كارتون / لتر / كغم / أخرى (with a free-text "أخرى"). The unit
price field uses the same thousands-separator formatter (`data-money`) as the
rest of the app.

### Tests

```
node tests/wallet-home.test.js   # logic: add / totals / sync
node tests/groceries-html.test.js # real index.html markup contract for this section
node tests/wallet.test.js        # محفظتي: بطاقة مستقلة + الفتح/الإغلاق + الإيداع/الصرف
```

## المرحلة الخامسة — فحص شامل (final audit)

`npm test` يشغّل كل الاختبارات:

```
sync · retry · car-parts · wallet-home · groceries-html · wallet · tasks · phase5-acceptance
```

`tests/phase5-acceptance.test.js` يفحص البنود 1-25 من المرحلة الخامسة عملياً:

- **المبالغ**: `1000 -> 1,000`، `100000 -> 100,000`، `1250000 -> 1,250,000` أثناء
  الكتابة، والحسابات تستخدم `numberValue`/`parseDecimal` (بدون فواصل)، والتخزين
  يحفظ **أرقاماً** (`typeof === "number"`) لا نصوصاً.
- **سجل البنزين**: داخل قسم البنزين (`fuelRecordsList`)، والسجلات القديمة تبقى،
  ولا يتكرر البنزين في سجل الصيانة.
- **المحفظة**: `500,000` ثم إيداع `100,000` ثم صرف `30,000` ← الرصيد `570,000`،
  والصرف بأكثر من الرصيد مرفوض برسالة **«رصيد المحفظة غير كافٍ.»**، والمحفظة
  تراكمية لا تُصفّر عند تغيير الشهر.
- **البيت**: `10,000 + 15,000 + 40,000 + 20,000 = 85,000`، واللحوم بلحم/دجاج/سمك،
  والإجماليات تدخل ضمن مصروف البيت مع بقاء المصاريف القديمة.
- **الجودة**: `node --check script.js` + تشغيل كل ملفات الاختبار للتأكد أنها تمر.

```
node tests/phase5-acceptance.test.js
```

## الادخار والمتبقي

**المتبقي = الدخل - المصروفات - صافي المحفظة - الادخار**

الادخار المخصوم يُحسب في مكان واحد فقط (`savingsReserved`) ويقرأه
`monthFinance()` وحده، فلا يحدث خصم مزدوج مهما أُعيد رسم الصفحة أو
أُعيد تحميلها:

| الحركة | التأثير على المتبقي |
|---|---|
| `deposit` (إيداع ادخار) | يُخصم |
| `withdraw` (سحب من الادخار) | يعود |
| `fromExpenses` | **مستثنى** — المبلغ أصلاً مصروف داخل `month.expenses`، فخصمه مرة أخرى يضاعف الخصم |
| `debtorPayment` | **مستثنى** — ليس من ميزانية الشخص |

الخصم **لكل شهر على حدة** (نظام الأشهر كما هو)، بينما رصيد الادخار
التراكمي يبقى تراكمياً كما كان.

```
node tests/savings-remaining.test.js
```

## سجل حركات الادخار

كل إيداع/سحب ادخار يُحفظ كحركة مستقلة في
`savingsLedger.transactions` ويظهر في السجل مع **النوع والمبلغ والتاريخ
والوقت**، مرتّباً **من الأحدث إلى الأقدم** (بالتاريخ ثم وقت الإضافة).

| النوع | التسمية |
|---|---|
| `deposit` | إيداع ادخار |
| `withdraw` | سحب من الادخار |
| `fromExpenses` | تحويل من المصروفات |
| `debtorPayment` | دفعة من مدين |

زر 🗑️ بجانب كل حركة يفتح نافذة تأكيد (إلغاء / حذف). عند التأكيد:

- تُحذف الحركة من `ledger.transactions` فقط.
- يُعاد حساب إجمالي الادخار، ويُعاد أثرها على المتبقي تلقائياً لأن
  `savingsReserved()` يقرأ نفس السجل.
- `commit()` يحدّث الواجهة والحفظ والمزامنة **فوراً بلا إعادة تحميل**.

```
node tests/savings-log.test.js
```

## فتح قفل الشهر السابق

شريط واحد في **أعلى التطبيق** (تحت شريط الشهر، وليس داخل أي قسم) يعرض
حالة الشهر السابق ويتيح فتحه:

| الحالة | العرض |
|---|---|
| الشهر السابق مغلق | `🔒 سبتمبر 2026 مغلق للتعديل` + زر **فتح سبتمبر 2026** |
| مفتوح | `🔓 سبتمبر 2026 مفتوح للتعديل` (الزر يختفي) |

**فقط الشهر السابق مباشرة** هو القابل للفتح، والفتح صالح لذلك الشهر
بالذات — لذلك:

- لا يمكن التخطي (أكتوبر لا يفتح أغسطس).
- الأشهر الأقدم تُقفل تلقائياً مع مرور الوقت.
- الشهر الحالي والمستقبل مفتوحان دائماً.

`isMonthClosed()` بقي المصدر الوحيد للحقيقة، ويقرأ حالة الفتح، فتتحرّك
كل عمليات القفل الموجودة (11 موضعاً) معه: الإضافة والحذف والتعديل
والادخار، والضغط المطول لم يعد مطلوباً بعد الفتح.

الفتح يغيّر **حالة القفل فقط** ولا يمس أي بيانات، ويُحفظ محلياً في
`database.unlockedMonths`.

```
node tests/month-unlock.test.js
```

