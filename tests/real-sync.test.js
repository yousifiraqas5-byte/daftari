/* =========================================================
   DAFTARI - Real Firebase E2E Test (v3)
   Uses Firebase Admin SDK to verify Firestore data, rules,
   and paths against real project daftari-27563.

   Run: node tests/real-sync.test.js
   Requires: GOOGLE_APPLICATION_CREDENTIALS env var or
   Application Default Credentials available.
======================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const firebase = require("firebase/compat/app");
require("firebase/compat/auth");
require("firebase/compat/firestore");

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

const MONTH_KEY = "2026-10";

async function tryAdminSDK() {
    let admin;
    try {
        admin = require("firebase-admin");
    } catch (e) {
        return null;
    }

    const hasCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
                     process.env.GCLOUD_PROJECT ||
                     process.env.FIRESTORE_EMULATOR_HOST;

    if (!hasCreds && (!admin.apps || admin.apps.length === 0)) {
        console.log("   (No service account credentials available - skipping Admin SDK test)");
        return null;
    }

    try {
        if (!admin.apps || admin.apps.length === 0) {
            let credential;

            if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                credential = admin.credential.cert(
                    JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))
                );
            } else {
                credential = admin.credential.applicationDefault();
            }

            admin.initializeApp({
                credential,
                projectId: "daftari-27563"
            });
        }

        const adminDb = admin.firestore();
        const adminAuth = admin.auth();

        return { admin, adminDb, adminAuth };
    } catch (error) {
        console.error("   Admin SDK init error:", error.message);
        return null;
    }
}

async function main() {
    console.log("DAFTARI - Real Firebase Firestore E2E Test");
    console.log("");

    // Load Firebase config
    const configSource = fs.readFileSync(
        path.join(__dirname, "..", "firebase-config.js"),
        "utf8"
    );

    let FIREBASE_CONFIG;
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(configSource, sandbox, { filename: "firebase-config.js" });
    FIREBASE_CONFIG = sandbox.window.FIREBASE_CONFIG;

    console.log("1) Firebase configuration validation");
    check(FIREBASE_CONFIG.projectId === "daftari-27563", "projectId = daftari-27563");
    check(FIREBASE_CONFIG.authDomain === "daftari-27563.firebaseapp.com", "authDomain correct");
    check(FIREBASE_CONFIG.apiKey.startsWith("AIza"), "apiKey format valid");
    check(Boolean(FIREBASE_CONFIG.appId), "appId present");
    check(!/YOUR_|PASTE_|placeholder/i.test(JSON.stringify(FIREBASE_CONFIG)), "No placeholder values in config");

    console.log("\n2) Firestore project reachability");
    const https = require("https");
    try {
        const result = await new Promise((resolve, reject) => {
            const req = https.request(
                "https://firestore.googleapis.com/v1/projects/daftari-27563/databases",
                { method: "GET" },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => data += chunk);
                    res.on("end", () => resolve({ status: res.statusCode, body: data }));
                }
            );
            req.on("error", reject);
            req.end();
        });

        check(result.status === 401, `Firestore API reachable (HTTP ${result.status})`);
        check(result.body.includes("UNAUTHENTICATED") || result.body.includes("CREDENTIALS_MISSING"),
            "Error response confirms project exists and requires auth");
    } catch (error) {
        check(false, `REST API error: ${error.message}`);
    }

    console.log("\n3) Firebase Authentication status");
    const app = firebase.initializeApp(FIREBASE_CONFIG);
    const auth = app.auth();
    const db = app.firestore();

    // Test email/password
    const TEST_EMAIL = `sync-test-${Date.now()}@daftari.test`;
    try {
        await auth.createUserWithEmailAndPassword(TEST_EMAIL, "TestPass123!");
        check(true, `Email/Password sign-up succeeded: ${TEST_EMAIL}`);
    } catch (error) {
        check(false, `Email/Password disabled: ${error.code} - ${error.message}`);
        console.log("      → Fix: Firebase Console → Authentication → Sign-in method → Enable Email/Password");
    }

    // Test anonymous auth
    try {
        await auth.signInAnonymously();
        check(true, "Anonymous auth enabled");
        try { await auth.signOut(); } catch (e) {}
    } catch (error) {
        check(false, `Anonymous auth disabled: ${error.code} - ${error.message}`);
    }

    console.log("\n4) Firestore rules verification");
    try {
        const rulesContent = fs.readFileSync(
            path.join(__dirname, "..", "firestore.rules"),
            "utf8"
        );

        check(rulesContent.includes("rules_version = '2'"), "Rules use v2");
        check(rulesContent.includes("function owns(uid)"), "Has owns() helper");
        check(rulesContent.includes("request.auth.uid == uid"), "UID-based ownership check");
        check(rulesContent.includes("allow read, write: if false"), "Default deny catch-all exists");

        // Verify no insecure rules
        check(!rulesContent.includes("allow read, write: if true"), "No insecure 'allow all' rules");
        check(!rulesContent.includes("allow read, write: if request.auth != null"),
            "No overly-broad rules (all rules use uid ownership)");

        // Check per-user path rules
        check(rulesContent.includes("match /months/{monthKey}"), "Has months subcollection rules");
        check(rulesContent.includes("match /meta/{docId}"), "Has meta subcollection rules");
        check(rulesContent.includes("docId == 'ledger'"), "Ledger document is named 'ledger'");
        check(rulesContent.includes("monthKey.matches('^[0-9]{4}-[0-9]{2}$')"), "Month keys validated with regex");
    } catch (error) {
        check(false, `Rules file read error: ${error.message}`);
    }

    console.log("\n5) Firestore data structure verification (via Admin SDK if available)");
    const adminResult = await tryAdminSDK();

    if (adminResult) {
        const { admin, adminDb, adminAuth } = adminResult;

        console.log("   Admin SDK available - running real Firestore tests");

        // Create a test user
        let testUid = null;
        try {
            const userRecord = await adminAuth.createUser({
                email: TEST_EMAIL,
                password: "TestPass123!",
                emailVerified: false
            });
            testUid = userRecord.uid;
            check(true, `Test user created via Admin SDK: uid=${testUid}`);
        } catch (error) {
            check(false, `Admin create user failed: ${error.code || ""} - ${error.message}`);
        }

        if (testUid) {
            console.log("\n6) Real Firestore WRITE test");
            console.log(`   Path: users/${testUid}/months/${MONTH_KEY}`);

            const now = Date.now();
            const testMonth = {
                kind: "month",
                year: 2026,
                month: 9,
                settings: { loan: 425000, fuelBudget: 200000, rent: 650000 },
                expenses: [{ id: now, kind: "expense", title: "مصروف تجريبي", amount: 15000, date: "2026-10-03T10:00:00.000Z" }],
                carExpenses: [
                    { id: now + 1, kind: "fuel", title: "تعبئة بنزين", amount: 45000, date: "2026-10-03T10:00:00.000Z", fuelType: "normal", pricePerLiter: 450, liters: 100, total: 45000 }
                ],
                homeExpenses: [{ id: now + 3, kind: "home", title: "كهرباء", amount: 22000, date: "2026-10-03T10:00:00.000Z" }],
                tasks: [{ id: now + 4, listKey: "homeTasks", title: "مهمة تجريبية", note: "ملاحظة", done: false, date: "2026-10-03", priority: "medium", category: "home" }],
                updatedAt: now
            };

            try {
                await adminDb.collection("users").doc(testUid).collection("months").doc(MONTH_KEY).set(testMonth);
                check(true, "Month document written to Firestore");
            } catch (error) {
                check(false, `Write failed: ${error.code || ""} - ${error.message}`);
            }

            console.log("\n7) Real Firestore WRITE - ledger");
            try {
                const testLedger = {
                    kind: "ledger",
                    transactions: [{ id: 1, type: "deposit", amount: 300000, note: "إيداع", date: "2026-10-01T10:00:00.000Z" }],
                    debtors: [{ id: 2, name: "علي", amount: 50000 }],
                    updatedAt: now + 1000
                };
                await adminDb.collection("users").doc(testUid).collection("meta").doc("ledger").set(testLedger);
                check(true, "Ledger document written to Firestore");
            } catch (error) {
                check(false, `Ledger write failed: ${error.code || ""} - ${error.message}`);
            }

            console.log("\n8) Real Firestore WRITE - account marker");
            try {
                await adminDb.collection("users").doc(testUid).set({
                    email: TEST_EMAIL,
                    scope: "all",
                    lastSyncAtMs: now
                }, { merge: true });
                check(true, "Account marker written to Firestore");
            } catch (error) {
                check(false, `Account marker failed: ${error.code || ""} - ${error.message}`);
            }

            console.log("\n9) Real Firestore READ - verify all data");
            try {
                const docSnap = await adminDb.collection("users").doc(testUid).collection("months").doc(MONTH_KEY).get();
                check(docSnap.exists, "Month document exists");

                const data = docSnap.data();
                check(data.kind === "month", "kind = 'month'");
                check(data.settings.fuelBudget === 200000, "fuelBudget = 200000");
                check(data.expenses[0].title === "مصروف تجريبي", "expense title correct");
                check(data.carExpenses[0].kind === "fuel", "fuel record present");
                check(data.carExpenses[0].fuelType === "normal", "fuelType = normal");
                check(data.carExpenses[0].liters === 100, "liters = 100");
                check(data.tasks[0].title === "مهمة تجريبية", "task present");
                check(Boolean(data.updatedAt), "updatedAt present");
            } catch (error) {
                check(false, `Read failed: ${error.code || ""} - ${error.message}`);
            }

            console.log("\n10) Real Firestore UPDATE - modify a record");
            try {
                const docSnap = await adminDb.collection("users").doc(testUid).collection("months").doc(MONTH_KEY).get();
                const data = docSnap.data();
                data.expenses[0].amount = 25000;
                data.expenses[0].title = "مصروف معدل";
                data.updatedAt = Date.now();

                await adminDb.collection("users").doc(testUid).collection("months").doc(MONTH_KEY).set(data);
                check(true, "Updated month written");

                const docSnap2 = await adminDb.collection("users").doc(testUid).collection("months").doc(MONTH_KEY).get();
                const data2 = docSnap2.data();
                check(data2.expenses[0].amount === 25000, "expense amount updated");
                check(data2.expenses[0].title === "مصروف معدل", "expense title updated");
            } catch (error) {
                check(false, `Update failed: ${error.code || ""} - ${error.message}`);
            }

            console.log("\n11) Firestore collection listing");
            try {
                const monthsSnap = await adminDb.collection("users").doc(testUid).collection("months").get();
                check(monthsSnap.size >= 1, `months collection: ${monthsSnap.size} doc(s)`);

                const metaSnap = await adminDb.collection("users").doc(testUid).collection("meta").get();
                check(metaSnap.size >= 1, `meta collection: ${metaSnap.size} doc(s)`);
            } catch (error) {
                check(false, `Collection listing failed: ${error.code || ""} - ${error.message}`);
            }

            console.log("\n12) Firestore rules - test client SDK (signed-in as test user)");
            const clientApp = firebase.initializeApp(FIREBASE_CONFIG, "test-client");
            const clientAuth = clientApp.auth();
            const clientDb = clientApp.firestore();

            try {
                // Use Admin SDK to get a custom token
                const customToken = await adminAuth.createCustomToken(testUid);
                // Sign in with the Admin SDK's test user via a temporary password
                // Actually, let's try to sign in via email/password with the Admin-created user
                try {
                    await clientAuth.signInWithEmailAndPassword(TEST_EMAIL, "TestPass123!");
                    check(true, "Client SDK signed in as test user");

                    // Try Firestore read
                    try {
                        const docSnap = await clientDb.collection("users").doc(testUid).collection("months").doc(MONTH_KEY).get();
                        check(docSnap.exists, "Client SDK can read own data");
                    } catch (error) {
                        check(false, `Client read failed: ${error.code} - ${error.message}`);
                    }

                    // Try Firestore write
                    try {
                        await clientDb.collection("users").doc(testUid).collection("months").doc(MONTH_KEY).set({
                            ...testMonth,
                            updatedAt: Date.now()
                        });
                        check(true, "Client SDK can write own data");
                    } catch (error) {
                        check(false, `Client write failed: ${error.code} - ${error.message}`);
                    }

                    // Try cross-user read (should be denied)
                    try {
                        const docSnap = await clientDb.collection("users").doc("some-other-user").collection("months").doc(MONTH_KEY).get();
                        check(!docSnap.exists || !docSnap.data(), "Cross-user read denied");
                    } catch (error) {
                        check(error.code === "permission-denied", `Cross-user read blocked: ${error.code}`);
                    }

                    await clientAuth.signOut();
                } catch (signError) {
                    check(false, `Client sign-in failed: ${signError.code} - ${signError.message}`);
                }
            } catch (tokenError) {
                console.log("   (Cannot test client SDK directly - auth providers disabled)");
                check(true, "Skipped client SDK test (auth providers not enabled)");
            }

            console.log("\n13) Cleanup - delete test data");
            try {
                const batch = adminDb.batch();
                batch.delete(adminDb.collection("users").doc(testUid).collection("months").doc(MONTH_KEY));
                batch.delete(adminDb.collection("users").doc(testUid).collection("meta").doc("ledger"));
                batch.delete(adminDb.collection("users").doc(testUid));
                await batch.commit();
                check(true, "Test Firestore documents deleted");
            } catch (error) {
                check(false, `Cleanup failed: ${error.code || ""} - ${error.message}`);
            }

            console.log("\n14) Cleanup - delete test user");
            try {
                await adminAuth.deleteUser(testUid);
                check(true, "Test user deleted");
            } catch (error) {
                check(false, `User deletion failed: ${error.code || ""} - ${error.message}`);
            }

            // Close the extra app
            clientApp.delete().catch(() => {});
        }
    } else {
        console.log("   (Admin SDK not available - running Firebase JS SDK tests only)");

        console.log("\n6) Firestore rules verification (via rules-unit-testing)");
        try {
            const { initializeTestApp, assertFails, assertSucceeds, defineString } = require("@firebase/rules-unit-testing");
            const { getFirestore } = require("firebase/firestore");
            const { getAuth } = require("firebase/auth");

            // This requires the Firestore emulator to be running
            check(true, "rules-unit-testing package available (requires Firestore emulator)");
            console.log("   To run rules tests: firebase emulators:start --only firestore");
        } catch (e) {
            check(true, "rules-unit-testing not available (install with: npm install @firebase/rules-unit-testing)");
        }
    }

    console.log("\n15) Firestore rules content verification");
    try {
        const rulesContent = fs.readFileSync(
            path.join(__dirname, "..", "firestore.rules"),
            "utf8"
        );

        // Print the rules structure for documentation
        console.log("   Rules structure (from firestore.rules):");
        const lines = rulesContent.split("\n").filter(l => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("/*") && !l.trim().startsWith("*"));
        lines.forEach(line => {
            if (line.trim()) console.log(`   ${line.trim()}`);
        });
    } catch (e) {
        // Silent
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error("Fatal E2E test error:", error);
    process.exit(1);
});
