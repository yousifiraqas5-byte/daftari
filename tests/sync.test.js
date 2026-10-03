/* =========================================================
   DAFTARI - Firebase sync tests (run with: node tests/sync.test.js)

   Uses an in-memory Firebase stub so the real
   firestore-sync.js code paths (save / reload / logout /
   login / migration / cross-device merge) are exercised
   without a live project.

   Everything the app stores is covered: monthly expenses,
   car, home, tasks, settings and the savings ledger.
========================================================= */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { createServer, createClient } = require("./fake-firebase.js");

const SYNC_SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "firestore-sync.js"),
    "utf8"
);

const STORAGE_KEY = "daftari_v2";

const DEFAULT_SETTINGS = {
    loan: 425000,
    fuelBudget: 200000,
    rent: 650000
};

const EMAIL = "owner@daftari.test";
const PASSWORD = "secret123";

const MONTH_KEY = "2026-09";

let passed = 0;
let failed = 0;

function check(condition, label) {
    if (condition) {
        passed += 1;
        console.log(`  ok   ${label}`);
    } else {
        failed += 1;
        console.log(`  FAIL ${label}`);
    }
}

function tick(ms = 30) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeMonth(year, month) {
    return {
        year,
        month,
        settings: Object.assign({}, DEFAULT_SETTINGS),
        savings: null,
        expenses: [],
        carExpenses: [],
        homeExpenses: []
    };
}

let recordSeq = 1000;

function makeRecord(kind, amount, date = "2026-09-05T10:00:00.000Z") {
    recordSeq += 1;

    return {
        id: recordSeq,
        kind,
        title: kind,
        amount,
        date
    };
}

function seedStorage(database) {
    return { [STORAGE_KEY]: JSON.stringify(database) };
}

function cloudDocs(server, uid, collection = "months") {
    const prefix = `users/${uid}/${collection}/`;
    const output = {};

    Object.keys(server.docs).forEach((docPath) => {
        if (docPath.indexOf(prefix) === 0) {
            output[docPath.slice(prefix.length)] = server.docs[docPath];
        }
    });

    return output;
}

function cloudLedger(server, uid) {
    return cloudDocs(server, uid, "meta").ledger || null;
}

