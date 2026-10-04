/* =========================================================
   DAFTARI - Firebase Sync (Authentication + Firestore)

    يُزامَن كل بيانات التطبيق مع حساب المستخدم:

        users/{uid}/months/{YYYY-MM}
            الإعدادات + المصاريف الشخصية + مصاريف البيت
            + السيارة (بنزين/زيت/فلاتر/بطارية/صيانة) + المهام

        users/{uid}/meta/ledger
            حساب الادخار التراكمي (الحركات + المدينون)

        users/{uid}/carMonths/{YYYY-MM}
            (قديم) بيانات السيارة من النسخة السابقة - تُقرأ
            مرة لدمجها تلقائياً ولا يُكتب فيها بعد الآن.

    القواعد:
        - localStorage يبقى كذاكرة مؤقتة (Offline cache).
          لا تُحذف أي بيانات موجودة.
        - عند أول تسجيل دخول تُرفع البيانات المحلية القائمة
          (Migration) وتُدمج بأمان مع أي بيانات موجودة في الحساب.
        - التعديل الأحدث يفوز (Last-Write-Wins)، وإذا كان
          المستند لم يُزامَن من قبل تتم عملية دمج (Union) حتى
          لا تضيع أي سجلات من أي جهاز.
        - المظهر (فاتح/داكن) يبقى محلياً لكل جهاز.
========================================================= */

"use strict";

