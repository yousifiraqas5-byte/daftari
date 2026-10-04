/* =========================================================
   DAFTARI - Retry / backoff / account-switch tests
   Run with: node tests/retry.test.js

   Injects Firestore commit failures into the in-memory
   Firebase stub and checks:
     - backoff 5s,10s,20s,40s,80s,160s then capped at 300s
     - success only reported after batch.commit() succeeds
     - counter resets after a successful flush
     - data is kept (pendingPush) while Firestore is failing
     - a write that fails AFTER an account switch is never
       queued for the new account
========================================================= */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { createServer, createClient } = require("./fake-firebase.js");

const SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "firestore-sync.js"),
    "utf8"
);

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

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function createDevice(server) {
    const state = { fail: false, code: "unavailable", hold: null };
    const retryTimers = [];   // { fn, delay, cancelled }
    const logs = [];

    const sandbox = {
        FIREBASE_CONFIG: {
            apiKey: "AIzaSyFakeKeyForTests0123456789",
            authDomain: "daftari-test.firebaseapp.com",
            projectId: "daftari-test",
            appId: "1:2:web:abc"
        },
        // Long timers (retry backoff) are captured, short ones run for real.
        setTimeout(fn, delay) {
            if (delay >= 1000) {
                const entry = { fn, delay, cancelled: false };

                retryTimers.push(entry);

                return entry;
            }

            return setTimeout(fn, delay);
        },
        clearTimeout(handle) {
            if (handle && typeof handle === "object" && "cancelled" in handle) {
                handle.cancelled = true;

                return;
            }

            clearTimeout(handle);
        },
        console: {
            error: (...args) => logs.push(args.map(String).join(" ")),
            log() {},
            warn() {}
        }
    };

    const firebase = createClient(server);
    const originalInit = firebase.initializeApp;

    firebase.initializeApp = (config) => {
        const app = originalInit(config);
        const db = app.firestore();
        const originalBatch = db.batch;

        db.batch = () => {
            const batch = originalBatch();
            const originalCommit = batch.commit;

            batch.commit = () => {
                const run = () => state.fail
                    ? Promise.reject({ code: state.code, message: "injected" })
                    : originalCommit();

                return state.hold ? state.hold.then(run, run) : run();
            };

            return batch;
        };

        return app;
    };

    sandbox.firebase = firebase;

    vm.createContext(sandbox);
    vm.runInContext(SOURCE, sandbox, { filename: "firestore-sync.js" });

    const sync = sandbox.DaftariSync;
    const database = { months: {} };
    const statuses = [];

    const ready = sync.init({
        getDatabase: () => database,
        createMonth: (year, month) => ({
            year, month, settings: {}, savings: null,
            expenses: [], carExpenses: [], homeExpenses: []
        }),
        defaultSettings: {},
        persistLocal() {},
        onStatus: (s) => statuses.push(s)
    });

    function liveTimers() {
        return retryTimers.filter((t) => !t.cancelled);
    }

    function addMonth(key, note) {
        const parts = key.split("-");

        database.months[key] = {
            year: Number(parts[0]),
            month: Number(parts[1]) - 1,
            settings: {},
            savings: null,
            expenses: [{ id: 1, title: note, amount: 5 }],
            carExpenses: [],
            homeExpenses: []
        };

        sync.onLocalSave();
    }

    return {
        sync, state, database, statuses, logs, ready,
        retryTimers, liveTimers, addMonth
    };
}