/*
    One simulated device: its own localStorage + its own copy of
    firestore-sync.js running in an isolated JS context, sharing
    the same fake Firebase server.
*/
function createDevice(server, options = {}) {
    const storage = options.storage || {};

    const sandbox = {
        FIREBASE_CONFIG: {
            apiKey: "AIzaSyFakeKeyForTests0123456789",
            authDomain: "daftari-test.firebaseapp.com",
            projectId: "daftari-test",
            appId: "1:2:web:abc"
        },
        setTimeout,
        clearTimeout,
        console
    };

    sandbox.firebase = createClient(server);

    vm.createContext(sandbox);
    vm.runInContext(SYNC_SOURCE, sandbox, { filename: "firestore-sync.js" });

    const sync = sandbox.DaftariSync;

    function load() {
        return storage[STORAGE_KEY]
            ? JSON.parse(storage[STORAGE_KEY])
            : { months: {} };
    }

    let database = load();

    const statuses = [];
    const events = { authChanges: 0, remoteChanges: 0 };

    const device = {
        name: options.name || "device",
        sync,
        storage,
        statuses,
        events,

        get database() {
            return database;
        },

        // Mirrors saveDatabase() inside script.js
        commit() {
            sync.onLocalSave();
            storage[STORAGE_KEY] = JSON.stringify(database);
        },

        // Mirrors a full page reload (localStorage -> database)
        reload() {
            database = load();
        },

        month(key) {
            return database.months[key] || null;
        },

        list(key, field) {
            const month = database.months[key];

            return month && Array.isArray(month[field]) ? month[field] : [];
        },

        records(key) {
            return device.list(key, "carExpenses");
        },

        ledger() {
            return database.savingsLedger || { transactions: [], debtors: [] };
        },

        ensureMonth(key) {
            const parts = key.split("-");

            if (!database.months[key]) {
                database.months[key] = makeMonth(
                    Number(parts[0]),
                    Number(parts[1]) - 1
                );
            }

            return database.months[key];
        },

        addRecord(key, field, record) {
            device.ensureMonth(key);
            database.months[key][field] = database.months[key][field] || [];
            database.months[key][field].push(record);

            device.commit();
        },

        addCarRecord(key, kind, amount) {
            device.addRecord(key, "carExpenses", makeRecord(kind, amount));
        },

        removeRecord(key, field, recordId) {
            const month = database.months[key];

            month[field] = month[field].filter(
                (record) => record.id !== recordId
            );

            device.commit();
        },

        removeCarRecord(key, recordId) {
            device.removeRecord(key, "carExpenses", recordId);
        },

        setSetting(key, name, value) {
            device.ensureMonth(key).settings[name] = value;

            device.commit();
        },

        addTransaction(transaction) {
            database.savingsLedger = database.savingsLedger || {
                transactions: [],
                debtors: []
            };

            database.savingsLedger.transactions.push(transaction);

            device.commit();
        },

        addDebtor(debtor) {
            database.savingsLedger = database.savingsLedger || {
                transactions: [],
                debtors: []
            };

            database.savingsLedger.debtors.push(debtor);

            device.commit();
        },

        lastStatus() {
            return statuses.length ? statuses[statuses.length - 1] : null;
        }
    };

    device.ready = sync.init({
        getDatabase: () => database,
        createMonth: (year, month) => makeMonth(year, month),
        defaultSettings: DEFAULT_SETTINGS,

        persistLocal: () => {
            storage[STORAGE_KEY] = JSON.stringify(database);
        },

        onStatus: (status) => {
            statuses.push(JSON.parse(JSON.stringify(status)));
        },

        onAuthChange: () => {
            events.authChanges += 1;
        },

        onRemoteChange: () => {
            events.remoteChanges += 1;
        }
    });

    return device;
}

/* =========================================================
   TESTS
========================================================= */