(function (global) {

    const USERS_COLLECTION = "users";
    const MONTHS_COLLECTION = "months";
    const META_COLLECTION = "meta";
    const LEGACY_CAR_COLLECTION = "carMonths";
    const LEDGER_DOC = "ledger";
    const LEDGER_KEY = "ledger";
    const PUSH_DEBOUNCE_MS = 350;
    const MAX_BATCH_SIZE = 400;

    const PLACEHOLDER_MARKERS = ["YOUR_", "PASTE_"];

    /* ---------------------------------------------------------
       BOUND CALLBACKS (supplied by the app)
    --------------------------------------------------------- */

    let bound = {
        getDatabase: null,
        createMonth: null,
        defaultSettings: null,
        defaultFuelBudget: null,
        persistLocal: null,
        onStatus: null,
        onAuthChange: null,
        onRemoteChange: null
    };

    /* ---------------------------------------------------------
       FIREBASE HANDLES
    --------------------------------------------------------- */

    let config = null;
    let firebaseApp = null;
    let auth = null;
    let db = null;

    /* ---------------------------------------------------------
       SYNC STATE
    --------------------------------------------------------- */

    let status = {
        configured: false,
        signedIn: false,
        email: "",
        phase: "local",
        message: ""
    };

    // `${uid}::${key}` -> JSON of what the cloud holds (per account)
    const syncedCache = new Map();

    // key -> JSON of local content (without updatedAt)
    const contentCache = new Map();

    // key -> payload waiting to be written to the cloud
    const pendingPush = new Map();

    let pushTimer = null;
    let flushChain = Promise.resolve();
    let pullChain = Promise.resolve();
    let unsubSnapshots = [];

    let retryTimer = null;
    let retryAttempts = 0;
    const RETRY_BASE_MS = 5000;
    const RETRY_MAX_MS = 300000;

    /* =========================================================
       SMALL HELPERS
    ========================================================= */

    function getStatus() {
        return Object.assign({}, status);
    }

    function emitStatus(patch) {
        status = Object.assign({}, status, patch);

        if (typeof bound.onStatus === "function") {
            try {
                bound.onStatus(getStatus());
            } catch (error) {
                console.error("Daftari sync status error:", error);
            }
        }
    }

    function notifyAuthChange(user) {
        if (typeof bound.onAuthChange === "function") {
            try {
                bound.onAuthChange(user);
            } catch (error) {
                console.error("Daftari auth change error:", error);
            }
        }
    }

    function notifyRemoteChange() {
        if (typeof bound.onRemoteChange === "function") {
            try {
                bound.onRemoteChange();
            } catch (error) {
                console.error("Daftari remote change error:", error);
            }
        }
    }

    function persistLocal() {
        if (typeof bound.persistLocal === "function") {
            try {
                bound.persistLocal();
            } catch (error) {
                console.error("Daftari persist error:", error);
            }
        }
    }

    function getDatabase() {
        if (typeof bound.getDatabase !== "function") {
            return null;
        }

        try {
            return bound.getDatabase();
        } catch (error) {
            console.error("Daftari database error:", error);
            return null;
        }
    }

    function isConfigured() {
        if (!config) {
            config = global.FIREBASE_CONFIG || null;
        }

        if (!config || typeof config !== "object") {
            return false;
        }

        if (!config.apiKey || !config.projectId) {
            return false;
        }

        const apiKey = String(config.apiKey);

        return !PLACEHOLDER_MARKERS.some((marker) => apiKey.indexOf(marker) !== -1);
    }

    function authErrorText(error) {
        const code = (error && error.code) || "";

        const messages = {
            "auth/invalid-email": "البريد الإلكتروني غير صحيح",
            "auth/missing-password": "أدخل كلمة المرور",
            "auth/weak-password": "كلمة المرور ضعيفة (6 أحرف على الأقل)",
            "auth/wrong-password": "كلمة المرور غير صحيحة",
            "auth/invalid-credential": "بيانات الدخول غير صحيحة",
            "auth/user-not-found": "لا يوجد حساب بهذا البريد",
            "auth/email-already-in-use": "هذا البريد مسجّل مسبقاً",
            "auth/too-many-requests": "محاولات كثيرة — حاول لاحقاً",
            "auth/network-request-failed": "تعذّر الاتصال بالشبكة",
            "auth/user-disabled": "هذا الحساب معطّل",
            "auth/configuration-not-found":
                "لم يُفعَّل تسجيل الدخول في Firebase — فعّل Email/Password",
            "auth/internal-error":
                "Authentication غير مهيّأ في Firebase — فعّل Email/Password",
            "auth/operation-not-allowed": "تسجيل الدخول بالبريد غير مفعّل في Firebase"
        };

        return messages[code] || (error && error.message) || "تعذّر إتمام العملية";
    }

    function dbErrorText(error) {
        const code = (error && error.code) || "";

        const messages = {
            "permission-denied": "صلاحيات Firestore مرفوضة — راجع قواعد الحماية",
            "unauthenticated": "انتهت جلسة الدخول — سجّل الدخول من جديد",
            "unavailable": "تعذّر الوصول إلى Firestore (بدون اتصال؟)",
            "failed-precondition": "تعذّر تجهيز Firestore",
            "not-found":
                "قاعدة Firestore غير موجودة — أنشئها من الكونسول (Native mode)",
            "already-exists": "تعارض في قاعدة Firestore — راجع إعدادات المشروع"
        };

        return messages[code] || (error && error.message) || "خطأ غير معروف في Firestore";
    }

    /* Detailed error logging for Firebase operations.
       Logs operation name, error code, message, Firestore path and UID
       to console.error for easy diagnosis. */
    function logFirebaseError(operation, error, uid, path) {
        const err = error || {};
        const code = err.code || "unknown";
        const message = err.message || String(err);
        const uidLog = uid ? uid : "n/a";
        const pathLog = path ? path : "n/a";

        console.error(
            `[Daftari Firebase] ${operation} — code: ${code}, path: ${pathLog}, uid: ${uidLog}, message: ${message}`,
            err
        );
    }

    /* Returns the full Firestore document path for a key, for logging. */
    function docPathFor(uid, key) {
        const col = key === LEDGER_KEY ? META_COLLECTION : MONTHS_COLLECTION;
        const docId = key === LEDGER_KEY ? LEDGER_DOC : key;

        return `users/${uid}/${col}/${docId}`;
    }

    /* Remove `undefined` values - Firestore rejects them. */
    function sanitize(value) {
        if (Array.isArray(value)) {
            return value.map((item) => sanitize(item));
        }

        if (value && typeof value === "object") {
            const output = {};

            Object.keys(value).forEach((key) => {
                if (value[key] === undefined) {
                    return;
                }

                output[key] = sanitize(value[key]);
            });

            return output;
        }

        return value;
    }

    function splitKey(key) {
        const parts = String(key).split("-");

        return {
            year: Number(parts[0]),
            month: Number(parts[1]) - 1
        };
    }
    function currentUser() {
        return auth && auth.currentUser ? auth.currentUser : null;
    }

    function getUser() {
        const user = currentUser();

        if (!user) {
            return null;
        }

        return {
            uid: user.uid,
            email: user.email || ""
        };
    }

    function cacheKey(uid, key) {
        return `${uid}::${key}`;
    }

    /* =========================================================
       PURE DATA HELPERS
       No Firebase dependency - these are unit tested in Node.

       Synced documents (one "payload" each):

         month  "YYYY-MM"  ->  users/{uid}/months/{YYYY-MM}
                { kind, year, month, settings, expenses,
                  carExpenses, homeExpenses, tasks, updatedAt }

         ledger "ledger"   ->  users/{uid}/meta/ledger
                { kind, transactions, debtors, updatedAt }
                (the cumulative savings account + debtors)
    ========================================================= */

    const MONTH_LIST_FIELDS = ["expenses", "carExpenses", "homeExpenses", "tasks"];
    const LEDGER_LIST_FIELDS = ["transactions", "debtors"];

    function isMonthKey(key) {
        return /^[0-9]{4}-[0-9]{2}$/.test(String(key));
    }

    function cleanList(list) {
        return Array.isArray(list)
            ? list.filter((record) => record && typeof record === "object")
            : [];
    }

    function cloneList(list) {
        return cleanList(list).map((record) => sanitize(record));
    }

    function cleanSettings(settings) {
        const output = {};

        if (settings && typeof settings === "object") {
            Object.keys(settings).forEach((key) => {
                const value = settings[key];

                if (
                    typeof value === "number" ||
                    typeof value === "string" ||
                    typeof value === "boolean"
                ) {
                    output[key] = value;
                }
            });
        }

        return output;
    }

    function getDefaults() {
        if (bound.defaultSettings && typeof bound.defaultSettings === "object") {
            return bound.defaultSettings;
        }

        if (typeof bound.defaultFuelBudget === "number") {
            return { fuelBudget: bound.defaultFuelBudget };
        }

        return {};
    }

    function stampOf(value) {
        return typeof value === "number" && value > 0 ? value : 0;
    }

    function makeMonthPayload(fields) {
        return {
            kind: "month",
            year: typeof fields.year === "number" ? fields.year : 0,
            month: typeof fields.month === "number" ? fields.month : 0,
            settings: cleanSettings(fields.settings),
            expenses: cleanList(fields.expenses),
            carExpenses: cleanList(fields.carExpenses),
            homeExpenses: cleanList(fields.homeExpenses),
            tasks: cleanList(fields.tasks),
            updatedAt: stampOf(fields.updatedAt)
        };
    }

    function makeLedgerPayload(fields) {
        return {
            kind: "ledger",
            transactions: cleanList(fields.transactions),
            debtors: cleanList(fields.debtors),
            updatedAt: stampOf(fields.updatedAt)
        };
    }

    function makePayload(key, fields) {
        if (key === LEDGER_KEY) {
            return makeLedgerPayload(fields || {});
        }

        const parts = splitKey(key);
        const input = fields || {};

        return makeMonthPayload(Object.assign({}, input, {
            year: typeof input.year === "number" ? input.year : parts.year,
            month: typeof input.month === "number" ? input.month : parts.month
        }));
    }

    function normalizePayload(raw, key) {
        return makePayload(key, raw || {});
    }

    /* Old documents (users/{uid}/carMonths) held car data only. */
    function normalizeLegacyCar(raw, key) {
        const data = raw || {};

        return makePayload(key, {
            year: data.year,
            month: data.month,
            carExpenses: data.carExpenses,
            settings: typeof data.fuelBudget === "number"
                ? { fuelBudget: data.fuelBudget }
                : {},
            updatedAt: data.carUpdatedAt
        });
    }

    function payloadJson(payload) {
        return JSON.stringify(payload);
    }

    /* Content without the sync timestamp - used to detect real edits. */
    function contentJson(payload) {
        return JSON.stringify(Object.assign({}, payload, { updatedAt: undefined }));
    }

    function withStamp(payload, stamp) {
        return Object.assign({}, payload, { updatedAt: stamp });
    }

    function stampPayload(payload) {
        return stampOf(payload.updatedAt)
            ? payload
            : withStamp(payload, Date.now());
    }

    function recordKey(record) {
        if (record.id === undefined || record.id === null) {
            return "json|" + JSON.stringify(record);
        }

        return [
            record.id,
            record.kind || "",
            record.date || "",
            record.amount == null ? "" : record.amount
        ].join("|");
    }

    function monthHasContent(month, defaults) {
        const hasRecords = MONTH_LIST_FIELDS.some(
            (field) => Array.isArray(month[field]) && month[field].length > 0
        );

        if (hasRecords) {
            return true;
        }

        const settings = cleanSettings(month.settings);

        return Object.keys(settings).some((key) =>
            !Object.prototype.hasOwnProperty.call(defaults, key) ||
            settings[key] !== defaults[key]
        );
    }

    /*
        Snapshot of every syncable value, keyed by month + "ledger".

        A month is included when it has any record, when a setting
        was customised, or when it was synced/edited before
        (updatedAt). The savings ledger is included when it has
        transactions/debtors or was synced before.
    */
    function collectData(database, defaultSettings) {
        const output = {};

        if (!database || typeof database !== "object") {
            return output;
        }

        const defaults = defaultSettings || {};

        if (database.months && typeof database.months === "object") {
            Object.keys(database.months).forEach((key) => {
                const month = database.months[key];

                if (!isMonthKey(key) || !month || typeof month !== "object") {
                    return;
                }

                const updatedAt = stampOf(month.updatedAt);

                if (!updatedAt && !monthHasContent(month, defaults)) {
                    return;
                }

                const parts = splitKey(key);

                output[key] = makeMonthPayload({
                    year: typeof month.year === "number" ? month.year : parts.year,
                    month: typeof month.month === "number" ? month.month : parts.month,
                    settings: month.settings,
                    expenses: month.expenses,
                    carExpenses: month.carExpenses,
                    homeExpenses: month.homeExpenses,
                    tasks: month.tasks,
                    updatedAt
                });
            });
        }

        const ledger = database.savingsLedger;

        if (ledger && typeof ledger === "object") {
            const updatedAt = stampOf(ledger.updatedAt);

            const hasRecords = LEDGER_LIST_FIELDS.some(
                (field) => Array.isArray(ledger[field]) && ledger[field].length > 0
            );

            if (hasRecords || updatedAt) {
                output[LEDGER_KEY] = makeLedgerPayload({
                    transactions: ledger.transactions,
                    debtors: ledger.debtors,
                    updatedAt
                });
            }
        }

        return output;
    }

    function unionLists(first, second) {
        const seen = new Set();
        const records = [];

        [first, second].forEach((list) => {
            (Array.isArray(list) ? list : []).forEach((record) => {
                if (!record || typeof record !== "object") {
                    return;
                }

                const id = recordKey(record);

                if (seen.has(id)) {
                    return;
                }

                seen.add(id);
                records.push(record);
            });
        });

        return records;
    }

    function changedSettings(settings, defaults) {
        const source = cleanSettings(settings);
        const output = {};

        Object.keys(source).forEach((key) => {
            if (
                !Object.prototype.hasOwnProperty.call(defaults, key) ||
                source[key] !== defaults[key]
            ) {
                output[key] = source[key];
            }
        });

        return output;
    }

    /* Records merged from both sides, de-duplicated by identity. */
    function unionPayload(key, local, remote, defaults) {
        const stamp = Math.max(
            Date.now(),
            (local.updatedAt || 0) + 1,
            (remote.updatedAt || 0) + 1
        );

        if (key === LEDGER_KEY) {
            return makeLedgerPayload({
                transactions: unionLists(local.transactions, remote.transactions),
                debtors: unionLists(local.debtors, remote.debtors),
                updatedAt: stamp
            });
        }

        return makeMonthPayload({
            year: local.year || remote.year,
            month: typeof local.month === "number" ? local.month : remote.month,
            // Values customised on this device win over the cloud's.
            settings: Object.assign(
                {},
                remote.settings,
                changedSettings(local.settings, defaults || {})
            ),
            expenses: unionLists(local.expenses, remote.expenses),
            carExpenses: unionLists(local.carExpenses, remote.carExpenses),
            homeExpenses: unionLists(local.homeExpenses, remote.homeExpenses),
            tasks: unionLists(local.tasks, remote.tasks),
            updatedAt: stamp
        });
    }

    /*
        Decide what goes where.

        apply -> payloads that must be written into the local database
        push  -> payloads that must be written to Firestore

        Options:
            syncedKeys : keys this device already synced
            defaults   : app default month settings
    */
    function mergeData(localMap, remoteMap, options) {
        const opts = options || {};
        const local = localMap || {};
        const remote = remoteMap || {};

        const syncedKeys = opts.syncedKeys instanceof Set
            ? opts.syncedKeys
            : new Set(Array.isArray(opts.syncedKeys) ? opts.syncedKeys : []);

        const apply = new Map();
        const push = new Map();

        const keys = new Set(Object.keys(local).concat(Object.keys(remote)));

        keys.forEach((key) => {
            const localPayload = local[key];
            const remotePayload = remote[key];

            // Local only -> migrate it to the cloud.
            if (!remotePayload) {
                if (localPayload) {
                    push.set(key, stampPayload(localPayload));
                }
                return;
            }

            // Cloud only -> restore it locally.
            if (!localPayload) {
                apply.set(key, remotePayload);
                return;
            }

            const localJson = payloadJson(localPayload);
            const remoteJson = payloadJson(remotePayload);

            if (localJson === remoteJson) {
                return;
            }

            let winner = null;

            if (!syncedKeys.has(key)) {
                // Never synced from this device: keep BOTH sides.
                winner = unionPayload(key, localPayload, remotePayload, opts.defaults);
            } else if (remotePayload.updatedAt > localPayload.updatedAt) {
                winner = remotePayload;
            } else {
                winner = localPayload;
            }

            const winnerJson = payloadJson(winner);

            if (winnerJson !== localJson) {
                apply.set(key, winner);
            }

            if (winnerJson !== remoteJson) {
                push.set(key, stampPayload(winner));
            }
        });

        return { apply, push };
    }

    /* Write payloads into the in-memory database (no save/render here). */
    function applyData(database, applyMap, createMonth) {
        if (!database || !applyMap || !applyMap.size) {
            return [];
        }

        if (!database.months || typeof database.months !== "object") {
            database.months = {};
        }

        const changedKeys = [];

        applyMap.forEach((payload, key) => {
            if (key === LEDGER_KEY) {
                const current = database.savingsLedger &&
                    typeof database.savingsLedger === "object"
                    ? database.savingsLedger
                    : {};

                database.savingsLedger = Object.assign({}, current, {
                    transactions: cloneList(payload.transactions),
                    debtors: cloneList(payload.debtors),
                    updatedAt: stampOf(payload.updatedAt)
                });

                changedKeys.push(key);
                return;
            }

            let month = database.months[key];

            if (!month) {
                const parts = splitKey(key);

                const year = payload.year || parts.year;
                const monthIndex =
                    typeof payload.month === "number" ? payload.month : parts.month;

                month = typeof createMonth === "function"
                    ? createMonth(year, monthIndex)
                    : makeEmptyMonth(year, monthIndex);

                database.months[key] = month;
            }

            MONTH_LIST_FIELDS.forEach((field) => {
                month[field] = cloneList(payload[field]);
            });

            month.settings = Object.assign(
                {},
                month.settings,
                cleanSettings(payload.settings)
            );

            month.updatedAt = stampOf(payload.updatedAt);
            delete month.carUpdatedAt;

            if (payload.year) {
                month.year = payload.year;
            }

            if (typeof payload.month === "number") {
                month.month = payload.month;
            }

            changedKeys.push(key);
        });

        return changedKeys;
    }

    function makeEmptyMonth(year, month) {
        return {
            year,
            month,
            settings: {},
            savings: null,
            expenses: [],
            carExpenses: [],
            homeExpenses: [],
            tasks: []
        };
    }

    /* =========================================================
       FIRESTORE I/O
    ========================================================= */

    function userRef(uid) {
        return db.collection(USERS_COLLECTION).doc(uid);
    }

    function docRefFor(uid, key) {
        return key === LEDGER_KEY
            ? userRef(uid).collection(META_COLLECTION).doc(LEDGER_DOC)
            : userRef(uid).collection(MONTHS_COLLECTION).doc(key);
    }

    /* Firestore snapshots (months + meta) -> payload map. */
    function snapshotsToMap(monthsSnap, metaSnap) {
        const output = {};

        if (monthsSnap) {
            monthsSnap.forEach((doc) => {
                const data = doc.data();

                if (data && isMonthKey(doc.id)) {
                    output[doc.id] = normalizePayload(data, doc.id);
                }
            });
        }

        if (metaSnap) {
            metaSnap.forEach((doc) => {
                const data = doc.data();

                if (data && doc.id === LEDGER_DOC) {
                    output[LEDGER_KEY] = normalizePayload(data, LEDGER_KEY);
                }
            });
        }

        return output;
    }

    async function readRemoteData(uid) {
        const base = userRef(uid);

        let monthsSnap;
        let metaSnap;

        try {
            monthsSnap = await base.collection(MONTHS_COLLECTION).get();
            metaSnap = await base.collection(META_COLLECTION).get();
        } catch (error) {
            logFirebaseError(
                "readRemoteData",
                error,
                uid,
                `users/${uid}/${MONTHS_COLLECTION} + users/${uid}/${META_COLLECTION}`
            );

            throw error;
        }

        const output = snapshotsToMap(monthsSnap, metaSnap);

        // Older versions stored car data only: use it for months
        // the new collection does not hold yet.
        try {
            const legacySnap = await base.collection(LEGACY_CAR_COLLECTION).get();

            legacySnap.forEach((doc) => {
                const data = doc.data();

                if (data && isMonthKey(doc.id) && !output[doc.id]) {
                    output[doc.id] = normalizeLegacyCar(data, doc.id);
                }
            });
        } catch (error) {
            logFirebaseError(
                "readLegacyCarData",
                error,
                uid,
                `users/${uid}/${LEGACY_CAR_COLLECTION}`
            );
        }

        return output;
    }

    async function writeRemoteDocuments(uid, map) {
        const keys = Object.keys(map);

        let index = 0;

        while (index < keys.length) {
            const chunk = keys.slice(index, index + MAX_BATCH_SIZE);
            const batch = db.batch();

            chunk.forEach((key) => {
                const payload = sanitize(map[key]);

                batch.set(docRefFor(uid, key), payload);
            });

            try {
                await batch.commit();

                chunk.forEach((key) => {
                    syncedCache.set(
                        cacheKey(uid, key),
                        payloadJson(map[key])
                    );
                });
            } catch (error) {
                logFirebaseError(
                    "writeRemoteDocuments",
                    error,
                    uid,
                    chunk.map((key) => docPathFor(uid, key)).join(", ")
                );

                throw error;
            }

            index += chunk.length;
        }

        // Account marker - metadata only, failures are ignored.
        try {
            const user = currentUser();

            await userRef(uid).set(
                {
                    email: (user && user.email) || "",
                    scope: "all",
                    lastSyncAtMs: Date.now()
                },
                { merge: true }
            );
        } catch (error) {
            logFirebaseError(
                "writeAccountMarker",
                error,
                uid,
                `users/${uid}`
            );
        }
    }

    function refreshLocalCaches(database) {
        const local = collectData(database, getDefaults());

        Object.keys(local).forEach((key) => {
            contentCache.set(key, contentJson(local[key]));
        });

        return local;
    }

    /*
        Merge cloud data into the local database and queue whatever
        the cloud is missing. Never deletes local records.
    */
    function applyMerge(remoteMap) {
        const database = getDatabase();
        const user = currentUser();

        if (!database || !user) {
            return null;
        }

        const uid = user.uid;
        const remote = remoteMap || {};
        const defaults = getDefaults();
        const local = collectData(database, defaults);

        const syncedKeys = new Set();

        Object.keys(local).concat(Object.keys(remote)).forEach((key) => {
            if (syncedCache.has(cacheKey(uid, key))) {
                syncedKeys.add(key);
            }
        });

        const result = mergeData(local, remote, { syncedKeys, defaults });

        // Something we already wrote ourselves is not worth writing again
        // (a stale rewrite could overwrite a newer edit from another device).
        result.push.forEach((payload, key) => {
            if (syncedCache.get(cacheKey(uid, key)) === payloadJson(payload)) {
                result.push.delete(key);
            }
        });

        // The cloud's version replaces ours, so an older queued write for
        // the same document must not go out any more.
        result.apply.forEach((payload, key) => {
            pendingPush.delete(key);
        });

        const appliedKeys = applyData(database, result.apply, bound.createMonth);

        // What the cloud already holds counts as "synced" for this device.
        result.apply.forEach((payload, key) => {
            const remotePayload = remote[key];

            if (remotePayload && payloadJson(remotePayload) === payloadJson(payload)) {
                syncedCache.set(cacheKey(uid, key), payloadJson(payload));
            }
        });

        const pushMap = {};

        result.push.forEach((value, key) => {
            pushMap[key] = value;
        });

        const pushedKeys = Object.keys(pushMap);

        if (pushedKeys.length) {
            applyData(database, result.push, bound.createMonth);
        }

        refreshLocalCaches(database);

        if (appliedKeys.length || pushedKeys.length) {
            persistLocal();
        }

        if (appliedKeys.length) {
            notifyRemoteChange();
        }

        if (pushedKeys.length) {
            schedulePush(pushMap);
        }

        return { applied: appliedKeys, pushed: pushedKeys };
    }

    /* =========================================================
       PUSH (local -> cloud)
    ========================================================= */

    function schedulePush(map) {
        Object.keys(map).forEach((key) => {
            pendingPush.set(key, map[key]);
        });

        emitStatus({ phase: "syncing", message: "جارٍ حفظ بياناتك..." });

        if (pushTimer) {
            clearTimeout(pushTimer);
        }

        pushTimer = setTimeout(
            () => {
                pushTimer = null;
                flushPending();
            },
            PUSH_DEBOUNCE_MS
        );
    }

    function flushPending() {
        if (pushTimer) {
            clearTimeout(pushTimer);
            pushTimer = null;
        }

        // Only cancel the pending timer: the attempt counter must survive
        // so the backoff keeps growing (5s, 10s, 20s ... 5min) until a
        // flush really succeeds.
        cancelRetryTimer();

        flushChain = flushChain.then(doFlush, doFlush);

        return flushChain;
    }

    function doFlush() {
        const user = currentUser();

        if (!user || !db || !pendingPush.size) {
            if (!pendingPush.size && user && status.phase === "syncing") {
                emitStatus({ phase: "synced", message: "مزامن مع الحساب" });
            }

            return null;
        }

        const uid = user.uid;
        const map = {};

        pendingPush.forEach((value, key) => {
            map[key] = value;
        });

        pendingPush.clear();

        return writeRemoteDocuments(uid, map)
            .then(() => {
                if (retryTimer) {
                    clearTimeout(retryTimer);
                    retryTimer = null;
                }

                retryAttempts = 0;

                emitStatus({
                    phase: "synced",
                    message: "تم حفظ بياناتك"
                });
            })
            .catch((error) => {
                logFirebaseError(
                    "doFlush/push",
                    error,
                    uid,
                    Object.keys(map).map((key) => docPathFor(uid, key)).join(", ")
                );

                const stillSameUser = currentUser() && currentUser().uid === uid;

                if (!stillSameUser) {
                    // Signed out / switched account while the write was in
                    // flight: never queue this data for another account.
                    // (It is still safe in localStorage.)
                    return;
                }

                Object.keys(map).forEach((key) => {
                    if (!pendingPush.has(key)) {
                        pendingPush.set(key, map[key]);
                    }
                });

                emitStatus({ phase: "error", message: dbErrorText(error) });

                scheduleRetry(uid);
            });
    }

    function scheduleRetry(uid) {
        if (retryTimer) {
            return;
        }

        const user = currentUser();

        if (!user || user.uid !== uid || !db || !pendingPush.size) {
            return;
        }

        // Offline: the "online" event triggers the flush, no point spinning.
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            return;
        }

        retryAttempts += 1;

        const delay = Math.min(
            RETRY_BASE_MS * Math.pow(2, Math.min(retryAttempts - 1, 10)),
            RETRY_MAX_MS
        );

        retryTimer = setTimeout(
            () => {
                retryTimer = null;

                flushPending();
            },
            delay
        );
    }

    function cancelRetryTimer() {
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
    }

    // Full reset (logout / offline / successful flush).
    function clearRetryTimer() {
        cancelRetryTimer();

        retryAttempts = 0;
    }

    /* =========================================================
       PULL (cloud -> local) + LIVE LISTENERS
    ========================================================= */

    function pullNow() {
        pullChain = pullChain.then(doPull, doPull);

        return pullChain;
    }

    function doPull() {
        const user = currentUser();

        if (!user || !db) {
            return Promise.resolve(null);
        }

        const uid = user.uid;

        emitStatus({ phase: "syncing", message: "جارٍ استرجاع بياناتك..." });

        return readRemoteData(uid)
            .then((remote) => {
                applyMerge(remote);

                return flushPending();
            })
            .then(() => {
                emitStatus({ phase: "synced", message: "مزامن مع الحساب" });

                return true;
            })
            .catch((error) => {
                logFirebaseError(
                    "doPull/readRemoteData",
                    error,
                    uid,
                    `users/${uid}/${MONTHS_COLLECTION} + users/${uid}/${META_COLLECTION}`
                );

                emitStatus({ phase: "error", message: dbErrorText(error) });

                return null;
            });
    }

    function stopSnapshot() {
        unsubSnapshots.forEach((unsubscribe) => {
            try {
                unsubscribe();
            } catch (error) {
                console.error("Daftari unsubscribe error:", error);
            }
        });

        unsubSnapshots = [];
    }

    /*
        Two live listeners (months + meta). The merge runs only once
        BOTH delivered a snapshot, so a half-loaded cloud state is
        never mistaken for "the cloud lacks this document".
    */
    function startSnapshot(uid) {
        stopSnapshot();

        if (!db) {
            return;
        }

        const state = { months: null, meta: null };

        function onChange() {
            if (!state.months || !state.meta) {
                return;
            }

            const remote = snapshotsToMap(state.months, state.meta);

            // Keep legacy-only months visible to the merge.
            applyMerge(remote);
        }

        function listen(name, collection) {
            try {
                unsubSnapshots.push(
                    userRef(uid).collection(collection).onSnapshot(
                        (snapshot) => {
                            state[name] = snapshot;
                            onChange();
                        },
                        (error) => {
                            console.error("Daftari snapshot error:", error);
                        }
                    )
                );
            } catch (error) {
                console.error("Daftari listener error:", error);
            }
        }

        listen("months", MONTHS_COLLECTION);
        listen("meta", META_COLLECTION);
    }

    /* =========================================================
       LOCAL SAVE HOOK (called by the app on every save)
    ========================================================= */

    function primeContentCache() {
        const database = getDatabase();

        if (!database) {
            return;
        }

        refreshLocalCaches(database);
    }

    function onLocalSave() {
        const database = getDatabase();

        if (!database) {
            return;
        }

        const defaults = getDefaults();

        let local = collectData(database, defaults);
        let bumped = false;

        // Real content change -> refresh that document's sync timestamp.
        Object.keys(local).forEach((key) => {
            const content = contentJson(local[key]);

            if (contentCache.get(key) === content) {
                return;
            }

            contentCache.set(key, content);
            bumped = true;

            const target = key === LEDGER_KEY
                ? database.savingsLedger
                : database.months[key];

            if (target) {
                const previous = stampOf(target.updatedAt);

                // Always move forward so Last-Write-Wins stays deterministic.
                target.updatedAt = Math.max(Date.now(), previous + 1);
            }
        });

        if (bumped) {
            local = collectData(database, defaults);
        }

        const user = currentUser();

        if (!user || !db) {
            return;
        }

        const uid = user.uid;
        const dirty = {};

        Object.keys(local).forEach((key) => {
            if (syncedCache.get(cacheKey(uid, key)) !== payloadJson(local[key])) {
                dirty[key] = local[key];
            }
        });

        if (Object.keys(dirty).length) {
            schedulePush(dirty);
        }
    }

    /* =========================================================
       AUTH
    ========================================================= */

    function handleAuth(user) {
        stopSnapshot();
        clearRetryTimer();

        if (pushTimer) {
            clearTimeout(pushTimer);
            pushTimer = null;
        }

        pendingPush.clear();

        if (!user) {
            syncedCache.clear();

            const configured = isConfigured();

            emitStatus({
                configured,
                signedIn: false,
                email: "",
                phase: configured ? "local" : "unconfigured",
                message: configured
                    ? "البيانات محفوظة على هذا الجهاز"
                    : "أضف إعدادات Firebase في firebase-config.js"
            });

            notifyAuthChange(null);

            return Promise.resolve(null);
        }

        emitStatus({
            configured: true,
            signedIn: true,
            email: user.email || "",
            phase: "syncing",
            message: "جارٍ استرجاع بياناتك..."
        });

        notifyAuthChange(user);

        return pullNow().then(() => {
            startSnapshot(user.uid);

            return user;
        });
    }

    function init(options) {
        Object.assign(bound, options || {});

        config = global.FIREBASE_CONFIG || null;

        primeContentCache();

        if (!isConfigured()) {
            emitStatus({
                configured: false,
                signedIn: false,
                email: "",
                phase: "unconfigured",
                message: "أضف إعدادات Firebase في firebase-config.js"
            });

            notifyAuthChange(null);

            return Promise.resolve(null);
        }

        try {
            if (!global.firebase) {
                throw new Error("Firebase SDK not loaded");
            }

            const fb = global.firebase;

            firebaseApp = (fb.apps && fb.apps.length)
                ? fb.app()
                : fb.initializeApp(config);

            auth = firebaseApp.auth();
            db = firebaseApp.firestore();

            try {
                const persistence = db.enablePersistence
                    ? db.enablePersistence({ synchronizeTabs: true })
                    : null;

                if (persistence && typeof persistence.catch === "function") {
                    persistence.catch(() => {});
                }
            } catch (error) {
                // Offline persistence is optional.
            }

            if (typeof global.addEventListener === "function") {
                global.addEventListener(
                    "online",
                    () => {
                        if (currentUser()) {
                            pullNow();
                            flushPending();
                        }
                    }
                );

                global.addEventListener(
                    "offline",
                    () => {
                        clearRetryTimer();
                    }
                );
            }

            return new Promise((resolve) => {
                let settled = false;

                auth.onAuthStateChanged(
                    (user) => {
                        handleAuth(user).catch((error) => {
                            console.error("Daftari auth sync error:", error);
                        });

                        if (!settled) {
                            settled = true;
                            resolve(user);
                        }
                    },
                    (error) => {
                        emitStatus({ phase: "error", message: authErrorText(error) });

                        if (!settled) {
                            settled = true;
                            resolve(null);
                        }
                    }
                );
            });

        } catch (error) {
            console.error("Daftari Firebase init error:", error);

            emitStatus({
                configured: false,
                phase: "error",
                message: authErrorText(error)
            });

            return Promise.resolve(null);
        }
    }

    /* =========================================================
       PUBLIC AUTH API
    ========================================================= */

    function ensureReady() {
        if (!auth) {
            const text = "Firebase غير مهيّأ — راجع firebase-config.js";

            emitStatus({ phase: "error", message: text });

            throw new Error(text);
        }
    }

    function signIn(email, password) {
        try {
            ensureReady();
        } catch (error) {
            return Promise.reject(error);
        }

        return auth
            .signInWithEmailAndPassword(
                String(email || "").trim(),
                String(password || "")
            )
            .then((credential) => credential.user)
            .catch((error) => {
                const text = authErrorText(error);

                emitStatus({ phase: "error", message: text });

                throw new Error(text);
            });
    }

    function signUp(email, password) {
        try {
            ensureReady();
        } catch (error) {
            return Promise.reject(error);
        }

        return auth
            .createUserWithEmailAndPassword(
                String(email || "").trim(),
                String(password || "")
            )
            .then((credential) => credential.user)
            .catch((error) => {
                const text = authErrorText(error);

                emitStatus({ phase: "error", message: text });

                throw new Error(text);
            });
    }

    function signOut() {
        pendingPush.clear();

        if (!auth) {
            handleAuth(null);

            return Promise.resolve();
        }

        return auth.signOut().catch((error) => {
            const text = authErrorText(error);

            emitStatus({ phase: "error", message: text });

            throw new Error(text);
        });
    }

    /* =========================================================
       EXPORT
    ========================================================= */

    const api = {
        init,
        isConfigured,
        getStatus,
        getUser,
        signIn,
        signUp,
        signOut,
        onLocalSave,
        flushPending,
        pullNow,

        // Pure helpers (exposed for tests / tooling)
        collectData,
        mergeData,
        applyData
    };

    global.DaftariSync = api;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

})(typeof window !== "undefined" ? window : globalThis);