async function testBackoff() {
    console.log("\n1) Backoff and success reporting");

    const server = createServer();
    const dev = createDevice(server);

    await dev.ready;
    await dev.sync.signUp("a@test.dev", "secret123");
    await tick(60);

    const uid = dev.sync.getUser().uid;

    dev.state.fail = true;
    dev.addMonth("2026-10", "first");
    await tick(700);   // debounce (350ms) + failed commit

    check(
        Object.keys(server.docs).every((p) => p.indexOf(`users/${uid}/months/`) !== 0),
        "nothing reached Firestore while commit fails"
    );
    check(
        !dev.statuses.some((s) => s.message === "تم حفظ بياناتك"),
        "no 'saved' message while commit fails"
    );
    check(
        dev.logs.some((l) => /code: unavailable/.test(l) && l.indexOf(uid) !== -1 &&
            l.indexOf(`users/${uid}/months/2026-10`) !== -1),
        "error log has operation, code, path and uid"
    );

    const expected = [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000];
    const seen = [];

    for (let i = 0; i < expected.length; i += 1) {
        const live = dev.liveTimers();

        if (live.length !== 1) {
            break;
        }

        seen.push(live[0].delay);
        live[0].cancelled = true;
        live[0].fn();
        await tick(40);
    }

    check(
        JSON.stringify(seen) === JSON.stringify(expected),
        `delays = ${seen.map((d) => d / 1000 + "s").join(", ")}`
    );

    // Recover: next retry must succeed, report success and reset counter.
    const last = dev.liveTimers()[0];

    dev.state.fail = false;
    last.cancelled = true;
    last.fn();
    await tick(60);

    check(
        Boolean(server.docs[`users/${uid}/months/2026-10`]),
        "data reaches Firestore once commit succeeds"
    );
    check(
        dev.statuses[dev.statuses.length - 1].message === "تم حفظ بياناتك",
        "'saved' reported only after commit succeeds"
    );
    check(dev.liveTimers().length === 0, "no retry timer left after success");

    dev.state.fail = true;
    dev.addMonth("2026-11", "second");
    await tick(700);

    check(
        dev.liveTimers().length === 1 && dev.liveTimers()[0].delay === 5000,
        "backoff restarts at 5s after a successful flush"
    );

    // Logout cancels the retry timer.
    await dev.sync.signOut();
    await tick(60);

    check(dev.liveTimers().length === 0, "logout cancels the retry timer");
}

async function testNoLeakAcrossAccounts() {
    console.log("\n2) Failed in-flight write never leaks to another account");

    const server = createServer();
    const dev = createDevice(server);

    await dev.ready;
    await dev.sync.signUp("a@test.dev", "secret123");
    await tick(60);

    const uidA = dev.sync.getUser().uid;

    // Hold the commit open, then reject it after the account switch.
    let release;

    dev.state.hold = new Promise((resolve) => { release = resolve; });
    dev.state.fail = true;

    dev.addMonth("2026-10", "secret-of-A");
    await tick(500);   // debounce fired, commit is now in flight

    await dev.sync.signOut();
    await tick(60);

    // Fresh device state for user B (so nothing local can be merged in).
    Object.keys(dev.database.months).forEach((key) => {
        delete dev.database.months[key];
    });
    delete dev.database.savingsLedger;

    await dev.sync.signUp("b@test.dev", "secret123");
    await tick(100);

    const uidB = dev.sync.getUser().uid;

    release();            // A's write now fails while B is signed in
    await tick(100);

    dev.state.fail = false;
    dev.state.hold = null;

    await dev.sync.flushPending();
    await tick(100);

    const leaked = Object.keys(server.docs).filter(
        (p) => p.indexOf(`users/${uidB}/months/`) === 0
    );

    check(uidA !== uidB, "two different accounts");
    check(leaked.length === 0, "account B received no data from account A");
    check(
        dev.liveTimers().length === 0,
        "no retry scheduled for the signed-out account"
    );
}

(async function main() {
    console.log("DAFTARI - retry / account-switch tests");

    try {
        await testBackoff();
        await testNoLeakAcrossAccounts();
    } catch (error) {
        failed += 1;
        console.error("\nUnexpected test error:");
        console.error(error);
    }

    console.log(`\n${passed} passed, ${failed} failed`);

    process.exit(failed > 0 ? 1 : 0);
})();