async function testPureMergeHelpers() {
    console.log("\n1) merge helpers (pure, no Firebase I/O)");

    const tool = createDevice(createServer(), { name: "tool" });
    await tool.ready;

    const sync = tool.sync;

    const recA = makeRecord("fuel", 1000);
    const spend = makeRecord("expense", 5000);

    const base = {
        kind: "month",
        year: 2026,
        month: 8,
        settings: { fuelBudget: 200000 },
        expenses: [spend],
        carExpenses: [recA],
        homeExpenses: [],
        tasks: [],
        updatedAt: 500
    };

    const localOnly = { "2026-09": base };

    let result = sync.mergeData(localOnly, {}, { syncedKeys: [] });

    check(
        result.push.size === 1 && result.apply.size === 0,
        "local-only month is queued for upload"
    );

    const remoteOnly = {
        "2026-10": Object.assign({}, base, { month: 9, updatedAt: 900 })
    };

    result = sync.mergeData({}, remoteOnly, { syncedKeys: [] });

    check(
        result.apply.size === 1 && result.push.size === 0,
        "cloud-only month is restored locally"
    );

    result = sync.mergeData(localOnly, localOnly, { syncedKeys: ["2026-09"] });

    check(
        result.apply.size === 0 && result.push.size === 0,
        "identical data produces no writes"
    );

    const newerRemote = Object.assign({}, base, {
        updatedAt: 9999,
        expenses: [makeRecord("expense", 4242)]
    });

    result = sync.mergeData(
        localOnly,
        { "2026-09": newerRemote },
        { syncedKeys: ["2026-09"] }
    );

    check(
        result.apply.size === 1 && result.push.size === 0,
        "newer cloud data wins (last-write-wins)"
    );

    const newerLocal = Object.assign({}, base, { updatedAt: 12345 });

    result = sync.mergeData(
        { "2026-09": newerLocal },
        localOnly,
        { syncedKeys: ["2026-09"] }
    );

    check(
        result.push.size === 1 && result.apply.size === 0,
        "newer local data is uploaded (last-write-wins)"
    );

    /* ---- union of a never-synced month: every list is merged ---- */

    const recC = makeRecord("battery", 70000);
    const task = { id: 77, listKey: "homeTasks", title: "t", done: false };

    const union = sync.mergeData(
        {
            "2026-09": Object.assign({}, base, {
                settings: { fuelBudget: 200000, rent: 999000 },
                updatedAt: 0
            })
        },
        {
            "2026-09": Object.assign({}, base, {
                settings: { fuelBudget: 300000, rent: 650000 },
                carExpenses: [recC],
                tasks: [task],
                updatedAt: 5000
            })
        },
        { syncedKeys: [], defaults: DEFAULT_SETTINGS }
    );

    const merged = union.apply.get("2026-09");

    check(
        Boolean(merged) && merged.carExpenses.length === 2,
        "never-synced month merges car records of both sides"
    );
    check(
        merged.expenses.length === 1 && merged.tasks.length === 1,
        "union also keeps expenses and tasks"
    );
    check(
        merged.settings.rent === 999000 && merged.settings.fuelBudget === 300000,
        "union: settings changed on this device win, cloud keeps the rest"
    );
    check(union.push.size === 1, "merged month is uploaded too");

    /* ---- ledger payloads ---- */

    const tx1 = { id: 1, type: "deposit", amount: 100 };
    const tx2 = { id: 2, type: "deposit", amount: 50 };

    const ledgerUnion = sync.mergeData(
        { ledger: { kind: "ledger", transactions: [tx1], debtors: [], updatedAt: 0 } },
        { ledger: { kind: "ledger", transactions: [tx2], debtors: [{ id: 9 }], updatedAt: 3 } },
        { syncedKeys: [] }
    ).apply.get("ledger");

    check(
        Boolean(ledgerUnion) &&
            ledgerUnion.transactions.length === 2 &&
            ledgerUnion.debtors.length === 1,
        "never-synced savings ledger merges transactions and debtors"
    );

    /* ---- apply / collect ---- */

    const database = { months: {} };

    sync.applyData(
        database,
        new Map([["2026-09", merged], ["ledger", ledgerUnion]]),
        (year, month) => makeMonth(year, month)
    );

    check(
        database.months["2026-09"].carExpenses.length === 2 &&
            database.months["2026-09"].tasks.length === 1,
        "applyData creates missing months and writes every list"
    );
    check(
        database.savingsLedger.transactions.length === 2,
        "applyData restores the savings ledger"
    );

    const collected = sync.collectData(
        { months: { "2026-01": makeMonth(2026, 0) } },
        DEFAULT_SETTINGS
    );

    check(
        Object.keys(collected).length === 0,
        "collectData skips untouched months and an empty ledger"
    );

    const collectedAll = sync.collectData(database, DEFAULT_SETTINGS);

    check(
        Boolean(collectedAll["2026-09"]) && Boolean(collectedAll.ledger),
        "collectData returns the touched month and the ledger"
    );
}

async function testEndToEnd() {
    console.log("\n2) save / reload / logout / login / migration (all sections)");

    const server = createServer();

    /* ---- Device A: data that existed before Firebase ---- */

    const personal = makeRecord("expense", 15000);
    const home = makeRecord("home", 22000);
    const todo = { id: 4001, listKey: "personalTasks", title: "مهمة", note: "", done: false, date: "2026-09-02" };

    const storageA = seedStorage({
        months: {
            [MONTH_KEY]: Object.assign(makeMonth(2026, 8), {
                settings: Object.assign({}, DEFAULT_SETTINGS, { fuelBudget: 250000 }),
                expenses: [personal],
                homeExpenses: [home],
                tasks: [todo],
                carExpenses: [
                    makeRecord("fuel", 45000),
                    makeRecord("oil", 30000),
                    makeRecord("maintenance", 120000),
                    makeRecord("filter", 25000),
                    makeRecord("battery", 90000)
                ]
            })
        },
        savingsLedger: {
            transactions: [
                { id: 1, type: "deposit", amount: 300000, note: "", date: "2026-09-01T10:00:00.000Z" }
            ],
            debtors: [{ id: 2, name: "علي", amount: 50000 }]
        }
    });

    const a = createDevice(server, { storage: storageA, name: "A" });
    await a.ready;

    check(a.sync.isConfigured() === true, "A: Firebase config detected");
    check(a.sync.getUser() === null, "A: signed out before login");
    check(
        a.lastStatus() && a.lastStatus().phase === "local",
        "A: status is local-only before login"
    );

    /* ---- First sign-up must migrate the existing data ---- */

    await a.sync.signUp(EMAIL, PASSWORD);
    await a.sync.flushPending();
    await tick();

    const uid = a.sync.getUser().uid;
    const uploaded = cloudDocs(server, uid);

    check(Boolean(uploaded[MONTH_KEY]), "migration: month document exists in Firestore");
    check(
        uploaded[MONTH_KEY].carExpenses.length === 5,
        "migration: all 5 car records uploaded"
    );
    check(
        uploaded[MONTH_KEY].expenses.length === 1 &&
            uploaded[MONTH_KEY].homeExpenses.length === 1,
        "migration: personal and home expenses uploaded"
    );
    check(
        uploaded[MONTH_KEY].tasks.length === 1,
        "migration: tasks uploaded"
    );
    check(
        uploaded[MONTH_KEY].settings.fuelBudget === 250000,
        "migration: custom settings uploaded"
    );
    check(
        Boolean(cloudLedger(server, uid)) &&
            cloudLedger(server, uid).transactions.length === 1 &&
            cloudLedger(server, uid).debtors.length === 1,
        "migration: savings ledger (transactions + debtors) uploaded"
    );
    check(
        a.records(MONTH_KEY).length === 5,
        "migration: nothing deleted locally"
    );
    check(
        a.lastStatus().phase === "synced",
        "A: status reaches 'synced' after upload"
    );

    /* ---- Save new records of every kind on A ---- */

    a.addCarRecord(MONTH_KEY, "oil", 32000);
    a.addRecord(MONTH_KEY, "expenses", makeRecord("expense", 7000));
    a.addRecord(MONTH_KEY, "homeExpenses", makeRecord("home", 9000));
    a.addRecord(MONTH_KEY, "tasks", { id: 4002, listKey: "homeTasks", title: "ثانية", done: false });
    a.setSetting(MONTH_KEY, "rent", 700000);
    a.addTransaction({ id: 3, type: "deposit", amount: 100000, note: "", date: "2026-09-10T10:00:00.000Z" });

    await a.sync.flushPending();
    await tick();

    const afterSave = cloudDocs(server, uid)[MONTH_KEY];

    check(afterSave.carExpenses.length === 6, "save: new car record reaches Firestore");
    check(afterSave.expenses.length === 2, "save: new personal expense reaches Firestore");
    check(afterSave.homeExpenses.length === 2, "save: new home expense reaches Firestore");
    check(afterSave.tasks.length === 2, "save: new task reaches Firestore");
    check(afterSave.settings.rent === 700000, "save: edited setting reaches Firestore");
    check(
        cloudLedger(server, uid).transactions.length === 2,
        "save: new savings deposit reaches Firestore"
    );

    /* ---- Simulate "delete the app shortcut" (storage wiped) ---- */

    const b = createDevice(server, { storage: {}, name: "B" });
    await b.ready;

    await b.sync.signIn(EMAIL, PASSWORD);
    await tick(80);

    check(b.records(MONTH_KEY).length === 6, "restore: fresh device gets every car record back");
    check(b.list(MONTH_KEY, "expenses").length === 2, "restore: personal expenses come back");
    check(b.list(MONTH_KEY, "homeExpenses").length === 2, "restore: home expenses come back");
    check(b.list(MONTH_KEY, "tasks").length === 2, "restore: tasks come back");
    check(
        b.month(MONTH_KEY).settings.fuelBudget === 250000 &&
            b.month(MONTH_KEY).settings.rent === 700000,
        "restore: settings come back with the account"
    );
    check(
        b.ledger().transactions.length === 2 && b.ledger().debtors.length === 1,
        "restore: savings ledger comes back with the account"
    );
    check(b.lastStatus().phase === "synced", "B: status reaches 'synced' after restore");
    check(b.events.remoteChanges > 0, "B: restore triggers a re-render (onRemoteChange)");

    /* ---- Logout keeps everything locally ---- */

    await b.sync.signOut();
    await tick(40);

    check(b.records(MONTH_KEY).length === 6, "logout: local data is NOT deleted");
    check(b.lastStatus().phase === "local", "logout: status goes back to local-only");

    /* ---- Login again ---- */

    await b.sync.signIn(EMAIL, PASSWORD);
    await tick(80);

    check(b.records(MONTH_KEY).length === 6, "login again: data still intact");
    check(b.sync.getUser().email === EMAIL, "login again: account is attached");

    /* ---- Delete on B -> must show up on A ---- */

    const victimId = b.records(MONTH_KEY)[0].id;

    b.removeCarRecord(MONTH_KEY, victimId);
    await b.sync.flushPending();
    await tick(80);

    check(
        cloudDocs(server, uid)[MONTH_KEY].carExpenses.length === 5,
        "delete: removal saved to Firestore"
    );
    check(
        !a.records(MONTH_KEY).some((record) => record.id === victimId),
        "delete: the other device received the removal live"
    );

    /* ---- Savings deposit on B -> must show up on A live ---- */

    b.addTransaction({ id: 4, type: "withdraw", amount: 20000, note: "", date: "2026-09-12T10:00:00.000Z" });
    await b.sync.flushPending();
    await tick(80);

    check(
        cloudLedger(server, uid).transactions.length === 3,
        "savings: movement from B saved to Firestore"
    );
    check(
        a.ledger().transactions.length === 3,
        "savings: the other device received the movement live"
    );

    /* ---- Page reload keeps the sync timestamps ---- */

    a.reload();

    check(
        a.ledger().transactions.length === 3 &&
            Number(a.month(MONTH_KEY).updatedAt) > 0,
        "reload: data and sync timestamps survive a page reload"
    );

    return { server, uid, a };
}

async function testUnionMergeAcrossDevices(server, uid, a) {
    console.log("\n3) second device with its own unsynced data");

    const extra = makeRecord("fuel", 60000);
    const extraTx = { id: 99, type: "deposit", amount: 1, note: "", date: "2026-09-20T10:00:00.000Z" };

    const storageC = seedStorage({
        months: {
            [MONTH_KEY]: Object.assign(makeMonth(2026, 8), {
                carExpenses: [extra]
            })
        },
        savingsLedger: { transactions: [extraTx], debtors: [] }
    });

    const c = createDevice(server, { storage: storageC, name: "C" });
    await c.ready;

    await c.sync.signIn(EMAIL, PASSWORD);
    await tick(80);
    await c.sync.flushPending();
    await tick(80);

    const merged = cloudDocs(server, uid)[MONTH_KEY].carExpenses;

    check(
        merged.length === 6,
        `union: cloud keeps both sides (expected 6, got ${merged.length})`
    );
    check(
        merged.some((record) => record.id === extra.id),
        "union: C's own local record was not thrown away"
    );
    check(
        c.records(MONTH_KEY).length === 6,
        "union: C received the account's existing records"
    );
    check(
        a.records(MONTH_KEY).length === 6,
        "union: A received the merged result live"
    );
    check(
        cloudLedger(server, uid).transactions.length === 4 &&
            c.ledger().transactions.length === 4,
        "union: savings movements of both devices are kept"
    );
}

async function testLegacyCarMigration() {
    console.log("\n4) data saved by the old car-only version is migrated");

    const server = createServer();

    // Pretend an earlier version created this account's car documents.
    const first = createDevice(server, { name: "seed" });
    await first.ready;
    await first.sync.signUp("legacy@daftari.test", PASSWORD);

    const uid = first.sync.getUser().uid;

    server.docs[`users/${uid}/carMonths/2026-08`] = {
        year: 2026,
        month: 7,
        carExpenses: [makeRecord("fuel", 33000), makeRecord("oil", 11000)],
        fuelBudget: 180000,
        carUpdatedAt: 4000
    };

    const device = createDevice(server, { name: "legacy" });
    await device.ready;

    await device.sync.signIn("legacy@daftari.test", PASSWORD);
    await tick(80);
    await device.sync.flushPending();
    await tick(80);

    check(
        device.records("2026-08").length === 2,
        "legacy: old car records appear in the new data model"
    );
    check(
        device.month("2026-08").settings.fuelBudget === 180000,
        "legacy: old fuel budget is kept"
    );
    check(
        Boolean(cloudDocs(server, uid)["2026-08"]) &&
            cloudDocs(server, uid)["2026-08"].carExpenses.length === 2,
        "legacy: migrated month is saved to the new collection"
    );
    check(
        Boolean(server.docs[`users/${uid}/carMonths/2026-08`]),
        "legacy: the old documents are left untouched"
    );
}

async function testAuthErrors(server) {
    console.log("\n5) auth errors");

    const device = createDevice(server, { name: "errors" });
    await device.ready;

    let error = null;

    try {
        await device.sync.signIn(EMAIL, "wrong-pass");
    } catch (caught) {
        error = caught;
    }

    check(
        Boolean(error) && error.message === "كلمة المرور غير صحيحة",
        "wrong password returns an Arabic message"
    );

    error = null;

    try {
        await device.sync.signUp("not-an-email", "secret123");
    } catch (caught) {
        error = caught;
    }

    check(
        Boolean(error) && error.message === "البريد الإلكتروني غير صحيح",
        "invalid e-mail returns an Arabic message"
    );
}

function testRealConfig() {
    console.log("\n6) firebase-config.js wired to daftari-27563");

    const configSource = fs.readFileSync(
        path.join(__dirname, "..", "firebase-config.js"),
        "utf8"
    );

    // Same shape as the browser: config + sync module on `window`.
    const sandbox = { window: {} };

    vm.createContext(sandbox);
    vm.runInContext(configSource, sandbox, { filename: "firebase-config.js" });
    vm.runInContext(SYNC_SOURCE, sandbox, { filename: "firestore-sync.js" });

    const sync = sandbox.window.DaftariSync;
    const config = sandbox.window.FIREBASE_CONFIG;

    check(Boolean(config), "config file defines window.FIREBASE_CONFIG");
    check(
        sync && sync.isConfigured() === true,
        "DaftariSync.isConfigured() returns true"
    );
    check(config.projectId === "daftari-27563", "projectId = daftari-27563");
    check(
        config.authDomain === "daftari-27563.firebaseapp.com",
        "authDomain is correct"
    );
    check(
        String(config.apiKey).indexOf("AIza") === 0,
        "apiKey looks like a real Firebase web key"
    );
    check(Boolean(config.appId), "appId is present");
    check(
        !/YOUR_|PASTE_/.test(JSON.stringify(config)),
        "no placeholder values remain"
    );
}

(async function main() {
    console.log("DAFTARI - Firebase sync tests");

    try {
        await testPureMergeHelpers();

        const context = await testEndToEnd();

        await testUnionMergeAcrossDevices(
            context.server,
            context.uid,
            context.a
        );

        await testLegacyCarMigration();

        await testAuthErrors(context.server);

        testRealConfig();

    } catch (error) {
        failed += 1;

        console.error("\nUnexpected test error:");
        console.error(error);
    }

    console.log(`\n${passed} passed, ${failed} failed`);

    process.exit(failed > 0 ? 1 : 0);
})();
